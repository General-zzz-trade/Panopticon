import { TaskBlueprint } from "./task-id";

export function matchTemplatePlan(goal: string): TaskBlueprint[] | null {
  const normalized = goal.trim();
  const parts = normalized
    .replace(/\bthen\b/gi, " and ")
    .split(/\s+\band\b\s+/i)
    .map((part) => part.trim());

  const startCommand = extractQuotedValue(normalized, /(?:start app|run app|launch app|start server|run server)\s+"([^"]+)"/i);
  const serverUrl = extractQuotedValue(normalized, /wait for server\s+"([^"]+)"/i) ?? extractUrl(normalized);
  const pageUrl =
    extractQuotedValue(normalized, /open page\s+"([^"]+)"/i) ??
    extractQuotedValue(normalized, /open\s+"([^"]+)"/i) ??
    extractUrl(normalized);
  const assertText = extractQuotedValue(normalized, /assert text\s+"([^"]+)"/i) ?? extractQuotedValue(normalized, /verify text\s+"([^"]+)"/i);
  const clickSelector = extractQuotedValue(normalized, /click\s+"([^"]+)"/i) ?? extractUnquotedSelector(normalized);
  const typeText = extractQuotedValue(normalized, /type\s+"([^"]+)"/i);
  const typeSelector = extractQuotedValue(normalized, /(?:into|in)\s+"([^"]+)"/i);
  const screenshotPath = extractScreenshotPath(normalized) ?? "artifacts/screenshot.png";
  const hasScreenshot = /\bscreenshot\b|\bcapture\b/i.test(normalized);

  const waitForServerPart = parts.find((part) => /wait for server/i.test(part));
  const assertPart = parts.find((part) => /assert text|verify text/i.test(part));

  // Form-fill template: start app → wait → open → type fields → click submit → assert → screenshot → stop
  if (startCommand && serverUrl && pageUrl && typeText && typeSelector && clickSelector && assertText) {
    return [
      { type: "start_app", payload: { command: startCommand } },
      { type: "wait_for_server", payload: { url: serverUrl, timeoutMs: extractTimeout(waitForServerPart) ?? 30000 } },
      { type: "open_page", payload: { url: pageUrl } },
      { type: "type", payload: { selector: typeSelector, text: typeText } },
      { type: "click", payload: { selector: clickSelector } },
      { type: "assert_text", payload: { text: assertText, timeoutMs: extractTimeout(assertPart) ?? 5000 } },
      ...(hasScreenshot ? [{ type: "screenshot" as const, payload: { outputPath: screenshotPath } }] : []),
      { type: "stop_app", payload: {} }
    ];
  }

  if (startCommand && serverUrl && pageUrl && assertText && clickSelector && hasScreenshot) {
    return [
      { type: "start_app", payload: { command: startCommand } },
      { type: "wait_for_server", payload: { url: serverUrl, timeoutMs: extractTimeout(waitForServerPart) ?? 30000 } },
      { type: "open_page", payload: { url: pageUrl } },
      { type: "click", payload: { selector: clickSelector } },
      { type: "assert_text", payload: { text: assertText, timeoutMs: extractTimeout(assertPart) ?? 5000 } },
      { type: "screenshot", payload: { outputPath: screenshotPath } },
      { type: "stop_app", payload: {} }
    ];
  }

  if (startCommand && serverUrl && pageUrl && assertText && !clickSelector) {
    return [
      { type: "start_app", payload: { command: startCommand } },
      { type: "wait_for_server", payload: { url: serverUrl, timeoutMs: extractTimeout(waitForServerPart) ?? 30000 } },
      { type: "open_page", payload: { url: pageUrl } },
      { type: "assert_text", payload: { text: assertText, timeoutMs: extractTimeout(assertPart) ?? 5000 } },
      { type: "stop_app", payload: {} }
    ];
  }

  if (!startCommand && pageUrl && /\bscreenshot\b|\bcapture\b/i.test(normalized)) {
    return [
      { type: "open_page", payload: { url: pageUrl } },
      { type: "screenshot", payload: { outputPath: screenshotPath } }
    ];
  }

  // (h) Multi-step browse: "go to URL and click X" — must precede simple navigation
  const browseClickMatch = normalized.match(/^go\s+to\s+(\S+)\s+and\s+click\s+"([^"]+)"$/i) ??
    normalized.match(/^go\s+to\s+(\S+)\s+and\s+click\s+(\S+)$/i);
  if (browseClickMatch) {
    const browseUrl = extractUrl(browseClickMatch[1]) ?? browseClickMatch[1].replace(/["']/g, "").trim();
    const browseSelector = browseClickMatch[2];
    return [
      { type: "open_page", payload: { url: browseUrl } },
      { type: "click", payload: { selector: browseSelector } }
    ];
  }

  // (a) Simple navigation: "go to URL" / "open URL" / "visit URL" / "navigate to URL"
  // Only match when there's no "and" clause (multi-step goals handled elsewhere)
  if (parts.length === 1) {
    const navMatch = normalized.match(/^(?:go\s+to|open|visit|navigate\s+to)\s+(.+)$/i);
    if (navMatch) {
      const navUrl = extractUrl(navMatch[1]) ?? navMatch[1].replace(/["']/g, "").trim();
      if (navUrl) {
        return [
          { type: "open_page", payload: { url: navUrl } }
        ];
      }
    }
  }

  // (b) Search pattern: "search for X on URL"
  const searchMatch = normalized.match(/^search\s+for\s+"([^"]+)"\s+on\s+(.+)$/i) ??
    normalized.match(/^search\s+for\s+(\S+)\s+on\s+(.+)$/i);
  if (searchMatch) {
    const searchTerm = searchMatch[1];
    const searchUrl = extractUrl(searchMatch[2]) ?? searchMatch[2].replace(/["']/g, "").trim();
    return [
      { type: "open_page", payload: { url: searchUrl } },
      { type: "type", payload: { selector: "input[type=\"search\"], input[name=\"q\"], input[name=\"search\"], [role=\"searchbox\"]", text: searchTerm } },
      { type: "click", payload: { selector: "button[type=\"submit\"], input[type=\"submit\"], [aria-label=\"Search\"], button:has-text(\"Search\")" } }
    ];
  }

  // (c) Login pattern: "login to URL with user/pass"
  const loginMatch = normalized.match(/^login\s+to\s+(\S+)\s+with\s+"([^"]+)"\s*\/\s*"([^"]+)"$/i) ??
    normalized.match(/^login\s+to\s+(\S+)\s+with\s+(\S+)\s*\/\s*(\S+)$/i);
  if (loginMatch) {
    const loginUrl = extractUrl(loginMatch[1]) ?? loginMatch[1].replace(/["']/g, "").trim();
    const username = loginMatch[2];
    const password = loginMatch[3];
    return [
      { type: "open_page", payload: { url: loginUrl } },
      { type: "type", payload: { selector: "input[name=\"username\"], input[name=\"email\"], input[type=\"email\"], #username, #email", text: username } },
      { type: "type", payload: { selector: "input[name=\"password\"], input[type=\"password\"], #password", text: password } },
      { type: "click", payload: { selector: "button[type=\"submit\"], input[type=\"submit\"], button:has-text(\"Log in\"), button:has-text(\"Login\"), button:has-text(\"Sign in\")" } }
    ];
  }

  // (d) Screenshot capture: "take screenshot of URL" / "screenshot URL"
  const screenshotMatch = normalized.match(/^(?:take\s+(?:a\s+)?screenshot\s+of|screenshot)\s+(.+)$/i);
  if (screenshotMatch) {
    const ssUrl = extractUrl(screenshotMatch[1]) ?? screenshotMatch[1].replace(/["']/g, "").trim();
    if (ssUrl) {
      return [
        { type: "open_page", payload: { url: ssUrl } },
        { type: "screenshot", payload: { outputPath: screenshotPath } }
      ];
    }
  }

  // (e) API check: "check health of URL" / "test API at URL" / "fetch URL"
  const apiMatch = normalized.match(/^(?:check\s+health\s+of|test\s+api\s+at|fetch)\s+(.+)$/i);
  if (apiMatch) {
    const apiUrl = extractUrl(apiMatch[1]) ?? apiMatch[1].replace(/["']/g, "").trim();
    return [
      { type: "http_request", payload: { url: apiUrl, method: "GET" } }
    ];
  }

  // (f) File operations: "read file PATH" / "list files in DIR"
  const readFileMatch = normalized.match(/^read\s+file\s+"([^"]+)"$/i) ??
    normalized.match(/^read\s+file\s+(\S+)$/i);
  if (readFileMatch) {
    return [
      { type: "read_file", payload: { path: readFileMatch[1] } }
    ];
  }

  const listFilesMatch = normalized.match(/^list\s+files\s+in\s+"([^"]+)"$/i) ??
    normalized.match(/^list\s+files\s+in\s+(\S+)$/i);
  if (listFilesMatch) {
    return [
      { type: "run_code", payload: { code: `require('fs').readdirSync('${listFilesMatch[1]}').join('\\n')`, language: "javascript" } }
    ];
  }

  // (g) Shell commands: "run command CMD" / "execute CMD"
  const shellMatch = normalized.match(/^(?:run\s+command|execute)\s+"([^"]+)"$/i) ??
    normalized.match(/^(?:run\s+command|execute)\s+(.+)$/i);
  if (shellMatch) {
    return [
      { type: "run_code", payload: { code: shellMatch[1], language: "shell" } }
    ];
  }

  // (i) Extract text: "get text from URL" / "scrape URL"
  const extractMatch = normalized.match(/^(?:get\s+text\s+from|scrape)\s+(.+)$/i);
  if (extractMatch) {
    const extractUrl_ = extractUrl(extractMatch[1]) ?? extractMatch[1].replace(/["']/g, "").trim();
    return [
      { type: "open_page", payload: { url: extractUrl_ } },
      { type: "visual_extract", payload: { description: "Extract all visible text content from the page" } }
    ];
  }

  // (j) Fill form: "fill FIELD with VALUE on URL"
  const fillMatch = normalized.match(/^fill\s+"([^"]+)"\s+with\s+"([^"]+)"\s+on\s+(.+)$/i);
  if (fillMatch) {
    const fieldSelector = fillMatch[1];
    const fieldValue = fillMatch[2];
    const fillUrl = extractUrl(fillMatch[3]) ?? fillMatch[3].replace(/["']/g, "").trim();
    return [
      { type: "open_page", payload: { url: fillUrl } },
      { type: "type", payload: { selector: fieldSelector, text: fieldValue } }
    ];
  }

  return null;
}

function extractUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s"]+/i);
  return match?.[0];
}

function extractQuotedValue(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern);
  return match?.[1];
}

function extractUnquotedSelector(value: string): string | undefined {
  const match = value.match(/click\s+(#[^\s]+|\.[^\s]+|text=[^\s]+|data-testid=[^\s]+)/i);
  return match?.[1];
}

function extractTimeout(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const secondsMatch = value.match(/timeout\s+(\d+)\s*(second|seconds|sec|s)\b/i);
  if (secondsMatch) {
    return Number(secondsMatch[1]) * 1000;
  }

  const millisecondsMatch = value.match(/timeout\s+(\d+)\s*(millisecond|milliseconds|ms)\b/i);
  if (millisecondsMatch) {
    return Number(millisecondsMatch[1]);
  }

  return undefined;
}

function extractScreenshotPath(value: string): string | undefined {
  const match = value.match(/screenshot\s+(?:to|as)\s+([^\s]+)/i);
  return match?.[1];
}
