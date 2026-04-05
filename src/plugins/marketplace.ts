/**
 * Skill Marketplace — local skill registry for installing, listing, and searching skills.
 *
 * Skills are stored as JSON files in a local `skills/` directory at the project root.
 * Each skill bundles a ToolDefinition plus executable code, enabling dynamic capability
 * extension without modifying the core runtime.
 */

import * as fs from "fs";
import * as path from "path";
import { registerTool, unregisterTool, type ToolDefinition } from "../tools/registry";
import { logModuleError } from "../core/module-logger";

export interface SkillPackage {
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tool: ToolDefinition;
  /** JavaScript code that implements the skill */
  code: string;
  language: "javascript" | "python" | "shell";
  installedAt?: string;
}

const SKILLS_DIR = path.join(process.cwd(), "skills");

/**
 * Ensure the skills directory exists. Safe to call multiple times.
 */
export function initMarketplace(): void {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }
  } catch (error) {
    logModuleError("marketplace", "critical", error, "failed to initialize skills directory");
  }
}

/**
 * Install a skill from a SkillPackage definition.
 * Saves to `skills/{name}.json` and registers the tool in the tool registry.
 */
export function installSkill(pkg: SkillPackage): boolean {
  try {
    initMarketplace();

    const record: SkillPackage = {
      ...pkg,
      installedAt: new Date().toISOString(),
    };

    const filePath = path.join(SKILLS_DIR, `${pkg.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");

    registerTool(pkg.tool);
    return true;
  } catch (error) {
    logModuleError("marketplace", "optional", error, `failed to install skill "${pkg.name}"`);
    return false;
  }
}

/**
 * Uninstall a skill by name.
 * Removes the JSON file and unregisters the tool.
 */
export function uninstallSkill(name: string): boolean {
  try {
    const filePath = path.join(SKILLS_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const pkg = JSON.parse(raw) as SkillPackage;
    unregisterTool(pkg.tool.name);

    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    logModuleError("marketplace", "optional", error, `failed to uninstall skill "${name}"`);
    return false;
  }
}

/**
 * List all installed skills by reading JSON files from the skills directory.
 */
export function listInstalledSkills(): SkillPackage[] {
  try {
    initMarketplace();

    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".json"));
    const skills: SkillPackage[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(SKILLS_DIR, file), "utf-8");
        skills.push(JSON.parse(raw) as SkillPackage);
      } catch {
        // Skip malformed files
      }
    }

    return skills;
  } catch (error) {
    logModuleError("marketplace", "optional", error, "failed to list installed skills");
    return [];
  }
}

/**
 * Search installed skills by keyword.
 * Matches against name, description, and category (case-insensitive).
 */
export function searchSkills(query: string): SkillPackage[] {
  const skills = listInstalledSkills();
  const lowerQuery = query.toLowerCase();

  return skills.filter(skill =>
    skill.name.toLowerCase().includes(lowerQuery) ||
    skill.description.toLowerCase().includes(lowerQuery) ||
    skill.category.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Load and register all installed skills on startup.
 * Reads all skill JSON files and registers their tools.
 * Returns the number of skills successfully loaded.
 */
export function loadInstalledSkills(): number {
  const skills = listInstalledSkills();
  let count = 0;

  for (const skill of skills) {
    try {
      registerTool(skill.tool);
      count++;
    } catch (error) {
      logModuleError("marketplace", "optional", error, `failed to load skill "${skill.name}"`);
    }
  }

  return count;
}

/**
 * Returns built-in skill packages that come pre-defined.
 * These can be installed via `installSkill()`.
 */
export function getBuiltinSkills(): SkillPackage[] {
  return [
    {
      name: "text_transform",
      version: "1.0.0",
      description: "Transform text with operations: uppercase, lowercase, reverse, count_words",
      author: "agent-orchestrator",
      category: "text",
      language: "javascript",
      tool: {
        name: "text_transform",
        category: "code",
        description: "Transform text with various operations",
        parameters: [
          { name: "text", type: "string", required: true, description: "Input text to transform" },
          { name: "operation", type: "string", required: true, description: "Operation: uppercase, lowercase, reverse, count_words" },
        ],
        verificationStrategy: "output",
        mutating: false,
        requiresApproval: false,
      },
      code: [
        "function textTransform(text, operation) {",
        "  switch (operation) {",
        "    case 'uppercase': return text.toUpperCase();",
        "    case 'lowercase': return text.toLowerCase();",
        "    case 'reverse': return text.split('').reverse().join('');",
        "    case 'count_words':",
        "      return String(text.trim().split(/\\s+/).filter(Boolean).length);",
        "    default: throw new Error('Unknown operation: ' + operation);",
        "  }",
        "}",
        "var result = textTransform(args.text, args.operation);",
        "result;",
      ].join("\n"),
    },
    {
      name: "json_query",
      version: "1.0.0",
      description: "Query JSON data using dot-notation path expressions",
      author: "agent-orchestrator",
      category: "data",
      language: "javascript",
      tool: {
        name: "json_query",
        category: "code",
        description: "Query JSON data using a path expression",
        parameters: [
          { name: "json_string", type: "string", required: true, description: "JSON string to query" },
          { name: "jq_expression", type: "string", required: true, description: "Dot-notation path, e.g. .data.items[0].name" },
        ],
        verificationStrategy: "output",
        mutating: false,
        requiresApproval: false,
      },
      code: [
        "function jsonQuery(jsonStr, expr) {",
        "  var data = JSON.parse(jsonStr);",
        "  var parts = expr.replace(/^\\.+/, '').split('.').filter(Boolean);",
        "  var current = data;",
        "  for (var i = 0; i < parts.length; i++) {",
        "    var part = parts[i];",
        "    var arrayMatch = part.match(/^(\\w+)\\[(\\d+)\\]$/);",
        "    if (arrayMatch) {",
        "      current = current[arrayMatch[1]][Number(arrayMatch[2])];",
        "    } else {",
        "      current = current[part];",
        "    }",
        "    if (current === undefined) return 'undefined';",
        "  }",
        "  return typeof current === 'object' ? JSON.stringify(current) : String(current);",
        "}",
        "var result = jsonQuery(args.json_string, args.jq_expression);",
        "result;",
      ].join("\n"),
    },
    {
      name: "url_shortener",
      version: "1.0.0",
      description: "Generate a formatted short description for a URL",
      author: "agent-orchestrator",
      category: "web",
      language: "javascript",
      tool: {
        name: "url_shortener",
        category: "code",
        description: "Generate a formatted short description of a URL",
        parameters: [
          { name: "url", type: "string", required: true, description: "URL to describe" },
        ],
        verificationStrategy: "output",
        mutating: false,
        requiresApproval: false,
      },
      code: [
        "function shortenUrl(url) {",
        "  try {",
        "    var parsed = new URL(url);",
        "    var host = parsed.hostname.replace(/^www\\./, '');",
        "    var pathParts = parsed.pathname.split('/').filter(Boolean);",
        "    var summary = pathParts.length > 0",
        "      ? '/' + pathParts.slice(0, 2).join('/')",
        "      : '';",
        "    var query = parsed.search ? ' (with params)' : '';",
        "    var ellipsis = pathParts.length > 2 ? '/...' : '';",
        "    return host + summary + ellipsis + query;",
        "  } catch (e) {",
        "    return 'Invalid URL: ' + url;",
        "  }",
        "}",
        "var result = shortenUrl(args.url);",
        "result;",
      ].join("\n"),
    },
    {
      name: "math_eval",
      version: "1.0.0",
      description: "Safely evaluate a mathematical expression",
      author: "agent-orchestrator",
      category: "math",
      language: "javascript",
      tool: {
        name: "math_eval",
        category: "code",
        description: "Safely evaluate a mathematical expression",
        parameters: [
          { name: "expression", type: "string", required: true, description: "Math expression to evaluate, e.g. (2 + 3) * 4" },
        ],
        verificationStrategy: "output",
        mutating: false,
        requiresApproval: false,
      },
      code: [
        "function mathEval(expr) {",
        "  var sanitized = expr.replace(/[^0-9+\\-*/().\\s%]/g, '');",
        "  if (sanitized !== expr.trim()) {",
        "    throw new Error('Expression contains disallowed characters');",
        "  }",
        "  var result = Function('\"use strict\"; return (' + sanitized + ')')();",
        "  if (typeof result !== 'number' || !isFinite(result)) {",
        "    throw new Error('Expression did not evaluate to a finite number');",
        "  }",
        "  return String(result);",
        "}",
        "var result = mathEval(args.expression);",
        "result;",
      ].join("\n"),
    },
  ];
}
