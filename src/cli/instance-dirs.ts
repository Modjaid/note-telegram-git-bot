import { mkdir } from "node:fs/promises";
import {
  instanceDataDir,
  instanceRagDir,
  instanceUserRepoDir,
} from "../paths/index.js";

/** Create host bind-mount directories for a new instance (P1-T05). */
export async function ensureInstanceHostDirs(
  containerName: string,
): Promise<{ userRepo: string; rag: string }> {
  const userRepo = instanceUserRepoDir(containerName);
  const rag = instanceRagDir(containerName);
  await mkdir(instanceDataDir(containerName), { recursive: true });
  await mkdir(userRepo, { recursive: true });
  await mkdir(rag, { recursive: true });
  return { userRepo, rag };
}
