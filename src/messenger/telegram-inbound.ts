import type {
  InboundMessageKind,
  InboundMessengerMessage,
  MessengerChatId,
  MessengerMessageId,
  MessengerUserId,
} from "./types.js";

/** Subset of Telegram Bot API types used for inbound mapping. */
export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessageEntity {
  offset: number;
  length: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  forward_from?: TelegramUser;
  forward_date?: number;
  forward_origin?: {
    type: string;
    sender_user?: TelegramUser;
    chat?: TelegramChat;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface ParsedTelegramCommand {
  name: string;
  args: string;
}

/** Extract slash command name and trailing args from a Telegram text message. */
export function parseTelegramBotCommand(
  text: string,
  entities?: TelegramMessageEntity[],
): ParsedTelegramCommand | null {
  if (!entities?.length) {
    return null;
  }
  const entity = entities.find(
    (item) => item.type === "bot_command" && item.offset === 0,
  );
  if (!entity) {
    return null;
  }
  const token = text.slice(entity.offset, entity.offset + entity.length);
  if (!token.startsWith("/")) {
    return null;
  }
  let name = token.slice(1);
  const at = name.indexOf("@");
  if (at >= 0) {
    name = name.slice(0, at);
  }
  if (!name) {
    return null;
  }
  const args = text.slice(entity.offset + entity.length).trim();
  return { name, args };
}

function messengerUserId(user: TelegramUser): MessengerUserId {
  return String(user.id);
}

function messengerChatId(chat: TelegramChat): MessengerChatId {
  return String(chat.id);
}

function messengerMessageId(id: number): MessengerMessageId {
  return String(id);
}

function forwardNick(message: TelegramMessage): string | undefined {
  const legacy = message.forward_from?.username;
  if (legacy) {
    return legacy;
  }
  const originUser = message.forward_origin?.sender_user?.username;
  if (originUser) {
    return originUser;
  }
  return undefined;
}

function mapTextMessage(
  message: TelegramMessage,
): Omit<InboundMessengerMessage, "isAdmin"> | null {
  const user = message.from;
  if (!user || user.is_bot) {
    return null;
  }

  const body = message.text ?? message.caption ?? "";
  const parsed = parseTelegramBotCommand(body, message.entities);
  let kind: InboundMessageKind = "text";
  let command: string | undefined;
  let text = body || undefined;

  if (parsed) {
    kind = "command";
    command = parsed.name;
    text = parsed.args || undefined;
  }

  const forwardFrom = forwardNick(message);
  const isForwarded =
    forwardFrom !== undefined ||
    message.forward_from != null ||
    message.forward_origin != null ||
    message.forward_date != null;

  return {
    kind,
    userId: messengerUserId(user),
    chatId: messengerChatId(message.chat),
    messageId: messengerMessageId(message.message_id),
    text,
    command,
    raw: {
      telegramMessage: message,
      isForwarded,
      forwardFrom,
      forwardDateUtc: message.forward_date,
      receivedAtUtc: message.date,
    },
  };
}

function mapCallbackQuery(
  query: TelegramCallbackQuery,
): Omit<InboundMessengerMessage, "isAdmin"> | null {
  if (query.from.is_bot) {
    return null;
  }
  const chat = query.message?.chat;
  const chatId = chat ? messengerChatId(chat) : messengerUserId(query.from);

  return {
    kind: "callback",
    userId: messengerUserId(query.from),
    chatId,
    messageId: query.message
      ? messengerMessageId(query.message.message_id)
      : undefined,
    callbackData: query.data,
    raw: { telegramCallbackQueryId: query.id },
  };
}

/** Map one Telegram `Update` to a normalized inbound message, or null when ignored. */
export function fromTelegramUpdate(
  update: TelegramUpdate,
): Omit<InboundMessengerMessage, "isAdmin"> | null {
  if (update.callback_query) {
    return mapCallbackQuery(update.callback_query);
  }
  const message = update.message ?? update.edited_message;
  if (message) {
    return mapTextMessage(message);
  }
  return null;
}
