import { logModuleError } from "../core/module-logger";

const RETRYABLE_PATTERNS = [
  /TimeoutError/i,
  /NavigationError/i,
  /Target closed/i,
  /net::ERR_/i,
  /Navigation timeout/i,
  /Execution context was destroyed/i,
  /Session closed/i,
  /Protocol error/i
];

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return RETRYABLE_PATTERNS.some(
    (pattern) => pattern.test(message) || pattern.test(name)
  );
}

export interface BrowserRetryOptions {
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Wraps a browser operation with automatic retry on transient errors.
 * Retries on TimeoutError, NavigationError, and "Target closed" errors.
 *
 * @param fn - The async function to execute
 * @param opts - Options: maxRetries (default 2), retryDelay in ms (default 1000)
 * @returns The result of fn
 */
export async function withBrowserRetry<T>(
  fn: () => Promise<T>,
  opts?: BrowserRetryOptions
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2;
  const retryDelay = opts?.retryDelay ?? 1000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }

      logModuleError(
        "browser-retry",
        "optional",
        error,
        `Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${retryDelay}ms`
      );

      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
