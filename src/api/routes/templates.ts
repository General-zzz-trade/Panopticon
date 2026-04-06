import type { FastifyInstance } from "fastify";
import { submitJob } from "../../worker/pool";
import { sanitizeGoal } from "../sanitize";

/* ------------------------------------------------------------------ */
/*  Template Marketplace                                               */
/* ------------------------------------------------------------------ */

export interface TemplateVariable {
  name: string;
  description: string;
  default?: string;
}

export interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  goal: string; // goal text with {{variable}} placeholders
  variables: TemplateVariable[];
  popularity: number;
}

/* ---- In-memory template store ---- */

const templates: Map<string, Template> = new Map();

function seed(): void {
  const defs: Template[] = [
    {
      id: "scrape-website",
      name: "Scrape Website",
      category: "scraping",
      description: "Extract text content from a given URL",
      goal: "Open {{url}} and extract all visible text content from the page",
      variables: [{ name: "url", description: "URL to scrape" }],
      popularity: 95,
    },
    {
      id: "monitor-uptime",
      name: "Monitor Uptime",
      category: "monitoring",
      description: "Check if a website is up and responding",
      goal: "Send an HTTP GET request to {{url}} and verify it returns a 2xx status code",
      variables: [
        { name: "url", description: "URL to monitor" },
      ],
      popularity: 90,
    },
    {
      id: "screenshot-page",
      name: "Screenshot Page",
      category: "scraping",
      description: "Take a screenshot of a web page",
      goal: "Open {{url}} in a browser and take a full-page screenshot",
      variables: [{ name: "url", description: "URL to screenshot" }],
      popularity: 88,
    },
    {
      id: "search-google",
      name: "Search Google",
      category: "research",
      description: "Search Google for a topic and return top results",
      goal: "Open Google and search for '{{query}}', then extract the top 10 result titles and URLs",
      variables: [{ name: "query", description: "Search query" }],
      popularity: 85,
    },
    {
      id: "fill-form",
      name: "Fill Form",
      category: "automation",
      description: "Fill and submit a web form with provided values",
      goal: "Open {{url}}, fill the form field '{{fieldName}}' with '{{value}}', and submit the form",
      variables: [
        { name: "url", description: "URL of the page with the form" },
        { name: "fieldName", description: "Name or label of the form field" },
        { name: "value", description: "Value to enter in the field" },
      ],
      popularity: 82,
    },
    {
      id: "login-check",
      name: "Login Check",
      category: "testing",
      description: "Verify that login works with given credentials",
      goal: "Open {{url}}, enter username '{{username}}' and password '{{password}}', submit the login form, and verify the login succeeded",
      variables: [
        { name: "url", description: "Login page URL" },
        { name: "username", description: "Username" },
        { name: "password", description: "Password" },
      ],
      popularity: 80,
    },
    {
      id: "price-monitor",
      name: "Price Monitor",
      category: "monitoring",
      description: "Check the current price of a product on a page",
      goal: "Open {{url}} and extract the product price displayed on the page for '{{productName}}'",
      variables: [
        { name: "url", description: "Product page URL" },
        { name: "productName", description: "Name of the product", default: "" },
      ],
      popularity: 78,
    },
    {
      id: "news-digest",
      name: "News Digest",
      category: "research",
      description: "Get the top stories from Hacker News",
      goal: "Open https://news.ycombinator.com and extract the top {{count}} story titles and URLs",
      variables: [
        { name: "count", description: "Number of stories to extract", default: "10" },
      ],
      popularity: 76,
    },
    {
      id: "api-health",
      name: "API Health Check",
      category: "monitoring",
      description: "Test an API endpoint and verify the response",
      goal: "Send an HTTP {{method}} request to {{url}} and verify the response status is {{expectedStatus}}",
      variables: [
        { name: "url", description: "API endpoint URL" },
        { name: "method", description: "HTTP method", default: "GET" },
        { name: "expectedStatus", description: "Expected HTTP status code", default: "200" },
      ],
      popularity: 74,
    },
    {
      id: "file-search",
      name: "File Search",
      category: "automation",
      description: "Find files matching a pattern on the filesystem",
      goal: "Search the directory '{{directory}}' for files matching the pattern '{{pattern}}'",
      variables: [
        { name: "directory", description: "Directory to search in", default: "." },
        { name: "pattern", description: "File name or glob pattern" },
      ],
      popularity: 70,
    },
    {
      id: "git-status",
      name: "Git Status",
      category: "automation",
      description: "Check the status of a git repository",
      goal: "Run 'git status' in the directory '{{repoPath}}' and report uncommitted changes",
      variables: [
        { name: "repoPath", description: "Path to the git repository", default: "." },
      ],
      popularity: 68,
    },
    {
      id: "run-tests",
      name: "Run Tests",
      category: "testing",
      description: "Execute a test suite and report results",
      goal: "Run '{{testCommand}}' in the directory '{{directory}}' and report pass/fail results",
      variables: [
        { name: "testCommand", description: "Test command to run", default: "npm test" },
        { name: "directory", description: "Project directory", default: "." },
      ],
      popularity: 66,
    },
    {
      id: "deploy-check",
      name: "Deploy Check",
      category: "monitoring",
      description: "Verify a deployment is live and healthy",
      goal: "Open {{url}} and verify the page contains the text '{{expectedText}}' to confirm successful deployment",
      variables: [
        { name: "url", description: "Deployed application URL" },
        { name: "expectedText", description: "Text expected on the page", default: "OK" },
      ],
      popularity: 64,
    },
    {
      id: "ssl-check",
      name: "SSL Certificate Check",
      category: "monitoring",
      description: "Check the SSL certificate of a domain",
      goal: "Check the SSL certificate for '{{domain}}' and report its expiry date and validity",
      variables: [
        { name: "domain", description: "Domain to check (e.g. example.com)" },
      ],
      popularity: 62,
    },
    {
      id: "dns-lookup",
      name: "DNS Lookup",
      category: "monitoring",
      description: "Resolve a domain name to its IP addresses",
      goal: "Perform a DNS lookup for '{{domain}}' and return the resolved A and AAAA records",
      variables: [
        { name: "domain", description: "Domain to resolve" },
      ],
      popularity: 60,
    },
    {
      id: "page-speed",
      name: "Page Speed",
      category: "testing",
      description: "Measure page load time for a URL",
      goal: "Open {{url}} in a browser and measure the total page load time in milliseconds",
      variables: [
        { name: "url", description: "URL to measure" },
      ],
      popularity: 58,
    },
    {
      id: "broken-links",
      name: "Broken Links Checker",
      category: "testing",
      description: "Find broken links on a web page",
      goal: "Open {{url}}, extract all links on the page, and check each one for broken (4xx/5xx) responses",
      variables: [
        { name: "url", description: "URL to check for broken links" },
      ],
      popularity: 56,
    },
    {
      id: "seo-audit",
      name: "SEO Audit",
      category: "research",
      description: "Check basic SEO elements on a page",
      goal: "Open {{url}} and extract the page title, meta description, heading structure (h1-h3), and Open Graph tags",
      variables: [
        { name: "url", description: "URL to audit" },
      ],
      popularity: 54,
    },
    {
      id: "accessibility-check",
      name: "Accessibility Check",
      category: "testing",
      description: "Run a basic accessibility audit on a page",
      goal: "Open {{url}} and check for accessibility issues: missing alt text, low contrast, missing ARIA labels, and heading order",
      variables: [
        { name: "url", description: "URL to audit" },
      ],
      popularity: 52,
    },
    {
      id: "data-extract",
      name: "Data Extract",
      category: "scraping",
      description: "Extract structured data from a web page",
      goal: "Open {{url}} and extract structured data matching the pattern '{{dataDescription}}' as JSON",
      variables: [
        { name: "url", description: "URL to extract data from" },
        { name: "dataDescription", description: "Description of the data to extract (e.g. 'table rows with name and price')" },
      ],
      popularity: 50,
    },
  ];

  for (const t of defs) {
    templates.set(t.id, t);
  }
}

