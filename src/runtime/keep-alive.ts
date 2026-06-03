/**
 * Keep the Node process running. A never-resolving Promise alone does not
 * hold the event loop open in Node 20+; use a ref'd timer (or an active server).
 */
export function holdProcessOpen(): void {
  const hold = setInterval(() => {}, 60 * 60 * 1000);
  if (typeof hold.unref === "function") {
    // Keep the interval ref'd (default); do not call unref().
  }
}
