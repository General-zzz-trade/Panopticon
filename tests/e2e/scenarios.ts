export interface TestScenario {
  id: string;
  name: string;
  goal: string;
  expectedTaskTypes: string[];
  timeout: number;
}

export const scenarios: TestScenario[] = [
  // Navigation
  {
    id: "nav-simple",
    name: "Simple page navigation",
    goal: 'go to http://localhost:3210',
    expectedTaskTypes: ["open_page"],
    timeout: 10_000
  },
  {
    id: "nav-visit",
    name: "Visit URL variant",
    goal: 'visit http://localhost:3210/about',
    expectedTaskTypes: ["open_page"],
    timeout: 10_000
  },

  // Form fill
  {
    id: "form-fill-field",
    name: "Fill a single form field",
    goal: 'fill "#email" with "test@example.com" on http://localhost:3210/form',
    expectedTaskTypes: ["open_page", "type"],
    timeout: 15_000
  },
  {
    id: "form-fill-login",
    name: "Login form submission",
    goal: 'login to http://localhost:3210/login with admin/secret123',
    expectedTaskTypes: ["open_page", "type", "type", "click"],
    timeout: 20_000
  },

  // API calls
  {
    id: "api-health-check",
    name: "API health check",
    goal: 'check health of http://localhost:3210/api/health',
    expectedTaskTypes: ["http_request"],
    timeout: 10_000
  },
  {
    id: "api-fetch",
    name: "Fetch a URL",
    goal: 'fetch http://localhost:3210/api/status',
    expectedTaskTypes: ["http_request"],
    timeout: 10_000
  },
  {
    id: "api-test",
    name: "Test API endpoint",
    goal: 'test API at http://localhost:3210/api/v1/health',
    expectedTaskTypes: ["http_request"],
    timeout: 10_000
  },

  // Screenshot
  {
    id: "screenshot-page",
    name: "Take screenshot of page",
    goal: 'take screenshot of http://localhost:3210',
    expectedTaskTypes: ["open_page", "screenshot"],
    timeout: 15_000
  },
  {
    id: "screenshot-short",
    name: "Screenshot shorthand",
    goal: 'screenshot http://localhost:3210/dashboard',
    expectedTaskTypes: ["open_page", "screenshot"],
    timeout: 15_000
  },

  // Search
  {
    id: "search-basic",
    name: "Search for a term on a site",
    goal: 'search for "typescript" on http://localhost:3210',
    expectedTaskTypes: ["open_page", "type", "click"],
    timeout: 20_000
  },

  // File read
  {
    id: "file-read",
    name: "Read a local file",
    goal: 'read file /tmp/test-data.txt',
    expectedTaskTypes: ["read_file"],
    timeout: 10_000
  },
  {
    id: "file-list",
    name: "List files in a directory",
    goal: 'list files in /tmp',
    expectedTaskTypes: ["run_code"],
    timeout: 10_000
  },

  // Shell command
  {
    id: "shell-echo",
    name: "Run a shell command",
    goal: 'run command "echo hello world"',
    expectedTaskTypes: ["run_code"],
    timeout: 10_000
  },
  {
    id: "shell-execute",
    name: "Execute a command",
    goal: 'execute "ls -la /tmp"',
    expectedTaskTypes: ["run_code"],
    timeout: 10_000
  },

  // Multi-step browse
  {
    id: "browse-and-click",
    name: "Navigate and click",
    goal: 'go to http://localhost:3210 and click "#start-btn"',
    expectedTaskTypes: ["open_page", "click"],
    timeout: 15_000
  },

  // Extract text
  {
    id: "extract-text",
    name: "Get text from page",
    goal: 'get text from http://localhost:3210',
    expectedTaskTypes: ["open_page", "visual_extract"],
    timeout: 15_000
  },
  {
    id: "scrape-page",
    name: "Scrape a page",
    goal: 'scrape http://localhost:3210/data',
    expectedTaskTypes: ["open_page", "visual_extract"],
    timeout: 15_000
  },

  // Error recovery scenarios
  {
    id: "recovery-wrong-selector",
    name: "Recovery from wrong selector",
    goal: 'go to http://localhost:3210 and click "#nonexistent-btn"',
    expectedTaskTypes: ["open_page", "click"],
    timeout: 30_000
  },
  {
    id: "recovery-timeout-server",
    name: "Recovery from server timeout",
    goal: 'check health of http://localhost:9999/health',
    expectedTaskTypes: ["http_request"],
    timeout: 15_000
  },

  // Complex multi-step
  {
    id: "complex-search-login",
    name: "Login then search",
    goal: 'login to http://localhost:3210 with user/pass',
    expectedTaskTypes: ["open_page", "type", "type", "click"],
    timeout: 25_000
  }
];

/** Scenarios that do not require a browser (safe for CI without Playwright). */
export const nonBrowserScenarios = scenarios.filter((s) =>
  s.expectedTaskTypes.every(
    (t) => ["http_request", "run_code", "read_file"].includes(t)
  )
);

/** Scenarios that require a browser. */
export const browserScenarios = scenarios.filter((s) =>
  s.expectedTaskTypes.some(
    (t) => !["http_request", "run_code", "read_file"].includes(t)
  )
);
