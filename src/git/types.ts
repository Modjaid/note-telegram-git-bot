export interface GitWriteResult {
  committed: boolean;
  pushed: boolean;
  message: string;
}

export interface GitSyncResult {
  cloned: boolean;
  pulled: boolean;
  branch: string;
  message: string;
}