// Seed on module load
seed();

/* ---- Helpers ---- */

function substituteVariables(goalTemplate: string, vars: Record<string, string>): string {
  return goalTemplate.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

/* ---- Routes ---- */

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  // GET /templates — list all templates
  app.get<{ Querystring: { category?: string } }>("/templates", async (request, reply) => {
    let list = Array.from(templates.values());
    const { category } = request.query;
    if (category) {
      list = list.filter((t) => t.category === category);
    }
    list.sort((a, b) => b.popularity - a.popularity);
    return reply.send({
      templates: list.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        popularity: t.popularity,
      })),
    });
  });

  // GET /templates/:id — full template detail
  app.get<{ Params: { id: string } }>("/templates/:id", async (request, reply) => {
    const t = templates.get(request.params.id);
    if (!t) return reply.code(404).send({ error: "Template not found" });
    return reply.send(t);
  });

  // POST /templates/:id/run — execute a template
  app.post<{
    Params: { id: string };
    Body: { variables?: Record<string, string>; options?: Record<string, unknown> };
  }>(
    "/templates/:id/run",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            variables: { type: "object" },
            options: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      const t = templates.get(request.params.id);
      if (!t) return reply.code(404).send({ error: "Template not found" });

      const vars: Record<string, string> = {};
      // Apply defaults first
      for (const v of t.variables) {
        if (v.default !== undefined) vars[v.name] = v.default;
      }
      // Override with provided variables
      if (request.body.variables) {
        Object.assign(vars, request.body.variables);
      }

      // Check required variables (those without defaults)
      const missing = t.variables.filter(
        (v) => v.default === undefined && !vars[v.name]
      );
      if (missing.length > 0) {
        return reply.code(400).send({
          error: "Missing required variables",
          missing: missing.map((v) => v.name),
        });
      }

      const goal = substituteVariables(t.goal, vars);
      const sanitized = sanitizeGoal(goal);
      if (!sanitized) return reply.code(400).send({ error: "goal is empty after sanitization" });

      const tenantId = request.tenantId ?? "default";
      const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;

      // Bump popularity
      t.popularity += 1;

      submitJob(runId, sanitized, request.body.options ?? {}, tenantId);
      return reply.code(202).send({
        runId,
        status: "pending",
        templateId: t.id,
        resolvedGoal: sanitized,
      });
    }
  );
}
