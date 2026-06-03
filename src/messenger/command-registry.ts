import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Built-in slash commands always available (not stored under config/commands/). */
export interface BuiltinSlashCommand {
  name: string;
  shortDescription: string;
  /** When true, only valid inside an agent dialog (e.g. /exit). */
  dialogOnly?: boolean;
}

export const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommand[] = [
  {
    name: "agent",
    shortDescription: "Open agent dialog (re-index KB, add commands, schedule tasks)",
  },
  {
    name: "commands",
    shortDescription: "List default and personal commands",
  },
  {
    name: "Schedule",
    shortDescription: "List scheduled analysis tasks",
  },
  {
    name: "exit",
    shortDescription: "End the current agent dialog",
    dialogOnly: true,
  },
];

export interface UserCommandDefinition {
  /** Slash name without leading slash (e.g. lastWeekHealthSum). */
  name: string;
  commandId?: string;
  period?: string;
  shortDescription: string;
  prompt?: string;
  /** Source file basename (CommandName.md). */
  fileName: string;
}

const FIELD_PATTERNS: Array<{
  key: keyof Pick<
    UserCommandDefinition,
    "name" | "commandId" | "period" | "shortDescription" | "prompt"
  >;
  labels: string[];
}> = [
  { key: "name", labels: ["commandname", "command name"] },
  { key: "commandId", labels: ["commandid", "command id"] },
  { key: "period", labels: ["period"] },
  { key: "shortDescription", labels: ["shortdescription", "short description"] },
  { key: "prompt", labels: ["prompt"] },
];

function normalizeFieldLabel(label: string): string {
  return label.replace(/^<|>$/g, "").trim().toLowerCase();
}

function parseFieldLine(
  line: string,
): { key: string; value: string } | null {
  const match = line.match(/^([^:]+):\s*(.+)$/);
  if (!match) {
    return null;
  }
  return { key: normalizeFieldLabel(match[1] ?? ""), value: (match[2] ?? "").trim() };
}

/** Parse one command markdown file from config/commands/. */
export function parseUserCommandFile(
  fileName: string,
  content: string,
): UserCommandDefinition | null {
  const baseName = fileName.replace(/\.md$/i, "");
  if (!baseName) {
    return null;
  }

  const fields: Partial<UserCommandDefinition> = {
    fileName,
    shortDescription: "",
  };

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const parsed = parseFieldLine(trimmed);
    if (!parsed) {
      continue;
    }
    for (const pattern of FIELD_PATTERNS) {
      if (pattern.labels.includes(parsed.key)) {
        (fields as Record<string, string>)[pattern.key] = parsed.value;
      }
    }
  }

  const name =
    fields.name?.replace(/^\//, "") ||
    baseName.charAt(0).toLowerCase() + baseName.slice(1);

  const shortDescription =
    fields.shortDescription?.trim() ||
    `Personal command (${name})`;

  return {
    name,
    commandId: fields.commandId,
    period: fields.period,
    shortDescription,
    prompt: fields.prompt,
    fileName,
  };
}

export interface CommandRegistrySnapshot {
  builtins: readonly BuiltinSlashCommand[];
  userCommands: UserCommandDefinition[];
}

export class CommandRegistry {
  readonly #commandsDir: string;
  #snapshot: CommandRegistrySnapshot = {
    builtins: BUILTIN_SLASH_COMMANDS,
    userCommands: [],
  };

  constructor(commandsDir: string) {
    this.#commandsDir = commandsDir;
  }

  get snapshot(): CommandRegistrySnapshot {
    return this.#snapshot;
  }

  /** Reload user commands from config/commands/*.md. */
  async reload(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.#commandsDir);
    } catch {
      this.#snapshot = {
        builtins: BUILTIN_SLASH_COMMANDS,
        userCommands: [],
      };
      return;
    }

    const userCommands: UserCommandDefinition[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".md")) {
        continue;
      }
      const content = await readFile(join(this.#commandsDir, entry), "utf8");
      const parsed = parseUserCommandFile(entry, content);
      if (parsed) {
        userCommands.push(parsed);
      }
    }
    userCommands.sort((a, b) => a.name.localeCompare(b.name));

    this.#snapshot = {
      builtins: BUILTIN_SLASH_COMMANDS,
      userCommands,
    };
  }

  findBuiltin(name: string): BuiltinSlashCommand | undefined {
    return BUILTIN_SLASH_COMMANDS.find((cmd) => cmd.name === name);
  }

  findUserCommand(name: string): UserCommandDefinition | undefined {
    return this.#snapshot.userCommands.find((cmd) => cmd.name === name);
  }

  isKnownCommand(name: string): boolean {
    return Boolean(this.findBuiltin(name) || this.findUserCommand(name));
  }

  /** Format for `/commands` listing: `/<name> - <shortDescription>`. */
  formatCommandsList(): string {
    const lines: string[] = [];
    for (const cmd of BUILTIN_SLASH_COMMANDS) {
      if (cmd.dialogOnly) {
        continue;
      }
      lines.push(`/${cmd.name} - ${cmd.shortDescription}`);
    }
    for (const cmd of this.#snapshot.userCommands) {
      lines.push(`/${cmd.name} - ${cmd.shortDescription}`);
    }
    if (lines.length === 0) {
      return "No commands registered.";
    }
    return lines.join("\n");
  }
}
