import { randomUUID } from "node:crypto";
import type { AgentIpcClient } from "../ipc/client.js";
import {
  CommandRegistry,
  type UserCommandDefinition,
} from "../../messenger/command-registry.js";
import type { MessengerAgentBridge } from "../../messenger/handler.js";
import type {
  InboundMessengerMessage,
  OutboundMessengerMessage,
} from "../../messenger/types.js";
import { NoteCaptureService } from "../../note-log/capture.js";

export const DIALOG_TIMEOUT_MS = 3 * 60 * 1000;

export type HandlerMode = "NoteCapture" | "AgentDialog";

export interface AgentDialogState {
  mode: "AgentDialog";
  sessionId: string;
  entryCommand: string;
  lastActivityAt: number;
}

export interface GatewayAgentBridgeOptions {
  ipc: AgentIpcClient;
  commandRegistry: CommandRegistry;
  noteCapture: NoteCaptureService;
  onModeChange?: (mode: HandlerMode) => void;
  /** Called when the 3-minute dialog window expires (P3-T05). */
  onDialogTimeout?: (message: OutboundMessengerMessage) => void | Promise<void>;
}

/**
 * Gateway-side agent bridge: NoteCapture ↔ AgentDialog state machine,
 * slash routing, 3-minute dialog timeout, IPC delegation for agent work.
 */
export class GatewayAgentBridge implements MessengerAgentBridge {
  readonly #ipc: AgentIpcClient;
  readonly #commandRegistry: CommandRegistry;
  readonly #noteCapture: NoteCaptureService;
  readonly #onModeChange?: GatewayAgentBridgeOptions["onModeChange"];
  readonly #onDialogTimeout?: GatewayAgentBridgeOptions["onDialogTimeout"];

  #mode: HandlerMode = "NoteCapture";
  #dialog: AgentDialogState | null = null;
  #timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  #timeoutChatId: string | null = null;

  constructor(options: GatewayAgentBridgeOptions) {
    this.#ipc = options.ipc;
    this.#commandRegistry = options.commandRegistry;
    this.#noteCapture = options.noteCapture;
    this.#onModeChange = options.onModeChange;
    this.#onDialogTimeout = options.onDialogTimeout;
  }

  get mode(): HandlerMode {
    return this.#mode;
  }

  get dialogState(): AgentDialogState | null {
    return this.#dialog;
  }

  async run(
    message: InboundMessengerMessage,
  ): Promise<OutboundMessengerMessage | OutboundMessengerMessage[] | null> {
    if (message.kind === "command" && message.command) {
      return this.#routeSlashCommand(message);
    }

    if (this.#mode === "AgentDialog") {
      return this.#handleDialogMessage(message);
    }

    const captured = await this.#noteCapture.handle(message);
    if (captured) {
      return this.#reply(message, captured.feedbackText);
    }
    return null;
  }

