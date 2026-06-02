import type {
  InlineKeyboard,
  InlineKeyboardButton,
  OutboundMessengerMessage,
  OutboundParseMode,
} from "./types.js";

/** Subset of Telegram Bot API `InlineKeyboardButton`. */
export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramSendMessageParams {
  chat_id: string | number;
  text: string;
  parse_mode?: string;
  reply_markup?: TelegramInlineKeyboardMarkup;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
}

export interface TelegramEditMessageTextParams {
  chat_id: string | number;
  message_id: number;
  text: string;
  parse_mode?: string;
  reply_markup?: TelegramInlineKeyboardMarkup;
  disable_web_page_preview?: boolean;
}

const PARSE_MODE_MAP: Record<OutboundParseMode, string | undefined> = {
  plain: undefined,
  HTML: "HTML",
  Markdown: "Markdown",
  MarkdownV2: "MarkdownV2",
};

export function toTelegramInlineKeyboardButton(
  button: InlineKeyboardButton,
): TelegramInlineKeyboardButton {
  const row: TelegramInlineKeyboardButton = { text: button.text };
  if (button.callbackData != null) {
    row.callback_data = button.callbackData;
  }
  if (button.url != null) {
    row.url = button.url;
  }
  if (button.webAppUrl != null) {
    row.web_app = { url: button.webAppUrl };
  }
  return row;
}

export function toTelegramInlineKeyboard(
  keyboard: InlineKeyboard,
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: keyboard.rows.map((row) =>
      row.map(toTelegramInlineKeyboardButton),
    ),
  };
}

/** Map outbound agent message → Telegram `sendMessage` params. */
export function toTelegramSendMessage(
  message: OutboundMessengerMessage,
): TelegramSendMessageParams {
  const params: TelegramSendMessageParams = {
    chat_id: message.chatId,
    text: message.text,
  };

  const parseMode = message.parseMode
    ? PARSE_MODE_MAP[message.parseMode]
    : undefined;
  if (parseMode) {
    params.parse_mode = parseMode;
  }

  if (message.inlineKeyboard) {
    params.reply_markup = toTelegramInlineKeyboard(message.inlineKeyboard);
  }

  if (message.replyToMessageId != null) {
    params.reply_to_message_id = Number(message.replyToMessageId);
  }

  if (message.disableLinkPreview) {
    params.disable_web_page_preview = true;
  }

  return params;
}

/** Map outbound agent message → Telegram `editMessageText` params. */
export function toTelegramEditMessageText(
  message: OutboundMessengerMessage,
): TelegramEditMessageTextParams {
  if (message.editMessageId == null) {
    throw new Error("editMessageId is required for editMessageText");
  }

  const params: TelegramEditMessageTextParams = {
    chat_id: message.chatId,
    message_id: Number(message.editMessageId),
    text: message.text,
  };

  const parseMode = message.parseMode
    ? PARSE_MODE_MAP[message.parseMode]
    : undefined;
  if (parseMode) {
    params.parse_mode = parseMode;
  }

  if (message.inlineKeyboard) {
    params.reply_markup = toTelegramInlineKeyboard(message.inlineKeyboard);
  }

  if (message.disableLinkPreview) {
    params.disable_web_page_preview = true;
  }

  return params;
}
