export interface LongPostClientResult {
  fileName: string;
  shortDescription: string;
  indexedRelativePath: string;
}

/** Gateway-side delegate for worker long-post IPC (P5). */
export interface LongPostClient {
  process(text: string): Promise<LongPostClientResult>;
}
