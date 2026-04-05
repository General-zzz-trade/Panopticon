import { logModuleError } from "./core/module-logger";

export interface WaitForServerOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitForServer(url: string, options: WaitForServerOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch (error) {
      logModuleError("wait-for-server", "optional", error, `waiting for server at ${url}`);
    }

    await delay(intervalMs);
  }

  throw new Error(`Server did not become available within ${timeoutMs}ms: ${url}`);
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
