import {
  toTelegramEditMessageText,
  toTelegramSendMessage,
  type TelegramSendMessageParams,
} from "./telegram.js";
import type { OutboundMessengerMessage } from "./types.js";
import type { TelegramUpdate } from "./telegram-inbound.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramApiOptions {
  botToken: string;
  /** Abort long-poll after this many seconds (Telegram allows up to 50). */
  longPollTimeoutSec?: number;
}

export interface TelegramGetUpdatesResult {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
}

export class TelegramApiError extends Error {
  readonly method: string;
  readonly statusCode?: number;

  constructor(method: string, message: string, statusCode?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.method = method;
    this.statusCode = statusCode;
  }
}

export class TelegramBotApi {
  readonly #token: string;
  readonly #longPollTimeoutSec: number;

  constructor(options: TelegramApiOptions) {
    this.#token = options.botToken;
    this.#longPollTimeoutSec = options.longPollTimeoutSec ?? 50;
  }

  async deleteWebhook(): Promise<void> {
    await this.#call("deleteWebhook", { drop_pending_updates: false });
  }

  async getUpdates(offset: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    const response = (await this.#call(
      "getUpdates",
      {
        offset,
        timeout: this.#longPollTimeoutSec,
        allowed_updates: ["message", "edited_message", "callback_query"],
      },
      signal,
    )) as TelegramGetUpdatesResult;

    if (!response.ok) {
      throw new TelegramApiError(
        "getUpdates",
        response.description ?? "Telegram getUpdates failed",
      );
    }
    return response.result ?? [];
  }

  async sendMessage(params: TelegramSendMessageParams): Promise<void> {
    await this.#call("sendMessage", params);
  }

  async editMessageText(
    params: ReturnType<typeof toTelegramEditMessageText>,
  ): Promise<void> {
    await this.#call("editMessageText", params);
  }

  async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await this.#call("answerCallbackQuery", { callback_query_id: callbackQueryId });
  }

  /** Deliver one outbound messenger payload via sendMessage or editMessageText. */
  async sendOutbound(message: OutboundMessengerMessage): Promise<void> {
    if (message.editMessageId != null) {
      await this.editMessageText(toTelegramEditMessageText(message));
      return;
    }
    await this.sendMessage(toTelegramSendMessage(message));
  }

  async #call(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = `${TELEGRAM_API_BASE}/bot${this.#token}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });

    const json = (await res.json()) as {
      ok: boolean;
      description?: string;
    };

    if (!res.ok || !json.ok) {
      throw new TelegramApiError(
        method,
        json.description ?? `Telegram API HTTP ${res.status}`,
        res.status,
      );
    }
    return json;
  }
}
