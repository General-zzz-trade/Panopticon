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
    // ── OSINT Investigation Templates ────────────────────
    {
      id: "osint-full",
      name: "Full OSINT Investigation",
      category: "OSINT",
      description: "Run a comprehensive OSINT investigation on a domain, IP, email, or username — includes domain recon, network scan, web intel, and risk assessment",
      goal: "Perform a full OSINT investigation on {{target}}. Run domain recon (WHOIS, DNS, subdomains, certificates), network recon (port scan, geolocation, banner grabbing), web intelligence (tech stack, Wayback Machine, robots.txt), and generate a risk assessment report.",
      variables: [
        { name: "target", description: "Domain, IP address, email, or username to investigate" },
      ],
      popularity: 180,
    },
    {
      id: "osint-domain",
      name: "Domain Intelligence",
      category: "OSINT",
      description: "WHOIS lookup, DNS enumeration, subdomain discovery, certificate transparency, and zone transfer testing",
      goal: "Investigate the domain {{domain}}: perform WHOIS lookup, enumerate all DNS records (A, AAAA, MX, NS, TXT, CNAME, SOA, SRV, CAA), discover subdomains via certificate transparency and DNS brute-force, and check for zone transfer vulnerabilities.",
      variables: [
        { name: "domain", description: "Target domain name (e.g. example.com)" },
      ],
      popularity: 150,
    },
    {
      id: "osint-network",
      name: "Network Reconnaissance",
      category: "OSINT",
      description: "Port scanning, service detection, banner grabbing, IP geolocation, and traceroute",
      goal: "Perform network reconnaissance on {{target}}: scan common ports (21,22,25,80,443,3306,etc), grab service banners, geolocate the IP, run traceroute, and analyze HTTP security headers.",
      variables: [
        { name: "target", description: "IP address or domain to scan" },
      ],
      popularity: 140,
    },
    {
      id: "osint-identity",
      name: "Identity Lookup",
      category: "OSINT",
      description: "Search for a username or email across 35+ platforms including GitHub, Reddit, Twitter, LinkedIn, Zhihu, Bilibili, and more",
      goal: "Investigate the identity '{{query}}': enumerate this username/email across social media, developer platforms, and professional networks. If email, also validate MX records and check if disposable.",
      variables: [
        { name: "query", description: "Username or email address to investigate" },
      ],
      popularity: 160,
    },
    {
      id: "osint-web",
      name: "Web Intelligence",
      category: "OSINT",
      description: "Technology stack detection, Wayback Machine history, robots.txt analysis, sitemap parsing, and Google dork generation",
      goal: "Gather web intelligence on {{url}}: detect the technology stack (frameworks, CMS, CDN, analytics), check Wayback Machine history, analyze robots.txt and sitemap.xml, extract internal/external links, and generate Google dork queries for deeper research.",
      variables: [
        { name: "url", description: "Website URL to analyze (e.g. https://example.com)" },
      ],
      popularity: 130,
    },
    {
      id: "osint-email",
      name: "Email Validation & Intel",
      category: "OSINT",
      description: "Validate email format, check MX records, detect disposable addresses, SMTP verification, and domain WHOIS",
      goal: "Investigate the email address {{email}}: validate format, check MX records, determine if it's a disposable or role-based address, verify SMTP reachability, and look up the domain registration details.",
      variables: [
        { name: "email", description: "Email address to investigate" },
      ],
      popularity: 120,
    },
    {
      id: "osint-subdomain",
      name: "Subdomain Enumeration",
      category: "OSINT",
      description: "Discover subdomains via certificate transparency logs and DNS brute-force with 70+ common prefixes",
      goal: "Enumerate all subdomains of {{domain}} using certificate transparency (crt.sh) and DNS brute-force. For each discovered subdomain, resolve its IP address.",
      variables: [
        { name: "domain", description: "Parent domain (e.g. example.com)" },
      ],
      popularity: 110,
    },
    {
      id: "osint-techstack",
      name: "Tech Stack Detection",
      category: "OSINT",
      description: "Identify web frameworks, CMS, CDN, analytics, and security tools used by a website",
      goal: "Detect the technology stack of {{url}}: identify JavaScript frameworks (React, Vue, Angular), CSS frameworks (Tailwind, Bootstrap), CMS (WordPress, Drupal), CDN (Cloudflare, AWS), analytics tools, and security measures.",
      variables: [
        { name: "url", description: "Website URL to analyze" },
      ],
      popularity: 100,
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
