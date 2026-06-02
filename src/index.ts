import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function getVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

export async function main(): Promise<void> {
  console.log(`note-agent v${getVersion()}`);
  console.log("CLI scaffold ready. Container management will be added next.");
}
