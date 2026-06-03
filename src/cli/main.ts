import { warnIfDockerUnavailable } from "./docker.js";
import { runMainMenu } from "./menu.js";

export { getPackageRoot, getVersion } from "./package-info.js";

export async function main(): Promise<void> {
  await warnIfDockerUnavailable();
  await runMainMenu();
}
