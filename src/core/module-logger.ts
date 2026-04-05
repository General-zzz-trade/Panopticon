/**
 * Module Logger — structured logging wrapper for optional cognitive modules.
 *
 * Replaces silent `catch {}` blocks with categorized log output.
 * Critical modules (persistence, DB) → warn level.
 * Optional modules (loop detection, exploration) → debug level.
 */

import { logger as pinoLogger } from "../logger";

export type ModuleCategory = "critical" | "optional";

const moduleLogger = pinoLogger.child({ component: "module" });

/**
 * Log a module failure at the appropriate level.
 */
export function logModuleError(
  module: string,
  category: ModuleCategory,
  error: unknown,
  context?: string
): void {
  const message = error instanceof Error ? error.message : String(error);
  const payload = { module, category, error: message, context };

  if (category === "critical") {
    moduleLogger.warn(payload, `[${module}] ${context ?? "operation failed"}`);
  } else {
    moduleLogger.debug(payload, `[${module}] ${context ?? "operation skipped"}`);
  }
}

/**
 * Wrap an optional operation — swallow errors but log them.
 */
export function tryOptional<T>(
  module: string,
  fn: () => T,
  context?: string
): T | undefined {
  try {
    return fn();
  } catch (error) {
    logModuleError(module, "optional", error, context);
    return undefined;
  }
}

/**
 * Async version of tryOptional.
 */
export async function tryOptionalAsync<T>(
  module: string,
  fn: () => Promise<T>,
  context?: string
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    logModuleError(module, "optional", error, context);
    return undefined;
  }
}

/**
 * Wrap a critical operation — swallow errors but warn about them.
 */
export function tryCritical<T>(
  module: string,
  fn: () => T,
  context?: string
): T | undefined {
  try {
    return fn();
  } catch (error) {
    logModuleError(module, "critical", error, context);
    return undefined;
  }
}

/**
 * Async version of tryCritical.
 */
export async function tryCriticalAsync<T>(
  module: string,
  fn: () => Promise<T>,
  context?: string
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    logModuleError(module, "critical", error, context);
    return undefined;
  }
}
