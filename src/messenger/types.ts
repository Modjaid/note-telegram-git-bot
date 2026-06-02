/**
 * Messenger-agnostic message types.
 * Outbound keyboard shape maps cleanly to Telegram `InlineKeyboardMarkup`.
 */

/** Stable user identifier within a messenger (e.g. Telegram numeric id as string). */
export type MessengerUserId = string;

/** Conversation / chat identifier (private chat, group, channel). */
export type MessengerChatId = string;

/** Platform-specific message id for edits/replies (optional). */
export type MessengerMessageId = string;

/**
 * One inline button. Telegram mapping:
 * - `callbackData` → `callback_data` (max 64 bytes)
 * - `url` → `url`
 * - `webAppUrl` → `web_app.url`
 */
export interface InlineKeyboardButton {
  text: string;
  callbackData?: string;
  url?: string;
  webAppUrl?: string;
}

/**
 * Inline keyboard as rows of buttons.
 * Telegram: `{ inline_keyboard: rows.map(row => row.map(toTelegramButton)) }`
 */
export interface InlineKeyboard {
  /** Each inner array is one horizontal row. */
  rows: InlineKeyboardButton[][];
}

export type OutboundParseMode = "plain" | "HTML" | "Markdown" | "MarkdownV2";

/** Payload the agent (or handler) returns to send back to the user. */
export interface OutboundMessengerMessage {
  chatId: MessengerChatId;
  text: string;
  parseMode?: OutboundParseMode;
  /** Omit for text-only replies. */
  inlineKeyboard?: InlineKeyboard;
  /** Reply in-thread when the platform supports it. */
  replyToMessageId?: MessengerMessageId;
  /** Replace an existing message instead of sending a new one. */
  editMessageId?: MessengerMessageId;
  /** Hide preview for links (Telegram: disable_web_page_preview). */
  disableLinkPreview?: boolean;
}

export type InboundMessageKind = "text" | "callback" | "command";

/** Normalized inbound event from any messenger adapter. */
export interface InboundMessengerMessage {
  kind: InboundMessageKind;
  userId: MessengerUserId;
  chatId: MessengerChatId;
  messageId?: MessengerMessageId;
  /** Plain text body or command argument string. */
  text?: string;
  /** For `kind === "command"`, name without leading slash (e.g. `start`). */
  command?: string;
  /** For `kind === "callback"`, data from inline button press. */
  callbackData?: string;
  /** True if `userId` is in the handler admin list. */
  isAdmin: boolean;
  /** Opaque adapter payload for platform-specific follow-up. */
  raw?: unknown;
}

/** Result of access check before handling. */
export type AccessDecision =
  | { allowed: true; isAdmin: boolean }
  | { allowed: false; reason: "not_in_allowlist" | "blocked" };
