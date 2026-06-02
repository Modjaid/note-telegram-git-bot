import { MessengerHandler } from "./handler.js";
import type {
  InboundMessengerMessage,
  OutboundMessengerMessage,
} from "./types.js";

/**
 * Minimal example: wire your ADK agent in `run()` and return structured replies.
 */
const handler = new MessengerHandler({
  allowedUserIds: ["123456789", "987654321"],
  adminUserIds: ["123456789"],
  agent: {
    async run(
      message: InboundMessengerMessage,
    ): Promise<OutboundMessengerMessage> {
      const prefix = message.isAdmin ? "[admin] " : "";

      if (message.kind === "callback" && message.callbackData === "action:help") {
        return {
          chatId: message.chatId,
          text: `${prefix}Help: pick an option below.`,
          inlineKeyboard: {
            rows: [
              [
                { text: "Notes", callbackData: "action:notes" },
                { text: "Settings", callbackData: "action:settings" },
              ],
              [{ text: "Docs", url: "https://adk.dev" }],
            ],
          },
          editMessageId: message.messageId,
        };
      }

      return {
        chatId: message.chatId,
        text: `${prefix}You said: ${message.text ?? "(no text)"}`,
        inlineKeyboard: {
          rows: [[{ text: "Help", callbackData: "action:help" }]],
        },
      };
    },
  },
});

export { handler };
