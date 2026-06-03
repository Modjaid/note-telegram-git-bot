import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface PromptSession {
  question(prompt: string): Promise<string>;
  choose<T extends string>(
    prompt: string,
    choices: readonly { key: T; label: string }[],
  ): Promise<T>;
  chooseIndex(prompt: string, labels: string[]): Promise<number>;
  close(): void;
}

export function createPromptSession(): PromptSession {
  const rl = readline.createInterface({ input, output });

  return {
    async question(prompt: string): Promise<string> {
      const answer = await rl.question(prompt);
      return answer.trim();
    },

    async choose<T extends string>(
      prompt: string,
      choices: readonly { key: T; label: string }[],
    ): Promise<T> {
      console.log(prompt);
      for (const c of choices) {
        console.log(`  ${c.key}) ${c.label}`);
      }
      for (;;) {
        const raw = (await rl.question("> ")).trim().toLowerCase();
        const hit = choices.find((c) => c.key.toLowerCase() === raw);
        if (hit) {
          return hit.key;
        }
        console.log("Invalid choice. Try again.");
      }
    },

    async chooseIndex(prompt: string, labels: string[]): Promise<number> {
      if (labels.length === 0) {
        throw new Error("No options to choose from");
      }
      console.log(prompt);
      labels.forEach((label, i) => {
        console.log(`  ${i + 1}) ${label}`);
      });
      for (;;) {
        const raw = (await rl.question("> ")).trim();
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 1 && n <= labels.length) {
          return n - 1;
        }
        console.log(`Enter a number from 1 to ${labels.length}.`);
      }
    },

    close(): void {
      rl.close();
    },
  };
}

export async function promptNonEmpty(
  session: PromptSession,
  label: string,
): Promise<string> {
  for (;;) {
    const value = await session.question(`${label}: `);
    if (value.length > 0) {
      return value;
    }
    console.log("Value cannot be empty.");
  }
}

export async function promptOptional(
  session: PromptSession,
  label: string,
  hint?: string,
): Promise<string | undefined> {
  const suffix = hint ? ` (${hint})` : "";
  const value = await session.question(`${label}${suffix}: `);
  return value.length > 0 ? value : undefined;
}

export async function promptWithDefault(
  session: PromptSession,
  label: string,
  defaultValue: string,
): Promise<string> {
  const value = await session.question(
    `${label} (press Enter for default) [${defaultValue}]: `,
  );
  return value.length > 0 ? value : defaultValue;
}

export async function confirm(
  session: PromptSession,
  message: string,
): Promise<boolean> {
  const answer = await session.choose(message, [
    { key: "y", label: "Yes" },
    { key: "n", label: "No" },
  ] as const);
  return answer === "y";
}
