import { GitWriteService } from "../git/write-service.js";
import type { InboundMessengerMessage } from "../messenger/types.js";
import type { TelegramMessage } from "../messenger/telegram-inbound.js";
import {
  buildLongPostDailyType,
  formatLongPostFeedback,
} from "./indexed-file.js";
import type { LongPostClient } from "./long-post-client.js";
import {
  DailyNoteWriter,
  formatCaptureFeedback,
  type DailyWriteResult,
} from "./daily-writer.js";
import {
  loadRegionConfig,
  parseTimezoneInput,
  regionConfigPath,
  saveRegionConfig,
} from "./region-config.js";
import { formatLocalClock, MONTH_ABBRS } from "./timezone.js";
import { isLongPost } from "./word-count.js";

export interface NoteCaptureResult {
  feedbackText: string;
  write?: DailyWriteResult;
}

export interface NoteCaptureServiceOptions {
  userRepoDir: string;
  gitWriter: GitWriteService;
  longPostClient?: LongPostClient;
}

interface InboundRaw {
  telegramMessage?: TelegramMessage;
  isForwarded?: boolean;
  forwardFrom?: string;
  receivedAtUtc?: number;
  forwardDateUtc?: number;
}

/**
 * Default-mode `<NoteLog>` capture: region setup, plain text, forwarded messages.
 */
export class NoteCaptureService {
  readonly #userRepoDir: string;
  readonly #gitWriter: GitWriteService;
  readonly #longPostClient?: LongPostClient;
  readonly #writer: DailyNoteWriter;
  #timezone: string | null = null;
  #awaitingTimezone = false;
  #pendingMessage: InboundMessengerMessage | null = null;

  constructor(options: NoteCaptureServiceOptions) {
    this.#userRepoDir = options.userRepoDir;
    this.#gitWriter = options.gitWriter;
    this.#longPostClient = options.longPostClient;
    this.#writer = new DailyNoteWriter(options.userRepoDir, options.gitWriter);
  }

  get timezone(): string | null {
    return this.#timezone;
  }

  get awaitingTimezone(): boolean {
    return this.#awaitingTimezone;
  }

  async ensureRegionLoaded(): Promise<string | null> {
    if (this.#timezone) {
      return this.#timezone;
    }
    const config = await loadRegionConfig(this.#userRepoDir);
    if (config) {
      this.#timezone = config.timezone;
    }
    return this.#timezone;
  }

  /**
   * Handle one inbound message in NoteCapture mode.
   * Returns outbound feedback text, or null when the message is ignored.
   */
  async handle(
    message: InboundMessengerMessage,
  ): Promise<NoteCaptureResult | null> {
    if (message.kind === "callback") {
      return null;
    }

    if (message.kind === "command") {
      return null;
    }

    const text = message.text?.trim();
    if (!text) {
      return null;
    }

    if (this.#awaitingTimezone) {
      return this.#completeTimezoneSetup(text);
    }

    const timezone = await this.ensureRegionLoaded();
    if (!timezone) {
      this.#awaitingTimezone = true;
      this.#pendingMessage = message;
      return {
        feedbackText:
          "Your timezone is not configured yet. Send a city (e.g. Moscow, Berlin) or IANA zone (Europe/Moscow).",
      };
    }

    return this.#captureNote(message, timezone);
  }

  async #completeTimezoneSetup(text: string): Promise<NoteCaptureResult> {
    const timezone = parseTimezoneInput(text);
    if (!timezone) {
      return {
        feedbackText:
          "Unknown timezone. Send a city (Moscow, Berlin) or IANA name (Europe/Moscow).",
      };
    }

    await saveRegionConfig(this.#userRepoDir, timezone);
    const relPath = GitWriteService.relativePath(
      this.#userRepoDir,
      regionConfigPath(this.#userRepoDir),
    );
    await this.#gitWriter.commitAndPush(
      [relPath],
      "note-agent: save user timezone",
    );

    this.#timezone = timezone;
    this.#awaitingTimezone = false;

    const pending = this.#pendingMessage;
    this.#pendingMessage = null;

    const parts: string[] = [`Timezone saved: ${timezone}.`];

    if (pending) {
      const captured = await this.#captureNote(pending, timezone);
      parts.push(captured.feedbackText);
      return { feedbackText: parts.join("\n\n"), write: captured.write };
    }

    return { feedbackText: parts.join("\n\n") };
  }

  async #captureNote(
    message: InboundMessengerMessage,
    timezone: string,
  ): Promise<NoteCaptureResult> {
    const raw = asInboundRaw(message.raw);
    const utcSeconds = raw.receivedAtUtc ?? Math.floor(Date.now() / 1000);
    const body = message.text?.trim() ?? "";
    const forwardFrom = raw.forwardFrom;

    if (isLongPost(body)) {
      return this.#captureLongPost(message, timezone, raw, body, forwardFrom);
    }

    let type: string | undefined;
    let note = body;

    if (raw.isForwarded) {
      const nick = forwardFrom ? `@${forwardFrom}` : "@unknown";
      type = `forwarded from ${nick}`;
      const originalPrefix = formatOriginalTimePrefix(
        raw.forwardDateUtc,
        timezone,
      );
      note = originalPrefix ? `${originalPrefix}${body}` : body;
    }

    const write = await this.#writer.appendEntry({
      utcSeconds,
      timezone,
      type,
      note,
    });

    return {
      feedbackText: formatCaptureFeedback(write),
      write,
    };
  }

  async #captureLongPost(
    _message: InboundMessengerMessage,
    timezone: string,
    raw: InboundRaw,
    body: string,
    forwardFrom: string | undefined,
  ): Promise<NoteCaptureResult> {
    if (!this.#longPostClient) {
      return {
        feedbackText:
          "Long post detected but the agent worker is unavailable. Try again later.",
      };
    }

    const utcSeconds = raw.receivedAtUtc ?? Math.floor(Date.now() / 1000);

    let longResult;
    try {
      longResult = await this.#longPostClient.process(body);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        feedbackText: `Long post processing failed: ${detail}`,
      };
    }

    const type = buildLongPostDailyType(
      longResult.fileName,
      Boolean(raw.isForwarded),
      forwardFrom,
    );

    const write = await this.#writer.appendEntry({
      utcSeconds,
      timezone,
      type,
      note: longResult.shortDescription,
    });

    return {
      feedbackText: formatLongPostFeedback(
        longResult.fileName,
        longResult.indexedRelativePath,
        write.fileName,
        write.line,
        longResult.shortDescription,
      ),
      write,
    };
  }
}

function asInboundRaw(raw: unknown): InboundRaw {
  if (raw && typeof raw === "object") {
    return raw as InboundRaw;
  }
  return {};
}

function formatOriginalTimePrefix(
  forwardDateUtc: number | undefined,
  timezone: string,
): string {
  if (forwardDateUtc == null) {
    return "";
  }
  const { hh, mm } = formatLocalClock(forwardDateUtc, timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    day: "2-digit",
    month: "numeric",
    year: "numeric",
  }).formatToParts(new Date(forwardDateUtc * 1000));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = Number.parseInt(lookup.day ?? "0", 10);
  const month = Number.parseInt(lookup.month ?? "0", 10);
  const year = Number.parseInt(lookup.year ?? "0", 10);
  const mmm = MONTH_ABBRS[month - 1] ?? "Jan";
  const dd = String(day).padStart(2, "0");
  return `[orig ${hh}:${mm} ${dd} ${mmm} ${year}] `;
}

export { formatCaptureFeedback };
