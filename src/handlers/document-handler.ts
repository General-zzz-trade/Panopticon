/**
 * Document Handler — processes PDF, CSV, and Excel-like files.
 *
 * Generates JavaScript code and delegates execution to the code handler
 * (via handleCodeTask) for sandboxed file processing using only Node.js
 * built-in capabilities and common OS utilities.
 */

import { logModuleError } from "../core/module-logger";
import { handleCodeTask } from "./code-handler";
import { registerTool } from "../tools/registry";
import type { AgentTask, RunContext } from "../types";
import type { TaskExecutionOutput } from "./browser-handler";

type DocumentAction = "read_csv" | "write_csv" | "read_pdf" | "read_excel";

function escapeForJS(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function buildReadCsvCode(filePath: string): string {
  const escaped = escapeForJS(filePath);
  return [
    "import fs from 'fs';",
    `const content = fs.readFileSync('${escaped}', 'utf-8');`,
    "const lines = content.split('\\n').filter(l => l.trim());",
    "const headers = lines[0].split(',').map(h => h.trim());",
    "const rows = lines.slice(1).map(l => {",
    "  const vals = l.split(',');",
    "  const obj = {};",
    "  headers.forEach((h, i) => { obj[h] = vals[i] != null ? vals[i].trim() : ''; });",
    "  return obj;",
    "});",
    "console.log(JSON.stringify({ headers, rowCount: rows.length, rows: rows.slice(0, 10) }));"
  ].join("\n");
}

function buildWriteCsvCode(filePath: string, headers: string[], rows: string[][]): string {
  const escaped = escapeForJS(filePath);
  const headersJson = JSON.stringify(headers);
  const rowsJson = JSON.stringify(rows);
  return [
    "import fs from 'fs';",
    `const headers = ${headersJson};`,
    `const rows = ${rowsJson};`,
    "const content = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');",
    `fs.writeFileSync('${escaped}', content);`,
    `console.log(JSON.stringify({ success: true, path: '${escaped}', rowCount: rows.length }));`
  ].join("\n");
}

function buildReadPdfCode(filePath: string): string {
  const escaped = escapeForJS(filePath);
  // Uses execFileSync with array args (no shell interpolation) for safety.
  // Tries pdftotext first, falls back to strings.
  return [
    "import { execFileSync } from 'child_process';",
    "let text;",
    "try {",
    `  text = execFileSync('pdftotext', ['${escaped}', '-'], { encoding: 'utf-8', timeout: 15000 });`,
    "} catch (_e) {",
    "  try {",
    `    text = execFileSync('strings', ['${escaped}'], { encoding: 'utf-8', timeout: 15000 });`,
    "  } catch (e2) {",
    "    console.error('Failed to extract text from PDF: ' + e2.message);",
    "    process.exit(1);",
    "  }",
    "}",
    "const trimmed = text.trim();",
    "console.log(JSON.stringify({ charCount: trimmed.length, preview: trimmed.slice(0, 2000) }));"
  ].join("\n");
}

function buildReadExcelCode(filePath: string): string {
  const escaped = escapeForJS(filePath);
  // Uses execFileSync with array args (no shell interpolation) for safety.
  return [
    "import { execFileSync } from 'child_process';",
    "let xml;",
    "try {",
    `  xml = execFileSync('unzip', ['-p', '${escaped}', 'xl/sharedStrings.xml'], { encoding: 'utf-8', timeout: 15000 });`,
    "} catch (e) {",
    "  console.error('Failed to read xlsx (unzip required): ' + e.message);",
    "  process.exit(1);",
    "}",
    "const strings = [];",
    "const re = /<t[^>]*>([^<]*)<\\/t>/g;",
    "let m;",
    "while ((m = re.exec(xml)) !== null) { strings.push(m[1]); }",
    "console.log(JSON.stringify({ stringCount: strings.length, strings: strings.slice(0, 100) }));"
  ].join("\n");
}

export async function handleDocumentTask(
  context: RunContext,
  task: AgentTask
): Promise<TaskExecutionOutput> {
  const action = String(task.payload.action ?? task.type) as DocumentAction;
  const filePath = String(task.payload.path ?? "");

  if (!filePath) {
    throw new Error(`${action}: path payload is required`);
  }

  let code: string;

  switch (action) {
    case "read_csv":
      code = buildReadCsvCode(filePath);
      break;

    case "write_csv": {
      const headers = parseStringArray(task.payload.headers);
      const rows = parseNestedStringArray(task.payload.rows);
      if (!headers.length) {
        throw new Error("write_csv: headers payload is required (comma-separated or JSON array)");
      }
      code = buildWriteCsvCode(filePath, headers, rows);
      break;
    }

    case "read_pdf":
      code = buildReadPdfCode(filePath);
      break;

    case "read_excel":
      code = buildReadExcelCode(filePath);
      break;

    default:
      throw new Error(`document-handler: unknown action "${action}"`);
  }

  // Delegate to code handler
  const codeTask: AgentTask = {
    id: `${task.id}-doc-code`,
    type: "run_code",
    status: "pending",
    retries: 0,
    attempts: 0,
    replanDepth: 0,
    payload: {
      language: "javascript",
      code,
      timeoutMs: 15000
    }
  };

  try {
    const result = await handleCodeTask(context, codeTask);
    return {
      summary: `[${action}] ${result.summary}`,
      artifacts: result.artifacts,
      stateHints: [`document_operation:${action}`, `file:${filePath}`]
    };
  } catch (error) {
    logModuleError("document-handler", "optional", error, `${action} failed for ${filePath}`);
    throw error;
  }
}

// ── Payload parsing helpers ──────────────────────────────────────────

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // treat as comma-separated
    }
    return value.split(",").map(s => s.trim());
  }
  return [];
}

function parseNestedStringArray(value: unknown): string[][] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((row: unknown) =>
          Array.isArray(row) ? row.map(String) : []
        );
      }
    } catch {
      // ignore
    }
  }
  return [];
}

// ── Tool registration ────────────────────────────────────────────────

for (const t of ["read_csv", "write_csv", "read_pdf", "read_excel"] as const) {
  registerTool({
    name: t,
    category: "custom",
    description: `${t.replace("_", " ")} file`,
    parameters: [
      { name: "path", type: "string", required: true, description: "File path" }
    ],
    verificationStrategy: "error",
    mutating: t.startsWith("write"),
    requiresApproval: t.startsWith("write")
  });
}
