import { TaskBlueprint } from "./task-id";

export function createRegexPlan(goal: string): TaskBlueprint[] {
  const trimmedGoal = goal.trim();

  if (!trimmedGoal) {
    return [];
  }

  const normalizedGoal = trimmedGoal.replace(/\bthen\b/gi, " and ");
  const parts = normalizedGoal
    .split(/\s+\band\b\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const blueprints: TaskBlueprint[] = [];

  for (const part of parts) {
    const task = parseBlueprint(part);
    if (task) {
      blueprints.push(task);
    }
  }

  if (blueprints.length === 0) {
    const fallbackUrl = extractUrl(trimmedGoal);
    if (fallbackUrl) {
      blueprints.push({ type: "open_page", payload: { url: fallbackUrl } });
    }
  }

  const hasStartApp = blueprints.some((task) => task.type === "start_app");
  const hasStopApp = blueprints.some((task) => task.type === "stop_app");

  if (hasStartApp && !hasStopApp) {
    blueprints.push({ type: "stop_app", payload: {} });
  }

  return blueprints;
}

function parseBlueprint(part: string): TaskBlueprint | null {
  const startCommand = extractQuotedValue(part, /(?:start app|run app|launch app|start server|run server)\s+"([^"]+)"/i);
  if (startCommand) {
    return { type: "start_app", payload: { command: startCommand } };
  }

  const serverUrl = extractQuotedValue(part, /wait for server\s+"([^"]+)"/i) ?? extractUrl(part);
  if (/wait for server/i.test(part) && serverUrl) {
    return {
      type: "wait_for_server",
      payload: {
        url: serverUrl,
        timeoutMs: extractTimeout(part) ?? 30000
      }
    };
  }

  const pageUrl =
    extractQuotedValue(part, /open page\s+"([^"]+)"/i) ??
    extractQuotedValue(part, /open\s+"([^"]+)"/i) ??
    extractUrl(part);
  if (pageUrl && /\bopen\b/i.test(part)) {
    return { type: "open_page", payload: { url: pageUrl } };
  }

  // Visual perception actions — checked BEFORE regular click/type to avoid prefix collision
  const visualClickDesc =
    extractQuotedValue(part, /visual(?:ly)?\s+click\s+"([^"]+)"/i) ??
    extractUnquotedAfterKeyword(part, /visual(?:ly)?\s+click\s+/i);
  if (visualClickDesc && /\bvisual(?:ly)?\s+click\b/i.test(part)) {
    return { type: "visual_click", payload: { description: visualClickDesc } };
  }

  const visualTypeText = extractQuotedValue(part, /visual(?:ly)?\s+type\s+"([^"]+)"/i);
  const visualTypeDesc =
    extractQuotedValue(part, /(?:into|in)\s+"([^"]+)"/i) ??
    extractUnquotedAfterKeyword(part, /(?:into|in)\s+/i);
  if (visualTypeText && visualTypeDesc && /\bvisual(?:ly)?\s+type\b/i.test(part)) {
    return { type: "visual_type", payload: { description: visualTypeDesc, text: visualTypeText } };
  }

  const visualAssertDesc =
    extractQuotedValue(part, /visual(?:ly)?\s+assert\s+"([^"]+)"/i) ??
    extractUnquotedAfterKeyword(part, /visual(?:ly)?\s+assert\s+/i);
  if (visualAssertDesc && /\bvisual(?:ly)?\s+assert\b/i.test(part)) {
    return { type: "visual_assert", payload: { assertion: visualAssertDesc } };
  }

  const visualExtractDesc =
    extractQuotedValue(part, /visual(?:ly)?\s+extract\s+"([^"]+)"/i) ??
    extractUnquotedAfterKeyword(part, /visual(?:ly)?\s+extract\s+/i);
  if (visualExtractDesc && /\bvisual(?:ly)?\s+extract\b/i.test(part)) {
    return { type: "visual_extract", payload: { description: visualExtractDesc } };
  }

  const clickSelector = extractQuotedValue(part, /click\s+"([^"]+)"/i) ?? extractUnquotedSelector(part);
  if (clickSelector && /\bclick\b/i.test(part)) {
    return { type: "click", payload: { selector: clickSelector } };
  }

  const typeText = extractQuotedValue(part, /type\s+"([^"]+)"/i);
  const typeSelector =
    extractQuotedValue(part, /(?:into|in)\s+"([^"]+)"/i) ??
    extractUnquotedSelectorAfter(part, /(?:into|in)\s+/i);
  if (typeText && typeSelector && /\btype\b/i.test(part)) {
    return { type: "type", payload: { selector: typeSelector, text: typeText } };
  }

  const selectValue = extractQuotedValue(part, /select\s+"([^"]+)"/i);
  const selectSelector =
    extractQuotedValue(part, /(?:from|in)\s+"([^"]+)"/i) ??
    extractUnquotedSelectorAfter(part, /(?:from|in)\s+/i);
  if (selectValue && selectSelector && /\bselect\b/i.test(part)) {
    return { type: "select", payload: { selector: selectSelector, value: selectValue } };
  }

  const hoverSelector =
    extractQuotedValue(part, /hover\s+(?:over\s+)?"([^"]+)"/i) ??
    extractUnquotedSelectorAfter(part, /hover\s+(?:over\s+)?/i);
  if (hoverSelector && /\bhover\b/i.test(part)) {
    return { type: "hover", payload: { selector: hoverSelector } };
  }

  if (/\bscroll\b/i.test(part)) {
    const scrollDirection = /\bup\b/i.test(part)
      ? "up"
      : /\bleft\b/i.test(part)
        ? "left"
        : /\bright\b/i.test(part)
          ? "right"
          : "down";
    const scrollAmount = extractScrollAmount(part) ?? 300;
    const scrollSelector = extractQuotedValue(part, /scroll\s+(?:up|down|left|right)?\s*(?:in|on|inside)?\s*"([^"]+)"/i);
    return {
      type: "scroll",
      payload: {
        ...(scrollSelector ? { selector: scrollSelector } : {}),
        direction: scrollDirection,
        amount: scrollAmount
      }
    };
  }

  const waitDuration = extractWaitDuration(part);
  if (waitDuration !== null && /\bwait\b/i.test(part) && !/\bwait for server\b/i.test(part)) {
    return { type: "wait", payload: { durationMs: waitDuration } };
  }

  const assertText = extractQuotedValue(part, /assert text\s+"([^"]+)"/i) ?? extractQuotedValue(part, /verify text\s+"([^"]+)"/i);
  if (assertText) {
    return {
      type: "assert_text",
      payload: {
        text: assertText,
        timeoutMs: extractTimeout(part) ?? 5000
      }
    };
  }

  if (/\bscreenshot\b|\bcapture\b/i.test(part)) {
    return {
      type: "screenshot",
      payload: {
        outputPath: extractScreenshotPath(part) ?? "artifacts/screenshot.png"
      }
    };
  }

  if (/\bstop app\b|\bstop server\b|\bclose app\b|\bshutdown app\b/i.test(part)) {
    return { type: "stop_app", payload: {} };
  }

  // http_request: "url" or GET|POST "url"
  const httpMethod = part.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/i)?.[1]?.toUpperCase();
  const httpUrl =
    extractQuotedValue(part, /http_request\s+"([^"]+)"/i) ??
    extractQuotedValue(part, /(?:GET|POST|PUT|PATCH|DELETE)\s+"([^"]+)"/i) ??
    extractUrl(part);
  if (httpUrl && (/\bhttp_request\b/i.test(part) || httpMethod)) {
    return { type: "http_request", payload: { url: httpUrl, method: httpMethod ?? "GET" } };
  }

  // read_file: read file "path/to/file"
  const readPath = extractQuotedValue(part, /read\s+file\s+"([^"]+)"/i);
  if (readPath && /\bread\s+file\b/i.test(part)) {
    return { type: "read_file", payload: { path: readPath } };
  }

  // write_file: write file "path" content "..."
  const writePath = extractQuotedValue(part, /write\s+file\s+"([^"]+)"/i);
  const writeContent = extractQuotedValue(part, /content\s+"([^"]+)"/i);
  if (writePath && writeContent && /\bwrite\s+file\b/i.test(part)) {
    return { type: "write_file", payload: { path: writePath, content: writeContent } };
  }

  // run_code: run_code "language" "code"
  const runCodeMatch = part.match(/run_code\s+"([^"]+)"\s+"([^"]+)"/i);
  if (runCodeMatch) {
    return { type: "run_code", payload: { language: runCodeMatch[1], code: runCodeMatch[2] } };
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

function extractUnquotedSelectorAfter(value: string, prefix: RegExp): string | undefined {
  const source = prefix.source;
  const pattern = new RegExp(source + "(#[^\\s]+|\\.[^\\s]+|\\[data-[^\\]]+\\])", "i");
  const match = value.match(pattern);
  return match?.[1];
}

function extractScrollAmount(value: string): number | undefined {
  const pxMatch = value.match(/(\d+)\s*px/i);
  if (pxMatch) {
    return Number(pxMatch[1]);
  }

  if (/\bhalf\b/i.test(value)) {
    return 400;
  }

  if (/\bfull\b|\bpage\b/i.test(value)) {
    return 800;
  }

  return undefined;
}

function extractWaitDuration(value: string): number | null {
  const secondsMatch = value.match(/wait\s+(\d+)\s*(second|seconds|sec|s)\b/i);
  if (secondsMatch) {
    return Number(secondsMatch[1]) * 1000;
  }

  const millisecondsMatch = value.match(/wait\s+(\d+)\s*(millisecond|milliseconds|ms)\b/i);
  if (millisecondsMatch) {
    return Number(millisecondsMatch[1]);
  }

  return null;
}

function extractTimeout(value: string): number | undefined {
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

// Extracts unquoted text after a keyword prefix, stopping at " and " or end of string
function extractUnquotedAfterKeyword(value: string, prefix: RegExp): string | undefined {
  const match = value.match(new RegExp(prefix.source + "([^\"]+?)(?:\\s+and\\s+|$)", "i"));
  return match?.[1]?.trim() || undefined;
}
