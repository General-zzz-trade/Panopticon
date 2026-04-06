/**
 * Tool Registry — abstracts task types into tool categories.
 * Enables non-UI domains by allowing new tools to be registered
 * without modifying the core runtime.
 *
 * This sits above the plugin registry and provides:
 * - Tool categorization (browser, shell, http, file, code, custom)
 * - Capability discovery (what can the agent do?)
 * - Verification strategy hints (how to verify this tool's output?)
 */

export type ToolCategory = "browser" | "shell" | "http" | "file" | "code" | "vision" | "osint" | "custom";

export interface ToolDefinition {
  name: string;                    // unique tool name, e.g. "click", "sql_query"
  category: ToolCategory;
  description: string;             // human-readable description
  parameters: ToolParameter[];     // expected parameters
  verificationStrategy: "anomaly" | "error" | "output" | "state" | "custom";
  mutating: boolean;               // does this tool change state?
  requiresApproval: boolean;       // should human approve before execution?
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
}

// Built-in tool definitions
const BUILTIN_TOOLS: ToolDefinition[] = [
  // Browser tools
  { name: "open_page", category: "browser", description: "Navigate to a URL", parameters: [{ name: "url", type: "string", required: true, description: "URL to open" }], verificationStrategy: "state", mutating: true, requiresApproval: false },
  { name: "click", category: "browser", description: "Click an element by selector", parameters: [{ name: "selector", type: "string", required: true, description: "CSS selector" }], verificationStrategy: "anomaly", mutating: true, requiresApproval: false },
  { name: "type", category: "browser", description: "Type text into an element", parameters: [{ name: "selector", type: "string", required: true, description: "CSS selector" }, { name: "text", type: "string", required: true, description: "Text to type" }], verificationStrategy: "output", mutating: true, requiresApproval: false },
  { name: "select", category: "browser", description: "Select a dropdown option", parameters: [{ name: "selector", type: "string", required: true, description: "CSS selector" }, { name: "value", type: "string", required: true, description: "Option value" }], verificationStrategy: "output", mutating: true, requiresApproval: false },
  { name: "hover", category: "browser", description: "Hover over an element", parameters: [{ name: "selector", type: "string", required: true, description: "CSS selector" }], verificationStrategy: "anomaly", mutating: false, requiresApproval: false },
  { name: "scroll", category: "browser", description: "Scroll the page", parameters: [{ name: "direction", type: "string", required: true, description: "up or down" }], verificationStrategy: "anomaly", mutating: false, requiresApproval: false },
  { name: "wait", category: "browser", description: "Wait for a duration", parameters: [{ name: "ms", type: "number", required: true, description: "Milliseconds" }], verificationStrategy: "state", mutating: false, requiresApproval: false },
  { name: "screenshot", category: "browser", description: "Capture a screenshot", parameters: [{ name: "outputPath", type: "string", required: false, description: "File path" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "assert_text", category: "browser", description: "Assert text is visible", parameters: [{ name: "text", type: "string", required: true, description: "Expected text" }], verificationStrategy: "output", mutating: false, requiresApproval: false },

  // Vision tools
  { name: "visual_click", category: "vision", description: "Click by visual description", parameters: [{ name: "description", type: "string", required: true, description: "Element description" }], verificationStrategy: "anomaly", mutating: true, requiresApproval: false },
  { name: "visual_type", category: "vision", description: "Type by visual description", parameters: [{ name: "description", type: "string", required: true, description: "Element description" }, { name: "text", type: "string", required: true, description: "Text to type" }], verificationStrategy: "output", mutating: true, requiresApproval: false },
  { name: "visual_assert", category: "vision", description: "Assert by visual description", parameters: [{ name: "text", type: "string", required: true, description: "Expected text" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "visual_extract", category: "vision", description: "Extract info visually", parameters: [{ name: "description", type: "string", required: true, description: "What to extract" }], verificationStrategy: "error", mutating: false, requiresApproval: false },

  // Shell tools
  { name: "start_app", category: "shell", description: "Start an application", parameters: [{ name: "command", type: "string", required: true, description: "Shell command" }], verificationStrategy: "state", mutating: true, requiresApproval: false },
  { name: "stop_app", category: "shell", description: "Stop the running application", parameters: [], verificationStrategy: "state", mutating: true, requiresApproval: false },
  { name: "wait_for_server", category: "shell", description: "Wait for a server to respond", parameters: [{ name: "url", type: "string", required: true, description: "Server URL" }], verificationStrategy: "state", mutating: false, requiresApproval: false },

  // HTTP tools
  { name: "http_request", category: "http", description: "Make an HTTP request", parameters: [{ name: "url", type: "string", required: true, description: "Request URL" }, { name: "method", type: "string", required: false, description: "HTTP method" }], verificationStrategy: "error", mutating: true, requiresApproval: false },

  // File tools
  { name: "read_file", category: "file", description: "Read a file", parameters: [{ name: "path", type: "string", required: true, description: "File path" }], verificationStrategy: "error", mutating: false, requiresApproval: false },
  { name: "write_file", category: "file", description: "Write a file", parameters: [{ name: "path", type: "string", required: true, description: "File path" }], verificationStrategy: "error", mutating: true, requiresApproval: true },

  // Code tools
  { name: "run_code", category: "code", description: "Execute code in a sandbox", parameters: [{ name: "language", type: "string", required: true, description: "Language" }, { name: "code", type: "string", required: true, description: "Source code" }], verificationStrategy: "error", mutating: true, requiresApproval: true },

  // OSINT tools
  { name: "osint_investigate", category: "osint", description: "Run full OSINT investigation on a target (domain/IP/email/username)", parameters: [{ name: "target", type: "string", required: true, description: "Target to investigate" }, { name: "type", type: "string", required: false, description: "Investigation type: domain|network|identity|web|full" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_domain", category: "osint", description: "Domain reconnaissance: WHOIS, DNS, subdomains, certificates", parameters: [{ name: "target", type: "string", required: true, description: "Domain to investigate" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_network", category: "osint", description: "Network reconnaissance: port scan, geolocation, traceroute, banners", parameters: [{ name: "target", type: "string", required: true, description: "IP or domain to scan" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_identity", category: "osint", description: "Identity reconnaissance: username enumeration, email validation, social profiles", parameters: [{ name: "target", type: "string", required: true, description: "Username or email to investigate" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_web", category: "osint", description: "Web intelligence: tech stack, Wayback Machine, robots.txt, Google dorks", parameters: [{ name: "target", type: "string", required: true, description: "URL or domain" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_threat", category: "osint", description: "Threat intelligence: malware/phishing detection, DNSBL, SSL security, suspicious pattern analysis", parameters: [{ name: "target", type: "string", required: true, description: "Domain or URL to check" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_asn", category: "osint", description: "ASN/IP intelligence: reverse IP lookup, AS number enumeration, IP block mapping, co-hosted domains", parameters: [{ name: "target", type: "string", required: true, description: "IP address" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_crawl", category: "osint", description: "Deep site crawl: recursive page discovery, email/phone extraction, form detection, link analysis", parameters: [{ name: "target", type: "string", required: true, description: "URL to crawl" }, { name: "maxPages", type: "number", required: false, description: "Max pages to crawl (default 20)" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_breach", category: "osint", description: "Breach check: password leak detection via HIBP k-anonymity, email breach lookup, password strength analysis", parameters: [{ name: "target", type: "string", required: true, description: "Email or password to check" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
  { name: "osint_screenshot", category: "osint", description: "Visual recon: capture full-page screenshot of target website", parameters: [{ name: "target", type: "string", required: true, description: "URL to screenshot" }], verificationStrategy: "output", mutating: false, requiresApproval: false },
];

const registry = new Map<string, ToolDefinition>();

// Initialize with built-in tools
for (const tool of BUILTIN_TOOLS) {
  registry.set(tool.name, tool);
}

/**
 * Register a custom tool. Overwrites if same name exists.
 */
export function registerTool(tool: ToolDefinition): void {
  registry.set(tool.name, tool);
}

/**
 * Unregister a tool by name.
 */
export function unregisterTool(name: string): boolean {
  return registry.delete(name);
}

/**
 * Get a tool definition by name.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

/**
 * List all registered tools.
 */
export function listTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

/**
 * List tools by category.
 */
export function listToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return Array.from(registry.values()).filter(t => t.category === category);
}

/**
 * Get the verification strategy for a tool.
 */
export function getVerificationStrategy(toolName: string): ToolDefinition["verificationStrategy"] {
  return registry.get(toolName)?.verificationStrategy ?? "error";
}

/**
 * Check if a tool requires human approval.
 */
export function toolRequiresApproval(toolName: string): boolean {
  return registry.get(toolName)?.requiresApproval ?? false;
}

/**
 * Check if a tool is mutating (changes state).
 */
export function isToolMutating(toolName: string): boolean {
  return registry.get(toolName)?.mutating ?? true;
}

/**
 * Get a summary of agent capabilities.
 */
export function getCapabilitySummary(): Record<ToolCategory, string[]> {
  const summary: Record<string, string[]> = {};
  for (const tool of registry.values()) {
    if (!summary[tool.category]) summary[tool.category] = [];
    summary[tool.category].push(tool.name);
  }
  return summary as Record<ToolCategory, string[]>;
}
