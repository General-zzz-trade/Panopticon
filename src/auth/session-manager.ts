/**
 * Session Manager — integrates with Playwright's BrowserContext
 * to save and restore browser sessions (cookies) across runs.
 */

import { logModuleError } from "../core/module-logger";
import type { BrowserContext } from "playwright";
import { loadSession, saveSession } from "./session-store";

/**
 * Restore saved session cookies into a browser context before navigating.
 * Returns true if a session was found and restored.
 */
export async function restoreSession(
  context: BrowserContext,
  tenantId: string,
  domain: string
): Promise<boolean> {
  const session = loadSession(tenantId, domain);
  if (!session) return false;

  try {
    const cookies = JSON.parse(session.cookies);
    if (Array.isArray(cookies) && cookies.length > 0) {
      await context.addCookies(cookies);
    }
    return true;
  } catch (error) {
    logModuleError("session-manager", "optional", error, "restoring session cookies");
    return false;
  }
}

/**
 * Capture current cookies from browser context and save them.
 * Filters cookies to only include those matching the target domain.
 */
export async function captureSession(
  context: BrowserContext,
  tenantId: string,
  domain: string
): Promise<void> {
  try {
    const allCookies = await context.cookies();
    // Filter cookies that belong to this domain (exact match or subdomain)
    const domainCookies = allCookies.filter(c => {
      const cookieDomain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
      return cookieDomain === domain || cookieDomain.endsWith(`.${domain}`);
    });

    if (domainCookies.length > 0) {
      saveSession(tenantId, domain, domainCookies);
    }
  } catch (error) {
    logModuleError("session-manager", "optional", error, "capturing session cookies");
  }
}

/**
 * Extract the effective domain from a URL string.
 * e.g., "https://www.github.com/login" => "github.com"
 */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Strip leading "www."
    return hostname.replace(/^www\./, "");
  } catch (error) {
    logModuleError("session-manager", "optional", error, "extracting domain from URL");
    return url;
  }
}

/**
 * Heuristic: check if a selector likely targets a password field.
 */
export function isPasswordSelector(selector: string): boolean {
  const lower = selector.toLowerCase();
  return (
    lower.includes("password") ||
    lower.includes("passwd") ||
    lower.includes("[type=\"password\"]") ||
    lower.includes("[type='password']") ||
    lower.includes("type=password")
  );
}
