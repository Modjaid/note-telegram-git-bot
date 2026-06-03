import { TelegramBotApi } from "./telegram-api.js";
import { fromTelegramUpdate } from "./telegram-inbound.js";
import type { OutboundMessengerMessage } from "./types.js";
import type { MessengerHandler } from "./handler.js";

export interface TelegramLongPollerOptions {
  api: TelegramBotApi;
  handler: MessengerHandler;
  /** Called for each outbound message after handler processing. */
  deliver: (message: OutboundMessengerMessage) => Promise<void>;
  onPollError?: (error: Error) => void;
}

/**
 * Telegram long-polling loop (Q5): `getUpdates` → handler → send path.
 */
export class TelegramLongPoller {
  readonly #api: TelegramBotApi;
  readonly #handler: MessengerHandler;
  readonly #deliver: TelegramLongPollerOptions["deliver"];
  readonly #onPollError?: TelegramLongPollerOptions["onPollError"];

  #offset = 0;
  #running = false;
  #abortController: AbortController | null = null;
  #loopPromise: Promise<void> | null = null;

  constructor(options: TelegramLongPollerOptions) {
    this.#api = options.api;
    this.#handler = options.handler;
    this.#deliver = options.deliver;
    this.#onPollError = options.onPollError;
  }

  get isRunning(): boolean {
    return this.#running;
  }

  async start(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    await this.#api.deleteWebhook();
    this.#loopPromise = this.#runLoop();
  }

  async stop(): Promise<void> {
    this.#running = false;
    this.#abortController?.abort();
    await this.#loopPromise;
    this.#loopPromise = null;
  }

  async #runLoop(): Promise<void> {
    while (this.#running) {
      this.#abortController = new AbortController();
      try {
        const updates = await this.#api.getUpdates(
          this.#offset,
          this.#abortController.signal,
        );
        for (const update of updates) {
          this.#offset = Math.max(this.#offset, update.update_id + 1);
          await this.#processUpdate(update);
        }
      } catch (error) {
        if (!this.#running) {
          break;
        }
        if (error instanceof Error && error.name === "AbortError") {
          break;
        }
        const err =
          error instanceof Error ? error : new Error(String(error));
        this.#onPollError?.(err);
        await sleep(3000);
      }
    }
  }

  async #processUpdate(update: import("./telegram-inbound.js").TelegramUpdate): Promise<void> {
    const inbound = fromTelegramUpdate(update);
    if (!inbound) {
      return;
    }

    const outbounds = await this.#handler.handleMany(inbound);

    if (
      inbound.kind === "callback" &&
      inbound.raw &&
      typeof inbound.raw === "object" &&
      "telegramCallbackQueryId" in inbound.raw
    ) {
      const queryId = (inbound.raw as { telegramCallbackQueryId: string })
        .telegramCallbackQueryId;
      try {
        await this.#api.answerCallbackQuery(queryId);
      } catch {
        // Non-fatal: reply still sent below.
      }
    }

    for (const outbound of outbounds) {
      await this.#deliver(outbound);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
