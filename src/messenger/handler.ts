import type {
  AccessDecision,
  InboundMessengerMessage,
  MessengerUserId,
  OutboundMessengerMessage,
} from "./types.js";

export interface MessengerHandlerConfig {
  /**
   * Users whose messages are processed. Everyone else is ignored (no reply).
   * Admins should typically be included here if they need bot access.
   */
  allowedUserIds: Iterable<MessengerUserId>;
  /** Users with elevated privileges (e.g. admin-only commands). */
  adminUserIds?: Iterable<MessengerUserId>;
  /**
   * Optional explicit blocklist applied after allowlist check.
   * Useful for banning without changing the allowlist file.
   */
  blockedUserIds?: Iterable<MessengerUserId>;
}

export interface MessengerAgentBridge {
  /**
   * Run the agent for an authorized inbound message.
   * Implementations wire this to ADK or another runtime.
   */
  run(
    message: InboundMessengerMessage,
  ): Promise<OutboundMessengerMessage | OutboundMessengerMessage[] | null>;
}

export interface MessengerHandlerOptions extends MessengerHandlerConfig {
  agent: MessengerAgentBridge;
  /**
   * Called when a non-allowed user writes. Return a reply to send, or null/undefined
   * to stay silent (default).
   */
  onRejected?: (
    message: InboundMessengerMessage,
    decision: Extract<AccessDecision, { allowed: false }>,
  ) => Promise<OutboundMessengerMessage | null | undefined>;
}

/**
 * Shared access control + inbound/outbound pipeline for messenger adapters.
 */
export class MessengerHandler {
  readonly #allowed: ReadonlySet<MessengerUserId>;
  readonly #admins: ReadonlySet<MessengerUserId>;
  readonly #blocked: ReadonlySet<MessengerUserId>;
  readonly #agent: MessengerAgentBridge;
  readonly #onRejected?: MessengerHandlerOptions["onRejected"];

  constructor(options: MessengerHandlerOptions) {
    this.#allowed = new Set(options.allowedUserIds);
    this.#admins = new Set(options.adminUserIds ?? []);
    this.#blocked = new Set(options.blockedUserIds ?? []);
    this.#agent = options.agent;
    this.#onRejected = options.onRejected;
  }

  get allowedUserIds(): ReadonlySet<MessengerUserId> {
    return this.#allowed;
  }

  get adminUserIds(): ReadonlySet<MessengerUserId> {
    return this.#admins;
  }

  isAdmin(userId: MessengerUserId): boolean {
    return this.#admins.has(userId);
  }

  checkAccess(userId: MessengerUserId): AccessDecision {
    if (this.#blocked.has(userId)) {
      return { allowed: false, reason: "blocked" };
    }
    if (!this.#allowed.has(userId)) {
      return { allowed: false, reason: "not_in_allowlist" };
    }
    return { allowed: true, isAdmin: this.isAdmin(userId) };
  }

  /**
   * Enrich inbound with `isAdmin` and run the agent if allowed.
   * Returns outbound message(s) or null when the event should be ignored.
   */
  async handle(
    inbound: Omit<InboundMessengerMessage, "isAdmin">,
  ): Promise<OutboundMessengerMessage | OutboundMessengerMessage[] | null> {
    const access = this.checkAccess(inbound.userId);

    if (!access.allowed) {
      const enriched: InboundMessengerMessage = {
        ...inbound,
        isAdmin: false,
      };
      if (this.#onRejected) {
        const reply = await this.#onRejected(enriched, access);
        return reply ?? null;
      }
      return null;
    }

    const enriched: InboundMessengerMessage = {
      ...inbound,
      isAdmin: access.isAdmin,
    };

    const result = await this.#agent.run(enriched);
    if (result == null) {
      return null;
    }
    return result;
  }

  /** Normalize handle() result to a flat array (convenience for adapters). */
  async handleMany(
    inbound: Omit<InboundMessengerMessage, "isAdmin">,
  ): Promise<OutboundMessengerMessage[]> {
    const result = await this.handle(inbound);
    if (result == null) {
      return [];
    }
    return Array.isArray(result) ? result : [result];
  }
}
