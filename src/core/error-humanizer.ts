/**
 * Error Humanizer — convert technical errors into user-friendly messages.
 */

interface ErrorPattern {
  test: RegExp;
  message: string;
}

const PATTERNS: ErrorPattern[] = [
  {
    test: /TimeoutError/i,
    message: "The page took too long to load. Try again or check if the site is accessible.",
  },
  {
    test: /net::ERR_NAME_NOT_RESOLVED/,
    message: "Could not find that website. Please check the URL.",
  },
  {
    test: /net::ERR_CONNECTION_REFUSED/,
    message: "The server refused the connection. It may be down.",
  },
  {
    test: /Target closed/i,
    message: "The browser window closed unexpectedly. Retrying...",
  },
  {
    test: /Execution context was destroyed/i,
    message: "The page navigated away during the action. Retrying...",
  },
  {
    test: /Element not found|no element found|selector/i,
    message: "Could not find the element on the page. The page layout may have changed.",
  },
  {
    test: /\b401\b/,
    message: "Authentication required. Please check your credentials.",
  },
  {
    test: /\b403\b/,
    message: "Access denied. You don't have permission.",
  },
  {
    test: /\b404\b/,
    message: "Page not found. The URL may be incorrect.",
  },
  {
    test: /\b500\b/,
    message: "The server encountered an error. Try again later.",
  },
  {
    test: /ECONNREFUSED/,
    message: "Cannot connect to the server.",
  },
];

/**
 * Convert a technical error into a short, user-friendly message.
 */
export function humanizeError(error: string | Error): string {
  const raw = error instanceof Error ? error.message : error;

  for (const pattern of PATTERNS) {
    if (pattern.test.test(raw)) {
      return pattern.message;
    }
  }

  // Default: strip stack traces, trim, and cap at 200 characters
  const cleaned = raw
    .replace(/\s+at\s+.+/g, "")       // remove stack trace lines
    .replace(/\n+/g, " ")              // collapse newlines
    .replace(/\s{2,}/g, " ")           // collapse whitespace
    .trim();

  if (cleaned.length <= 200) {
    return cleaned || "An unexpected error occurred.";
  }

  return cleaned.slice(0, 197) + "...";
}

/**
 * Wrap a full run result into a human-friendly summary.
 */
export function humanizeRunResult(result: { success: boolean; message: string }): string {
  if (result.success) {
    return result.message || "Completed successfully.";
  }

  return humanizeError(result.message);
}