  async #routeSlashCommand(
    message: InboundMessengerMessage,
  ): Promise<OutboundMessengerMessage | OutboundMessengerMessage[] | null> {
    const name = message.command ?? "";
    await this.#commandRegistry.reload();

    if (name === "exit") {
      return this.#handleExit(message);
    }

    if (this.#mode === "AgentDialog" && name !== "exit") {
      // Inside dialog, non-exit slash commands still route (e.g. mistyped /commands).
      this.#touchDialog(message.chatId);
    }

    const builtin = this.#commandRegistry.findBuiltin(name);
    if (builtin?.dialogOnly && this.#mode !== "AgentDialog") {
      return this.#reply(message, "Use /exit only during an agent dialog.");
    }

    switch (name) {
      case "agent":
        return this.#enterAgentDialog(message, "agent");
      case "commands":
        return this.#reply(message, this.#commandRegistry.formatCommandsList());
      case "Schedule":
        return this.#reply(
          message,
          "No scheduled tasks yet. Use /agent to create a task (Phase 9).",
        );
      default: {
        const userCmd = this.#commandRegistry.findUserCommand(name);
        if (userCmd) {
          return this.#enterUserCommandDialog(message, userCmd);
        }
        if (this.#mode === "AgentDialog") {
          return this.#handleDialogMessage(message);
        }
        return this.#reply(
          message,
          `Unknown command /${name}. Try /commands for the list.`,
        );
      }
    }
  }

  async #enterAgentDialog(
    message: InboundMessengerMessage,
    entryCommand: string,
  ): Promise<OutboundMessengerMessage> {
    this.#startDialog(message.chatId, entryCommand);
    return this.#reply(message, appendExitHint("The agent is listening."));
  }

  async #enterUserCommandDialog(
    message: InboundMessengerMessage,
    command: UserCommandDefinition,
  ): Promise<OutboundMessengerMessage | OutboundMessengerMessage[] | null> {
    this.#startDialog(message.chatId, command.name);
    try {
      const response = await this.#ipc.dialog({
        type: "dialog",
        sessionId: this.#dialog?.sessionId,
        message: {
          ...message,
          raw: { ...asRecord(message.raw), userCommand: command },
        },
      });
      const replies = normalizeReplies(message.chatId, response.replies);
      if (replies.length === 0) {
        return this.#reply(
          message,
          appendExitHint(
            `Running /${command.name} (full execution in Phase 8).`,
          ),
        );
      }
      return replies;
    } catch (error) {
      this.#endDialog();
      const text =
        error instanceof Error ? error.message : String(error);
      return this.#reply(message, `Agent worker unavailable: ${text}`);
    }
  }

  async #handleDialogMessage(
    message: InboundMessengerMessage,
  ): Promise<OutboundMessengerMessage | OutboundMessengerMessage[] | null> {
    if (!this.#dialog) {
      this.#setMode("NoteCapture");
      return null;
    }

    this.#touchDialog(message.chatId);

    try {
      const response = await this.#ipc.dialog({
        type: "dialog",
        sessionId: this.#dialog.sessionId,
        message,
      });
      return normalizeReplies(message.chatId, response.replies);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : String(error);
      return this.#reply(message, `Agent worker unavailable: ${text}`);
    }
  }

  #handleExit(
    message: InboundMessengerMessage,
  ): OutboundMessengerMessage | null {
    if (this.#mode !== "AgentDialog") {
      return this.#reply(message, "No active agent dialog.");
    }
    this.#endDialog();
    return this.#reply(message, "Agent dialog ended. Notes are captured again.");
  }

  #startDialog(chatId: string, entryCommand: string): void {
    this.#dialog = {
      mode: "AgentDialog",
      sessionId: randomUUID(),
      entryCommand,
      lastActivityAt: Date.now(),
    };
    this.#setMode("AgentDialog");
    this.#armTimeout(chatId);
  }

  #touchDialog(chatId: string): void {
    if (!this.#dialog) {
      return;
    }
    this.#dialog.lastActivityAt = Date.now();
    this.#armTimeout(chatId);
  }

  #armTimeout(chatId: string): void {
    this.#timeoutChatId = chatId;
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
    }
    this.#timeoutTimer = setTimeout(() => {
      this.#onDialogTimeoutFired();
    }, DIALOG_TIMEOUT_MS);
  }

  #onDialogTimeoutFired(): void {
    if (this.#mode !== "AgentDialog" || !this.#timeoutChatId) {
      return;
    }
    const chatId = this.#timeoutChatId;
    this.#endDialog();
    const notice: OutboundMessengerMessage = {
      chatId,
      text: "Dialog timed out after 3 minutes. Back to note capture.",
    };
    void this.#onDialogTimeout?.(notice);
  }

  #endDialog(): void {
    this.#dialog = null;
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = null;
    }
    this.#timeoutChatId = null;
    this.#setMode("NoteCapture");
  }

  #setMode(mode: HandlerMode): void {
    this.#mode = mode;
    this.#onModeChange?.(mode);
  }

  #reply(
    message: InboundMessengerMessage,
    text: string,
  ): OutboundMessengerMessage {
    return { chatId: message.chatId, text };
  }
}

function appendExitHint(text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed.endsWith("/exit")) {
    return trimmed;
  }
  return `${trimmed}\n/exit`;
}

function normalizeReplies(
  chatId: string,
  replies: OutboundMessengerMessage[] | null,
): OutboundMessengerMessage[] {
  if (!replies?.length) {
    return [];
  }
  return replies.map((reply) => ({
    ...reply,
    chatId: reply.chatId || chatId,
    text: appendExitHint(reply.text),
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}
