/**
 * OSINT API Routes — /api/v1/osint/*
 * Provides REST endpoints for all OSINT reconnaissance capabilities
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

interface OsintQuery {
  target: string;
  type?: string;
}

export default async function osintRoutes(app: FastifyInstance) {
  // ── Full Investigation ────────────────────────────────
  app.post("/osint/investigate", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target, type } = request.body as OsintQuery;
    if (!target) return reply.code(400).send({ error: "target is required" });

    const osint = await import("../../osint/index.js");
    const result = await osint.investigate(target, type as any);

    return {
      success: true,
      target,
      type: result.type,
      riskLevel: result.report.riskLevel,
      riskFactors: result.report.riskFactors,
      recommendations: result.report.recommendations,
      stats: (result.graph as any).stats,
      durationMs: result.durationMs,
      report: result.report.markdown,
      data: result,
    };
  });

  // ── Domain Recon ──────────────────────────────────────
  app.post("/osint/domain", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as OsintQuery;
    if (!target) return reply.code(400).send({ error: "target is required" });

    const { fullDomainRecon } = await import("../../osint/domain-recon.js");
    const result = await fullDomainRecon(target);

    return { success: true, target, data: result };
  });

  // ── WHOIS ─────────────────────────────────────────────
  app.get("/osint/whois/:domain", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.params as { domain: string };
    const { whoisLookup } = await import("../../osint/domain-recon.js");
    const result = await whoisLookup(domain);
    return { success: true, data: result };
  });

  // ── DNS ───────────────────────────────────────────────
  app.get("/osint/dns/:domain", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.params as { domain: string };
    const { dnsLookup } = await import("../../osint/domain-recon.js");
    const result = await dnsLookup(domain);
    return { success: true, data: result };
  });

  // ── Subdomains ────────────────────────────────────────
  app.get("/osint/subdomains/:domain", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.params as { domain: string };
    const { enumerateSubdomains } = await import("../../osint/domain-recon.js");
    const result = await enumerateSubdomains(domain);
    return { success: true, count: result.length, data: result };
  });

  // ── Certificates ──────────────────────────────────────
  app.get("/osint/certs/:domain", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.params as { domain: string };
    const { certTransparency } = await import("../../osint/domain-recon.js");
    const result = await certTransparency(domain);
    return { success: true, count: result.length, data: result };
  });

  // ── Network Recon ─────────────────────────────────────
  app.post("/osint/network", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as OsintQuery;
    if (!target) return reply.code(400).send({ error: "target is required" });

    const { fullNetworkRecon } = await import("../../osint/network-recon.js");
    const result = await fullNetworkRecon(target);

    return { success: true, target, data: result };
  });

  // ── Port Scan ─────────────────────────────────────────
  app.post("/osint/portscan", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { target: string; ports?: number[] };
    if (!body.target) return reply.code(400).send({ error: "target is required" });

    const { portScan } = await import("../../osint/network-recon.js");
    const result = await portScan(body.target, body.ports);
    const open = result.filter(p => p.state === "open");

    return { success: true, target: body.target, openPorts: open.length, totalScanned: result.length, data: result };
  });

  // ── GeoIP ─────────────────────────────────────────────
  app.get("/osint/geoip/:ip", async (request: FastifyRequest, reply: FastifyReply) => {
    const { ip } = request.params as { ip: string };
    const { geolocateIp } = await import("../../osint/network-recon.js");
    const result = await geolocateIp(ip);
    return { success: true, data: result };
  });

  // ── Identity Recon ────────────────────────────────────
  app.post("/osint/identity", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as OsintQuery;
    if (!target) return reply.code(400).send({ error: "target (username or email) is required" });

    const { fullIdentityRecon } = await import("../../osint/identity-recon.js");
    const result = await fullIdentityRecon(target);

    return { success: true, target, data: result };
  });

  // ── Username Enumeration ──────────────────────────────
  app.post("/osint/username", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username: string; categories?: string[] };
    if (!body.username) return reply.code(400).send({ error: "username is required" });

    const { enumerateUsername } = await import("../../osint/identity-recon.js");
    const result = await enumerateUsername(body.username, { categories: body.categories });
    const found = result.filter(r => r.exists);

    return { success: true, username: body.username, found: found.length, total: result.length, profiles: found, all: result };
  });

  // ── Email Validation ──────────────────────────────────
  app.get("/osint/email/:email", async (request: FastifyRequest, reply: FastifyReply) => {
    const { email } = request.params as { email: string };
    const { validateEmail } = await import("../../osint/identity-recon.js");
    const result = await validateEmail(email);
    return { success: true, data: result };
  });

  // ── Web Intelligence ──────────────────────────────────
  app.post("/osint/web", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as OsintQuery;
    if (!target) return reply.code(400).send({ error: "target is required" });

    const url = target.startsWith("http") ? target : `https://${target}`;
    const { fullWebIntel } = await import("../../osint/web-intel.js");
    const result = await fullWebIntel(url);

    return { success: true, target, data: result };
  });

  // ── Tech Stack Detection ──────────────────────────────
  app.get("/osint/techstack", async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.query as { url: string };
    if (!url) return reply.code(400).send({ error: "url query param is required" });

    const { detectTechStack } = await import("../../osint/web-intel.js");
    const result = await detectTechStack(url);
    return { success: true, data: result };
  });

  // ── Wayback Machine ───────────────────────────────────
  app.get("/osint/wayback", async (request: FastifyRequest, reply: FastifyReply) => {
    const { url, limit } = request.query as { url: string; limit?: string };
    if (!url) return reply.code(400).send({ error: "url query param is required" });

    const { waybackDiff } = await import("../../osint/web-intel.js");
    const result = await waybackDiff(url);
    return { success: true, data: result };
  });

  // ── Google Dorks ──────────────────────────────────────
  app.get("/osint/dorks/:domain", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.params as { domain: string };
    const { generateDorks } = await import("../../osint/web-intel.js");
    const dorks = generateDorks(domain);
    return { success: true, domain, dorks };
  });

  // ── EXIF Extraction ───────────────────────────────────
  app.post("/osint/exif", async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.body as { url: string };
    if (!url) return reply.code(400).send({ error: "url is required" });

    const { extractExifFromUrl } = await import("../../osint/metadata-extract.js");
    const result = await extractExifFromUrl(url);
    return { success: true, data: result };
  });

  // ── HTTP Fingerprint ──────────────────────────────────
  app.get("/osint/fingerprint", async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.query as { url: string };
    if (!url) return reply.code(400).send({ error: "url query param is required" });

    const { httpFingerprint } = await import("../../osint/metadata-extract.js");
    const result = await httpFingerprint(url);
    return { success: true, data: result };
  });

  // ══════════════════════════════════════════════════════
  //  NEW MODULES — P0 + P1
  // ══════════════════════════════════════════════════════

  // ── Threat Intelligence ───────────────────────────────
  app.post("/osint/threat", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target is required" });
    const { fullThreatCheck } = await import("../../osint/threat-intel.js");
    const result = await fullThreatCheck(target);
    return { success: true, target, data: result };
  });

  app.post("/osint/threat/urlhaus", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target is required" });
    const { checkUrlhaus } = await import("../../osint/threat-intel.js");
    return { success: true, data: await checkUrlhaus(target) };
  });

  app.post("/osint/threat/blacklists", async (request: FastifyRequest, reply: FastifyReply) => {
    const { ip } = request.body as { ip: string };
    if (!ip) return reply.code(400).send({ error: "ip is required" });
    const { checkDnsBlacklists } = await import("../../osint/threat-intel.js");
    const result = await checkDnsBlacklists(ip);
    const listed = result.filter(b => b.listed).length;
    return { success: true, ip, listed, total: result.length, data: result };
  });

  app.post("/osint/threat/suspicious", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.body as { domain: string };
    if (!domain) return reply.code(400).send({ error: "domain is required" });
    const { detectSuspiciousPatterns } = await import("../../osint/threat-intel.js");
    return { success: true, data: detectSuspiciousPatterns(domain) };
  });

  // ── Reverse IP / ASN ──────────────────────────────────
  app.get("/osint/reverseip/:ip", async (request: FastifyRequest, reply: FastifyReply) => {
    const { ip } = request.params as { ip: string };
    const { reverseIpLookup } = await import("../../osint/reverse-ip.js");
    return { success: true, data: await reverseIpLookup(ip) };
  });

  app.get("/osint/asn/:ip", async (request: FastifyRequest, reply: FastifyReply) => {
    const { ip } = request.params as { ip: string };
    const { asnLookup } = await import("../../osint/reverse-ip.js");
    return { success: true, data: await asnLookup(ip) };
  });

  app.get("/osint/asn/:asn/prefixes", async (request: FastifyRequest, reply: FastifyReply) => {
    const { asn } = request.params as { asn: string };
    const { asnPrefixes } = await import("../../osint/reverse-ip.js");
    return { success: true, data: await asnPrefixes(asn) };
  });

  app.post("/osint/network-intel", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target (IP) is required" });
    const { fullNetworkIntel } = await import("../../osint/reverse-ip.js");
    return { success: true, data: await fullNetworkIntel(target) };
  });

  // ── Deep Crawler ──────────────────────────────────────
  app.post("/osint/crawl", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { target: string; maxPages?: number; maxDepth?: number };
    if (!body.target) return reply.code(400).send({ error: "target is required" });
    const url = body.target.startsWith("http") ? body.target : `https://${body.target}`;
    const { crawlSite } = await import("../../osint/crawler.js");
    const result = await crawlSite(url, { maxPages: body.maxPages || 20, maxDepth: body.maxDepth || 3 });
    return { success: true, data: result };
  });

  // ── Screenshot ────────────────────────────────────────
  app.post("/osint/screenshot", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { url: string; width?: number; height?: number; fullPage?: boolean };
    if (!body.url) return reply.code(400).send({ error: "url is required" });
    const { captureScreenshot } = await import("../../osint/crawler.js");
    const result = await captureScreenshot(body.url, body);
    return { success: true, data: result };
  });

  // ── Breach Check ──────────────────────────────────────
  app.post("/osint/breach", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target (email or password) is required" });
    const { fullBreachCheck } = await import("../../osint/breach-check.js");
    return { success: true, data: await fullBreachCheck(target) };
  });

  app.post("/osint/breach/password", async (request: FastifyRequest, reply: FastifyReply) => {
    const { password } = request.body as { password: string };
    if (!password) return reply.code(400).send({ error: "password is required" });
    const { checkPasswordLeak, analyzePassword } = await import("../../osint/breach-check.js");
    const [leak, strength] = await Promise.all([checkPasswordLeak(password), Promise.resolve(analyzePassword(password))]);
    return { success: true, data: { ...strength, leaked: leak.leaked, leakCount: leak.count } };
  });

  // ── Advanced: Subdomain Bruteforce ────────────────────
  app.post("/osint/subdomains-deep", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.body as { domain: string };
    if (!domain) return reply.code(400).send({ error: "domain is required" });
    const { subdomainBruteforce } = await import("../../osint/advanced-recon.js");
    return { success: true, data: await subdomainBruteforce(domain) };
  });

  // ── Advanced: Email Pattern Mining ────────────────────
  app.post("/osint/email-pattern", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { domain: string; knownEmails?: string[] };
    if (!body.domain) return reply.code(400).send({ error: "domain is required" });
    const { mineEmailPattern } = await import("../../osint/advanced-recon.js");
    return { success: true, data: await mineEmailPattern(body.domain, body.knownEmails) };
  });

  // ── Advanced: SSL Deep Analysis ───────────────────────
  app.get("/osint/ssl-deep/:domain", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.params as { domain: string };
    const { sslDeepAnalysis } = await import("../../osint/advanced-recon.js");
    return { success: true, data: await sslDeepAnalysis(domain) };
  });

  // ── Advanced: Wayback Content Diff ────────────────────
  app.post("/osint/wayback-diff", async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.body as { url: string };
    if (!url) return reply.code(400).send({ error: "url is required" });
    const { waybackContentDiff } = await import("../../osint/advanced-recon.js");
    return { success: true, data: await waybackContentDiff(url) };
  });

  // ── GitHub Recon ──────────────────────────────────────
  app.post("/osint/github", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target is required" });
    const { fullGithubRecon } = await import("../../osint/github-recon.js");
    return { success: true, data: await fullGithubRecon(target) };
  });

  // ── Dork Execution ────────────────────────────────────
  app.post("/osint/dork/execute", async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.body as { query: string };
    if (!query) return reply.code(400).send({ error: "query is required" });
    const { executeDork } = await import("../../osint/dork-executor.js");
    return { success: true, data: await executeDork(query) };
  });

  app.post("/osint/dork/suite", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.body as { domain: string };
    if (!domain) return reply.code(400).send({ error: "domain is required" });
    const { executeDorkSuite } = await import("../../osint/dork-executor.js");
    return { success: true, data: await executeDorkSuite(domain) };
  });

  // ── Document Scanner ──────────────────────────────────
  app.post("/osint/docs", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { target: string; maxPages?: number };
    if (!body.target) return reply.code(400).send({ error: "target is required" });
    const { fullDocScan } = await import("../../osint/doc-scanner.js");
    return { success: true, data: await fullDocScan(body.target, { maxPages: body.maxPages }) };
  });

  // ── Investigation Chain ───────────────────────────────
  app.get("/osint/chains", async () => {
    const { CHAIN_TEMPLATES } = await import("../../osint/investigation-chain.js");
    return { success: true, data: CHAIN_TEMPLATES };
  });

  app.post("/osint/chain/execute", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { chain: string; target: string };
    if (!body.chain || !body.target) return reply.code(400).send({ error: "chain and target are required" });
    const { CHAIN_TEMPLATES, executeChain } = await import("../../osint/investigation-chain.js");
    const template = CHAIN_TEMPLATES[body.chain];
    if (!template) return reply.code(400).send({ error: `Unknown chain: ${body.chain}. Available: ${Object.keys(CHAIN_TEMPLATES).join(", ")}` });
    const result = await executeChain(template, body.target);
    return { success: true, data: result };
  });

  // ── Monitor ───────────────────────────────────────────
  app.get("/osint/monitors", async () => {
    const { listMonitorTargets } = await import("../../osint/monitor.js");
    return { success: true, data: listMonitorTargets() };
  });

  app.post("/osint/monitors", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { target: string; type?: string; checks?: string[]; intervalMs?: number };
    if (!body.target) return reply.code(400).send({ error: "target is required" });
    const { addMonitorTarget } = await import("../../osint/monitor.js");
    const monitor = addMonitorTarget(body.target, (body.type as any) || "domain", (body.checks as any) || ["subdomains", "ports", "uptime"], body.intervalMs);
    return { success: true, data: monitor };
  });

  app.post("/osint/monitors/:id/run", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { runMonitorCheck } = await import("../../osint/monitor.js");
    return { success: true, data: await runMonitorCheck(id) };
  });

  app.delete("/osint/monitors/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { removeMonitorTarget } = await import("../../osint/monitor.js");
    return { success: true, removed: removeMonitorTarget(id) };
  });

  // ── Batch Investigation ───────────────────────────────
  app.post("/osint/batch", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { targets: string[] | string; type?: string; concurrency?: number };
    if (!body.targets) return reply.code(400).send({ error: "targets is required (array or CSV string)" });
    const { parseBatchInput, executeBatch } = await import("../../osint/batch.js");
    const targets = Array.isArray(body.targets)
      ? body.targets.map(t => ({ target: t }))
      : parseBatchInput(body.targets);
    return { success: true, data: await executeBatch(targets, body.type, body.concurrency) };
  });

  // ── Investigation History (SQLite) ────────────────────
  app.get("/osint/history", async (request: FastifyRequest) => {
    const query = request.query as { target?: string; type?: string; limit?: string };
    try {
      const { listInvestigations } = await import("../../osint/storage.js");
      return { success: true, data: listInvestigations({ target: query.target, type: query.type, limit: parseInt(query.limit || "50") }) };
    } catch { return { success: true, data: [] }; }
  });

  app.get("/osint/history/:id", async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    try {
      const { getInvestigation } = await import("../../osint/storage.js");
      return { success: true, data: getInvestigation(id) };
    } catch { return { success: false, data: null }; }
  });

  app.get("/osint/history/:target/diff", async (request: FastifyRequest) => {
    const { target } = request.params as { target: string };
    try {
      const { compareHistory } = await import("../../osint/storage.js");
      return { success: true, data: compareHistory(target) };
    } catch { return { success: true, data: { changes: [] } }; }
  });

  // ── Knowledge Graph Stats ─────────────────────────────
  app.get("/osint/knowledge-graph", async () => {
    try {
      const { getKnowledgeGraphStats } = await import("../../osint/storage.js");
      return { success: true, data: getKnowledgeGraphStats() };
    } catch { return { success: true, data: { entities: 0, relations: 0, entityTypes: {} } }; }
  });

  // ── PDF Export ────────────────────────────────────────
  app.post("/osint/export/pdf", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { report: { markdown: string; title: string; riskLevel: string; timestamp: string }; title?: string };
    if (!body.report?.markdown) return reply.code(400).send({ error: "report with markdown is required" });
    const { generatePdfReport } = await import("../../osint/pdf-export.js");
    const pdf = await generatePdfReport(body.report, { title: body.title });
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="osint-report.pdf"`);
    return reply.send(pdf);
  });

  // ── Webhooks ──────────────────────────────────────────
  app.get("/osint/webhooks", async () => {
    const { listWebhooks } = await import("../../osint/webhook.js");
    return { success: true, data: listWebhooks() };
  });

  app.post("/osint/webhooks", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    if (!body.url || !body.type) return reply.code(400).send({ error: "url and type are required" });
    const { addWebhook } = await import("../../osint/webhook.js");
    return { success: true, data: addWebhook({ type: body.type, url: body.url, name: body.name || body.type, enabled: true, events: body.events || ["investigation_complete", "threat_detected"], token: body.token, chatId: body.chatId }) };
  });

  app.delete("/osint/webhooks/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { removeWebhook } = await import("../../osint/webhook.js");
    return { success: true, removed: removeWebhook(id) };
  });

  app.post("/osint/webhooks/test", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.body as { id: string };
    const { listWebhooks, dispatchWebhook } = await import("../../osint/webhook.js");
    const result = await dispatchWebhook("investigation_complete", {
      event: "test", target: "test.example.com", riskLevel: "low",
      summary: "This is a test notification from Panopticon",
      timestamp: new Date().toISOString(),
    });
    return { success: true, data: result };
  });

  // ── Dark Web Search ───────────────────────────────────
  app.post("/osint/darkweb", async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.body as { query: string };
    if (!query) return reply.code(400).send({ error: "query is required" });
    const { searchDarkWebIndexes } = await import("../../osint/darkweb.js");
    return { success: true, data: await searchDarkWebIndexes(query) };
  });

  // ── Natural Language Investigation ────────────────────
  app.post("/osint/nl", async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.body as { query: string };
    if (!query) return reply.code(400).send({ error: "query is required" });
    const { parseNaturalLanguage } = await import("../../osint/nl-investigator.js");
    const parsed = parseNaturalLanguage(query);
    return { success: true, data: parsed };
  });

  app.post("/osint/nl/execute", async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.body as { query: string };
    if (!query) return reply.code(400).send({ error: "query is required" });
    const { parseNaturalLanguage } = await import("../../osint/nl-investigator.js");
    const { executeChain } = await import("../../osint/investigation-chain.js");
    const parsed = parseNaturalLanguage(query);
    if (parsed.targets.length === 0) return reply.code(400).send({ error: "No targets detected in query" });
    const result = await executeChain(parsed.suggestedChain, parsed.targets[0]);
    return { success: true, parsed, data: result };
  });

  // ── Subdomain Takeover ────────────────────────────────
  app.post("/osint/takeover", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { subdomains: string[] };
    if (!body.subdomains?.length) return reply.code(400).send({ error: "subdomains array is required" });
    const { checkTakeoverBatch } = await import("../../osint/subdomain-takeover.js");
    return { success: true, data: await checkTakeoverBatch(body.subdomains) };
  });

  // ── WAF Detection ────────────────────────────────────
  app.post("/osint/waf", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target is required" });
    const { detectWaf } = await import("../../osint/waf-detect.js");
    return { success: true, data: await detectWaf(target) };
  });

  // ── JS Analysis ──────────────────────────────────────
  app.post("/osint/js-analyze", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target URL is required" });
    const { analyzeJavaScript } = await import("../../osint/js-analyzer.js");
    return { success: true, data: await analyzeJavaScript(target) };
  });

  // ── CVE Matching ─────────────────────────────────────
  app.post("/osint/cve", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { banners?: { port: number; banner: string }[]; headers?: Record<string, string> };
    const { matchCves } = await import("../../osint/cve-matcher.js");
    return { success: true, data: await matchCves(body.banners || [], body.headers) };
  });

  // ── Typosquatting ────────────────────────────────────
  app.post("/osint/typosquat", async (request: FastifyRequest, reply: FastifyReply) => {
    const { domain } = request.body as { domain: string };
    if (!domain) return reply.code(400).send({ error: "domain is required" });
    const { checkTyposquats } = await import("../../osint/typosquat.js");
    return { success: true, data: await checkTyposquats(domain, { maxCheck: 50 }) };
  });

  // ── Cloud Enumeration ────────────────────────────────
  app.post("/osint/cloud", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target is required" });
    const { enumerateCloud } = await import("../../osint/cloud-enum.js");
    return { success: true, data: await enumerateCloud(target) };
  });

  // ── API Discovery ────────────────────────────────────
  app.post("/osint/api-discover", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target URL is required" });
    const { discoverApis } = await import("../../osint/api-discovery.js");
    return { success: true, data: await discoverApis(target) };
  });

  // ── News Monitor ─────────────────────────────────────
  app.post("/osint/news", async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.body as { query: string };
    if (!query) return reply.code(400).send({ error: "query is required" });
    const { monitorNews } = await import("../../osint/news-monitor.js");
    return { success: true, data: await monitorNews(query, { includeGeneral: true }) };
  });

  // ── Directory Bruteforce ──────────────────────────────
  app.post("/osint/dirscan", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target URL is required" });
    const { dirBruteforce } = await import("../../osint/dir-bruteforce.js");
    return { success: true, data: await dirBruteforce(target) };
  });

  // ── CORS Check ────────────────────────────────────────
  app.post("/osint/cors", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target URL is required" });
    const { checkCors } = await import("../../osint/dir-bruteforce.js");
    return { success: true, data: await checkCors(target) };
  });

  // ── HTTP Parameter Discovery ──────────────────────────
  app.post("/osint/params", async (request: FastifyRequest, reply: FastifyReply) => {
    const { target } = request.body as { target: string };
    if (!target) return reply.code(400).send({ error: "target URL is required" });
    const { discoverParams } = await import("../../osint/dir-bruteforce.js");
    return { success: true, data: await discoverParams(target) };
  });

  // ── Cache Management ──────────────────────────────────
  app.get("/osint/cache/stats", async () => {
    const { cacheStats } = await import("../../osint/utils.js");
    return { success: true, data: cacheStats() };
  });

  app.delete("/osint/cache", async () => {
    const { cacheClear } = await import("../../osint/utils.js");
    cacheClear();
    return { success: true, message: "Cache cleared" };
  });

  // ══════════════════════════════════════════════════════
  //  NEWS & SOCIAL MEDIA & SENTIMENT
  // ══════════════════════════════════════════════════════

  // ── News Collection ───────────────────────────────────
  app.post("/osint/news/collect", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { query: string; categories?: string[]; languages?: string[]; fetchFullText?: boolean; feeds?: string[] };
    if (!body.query) return reply.code(400).send({ error: "query is required" });
    const { collectNews } = await import("../../osint/news-collector.js");
    return { success: true, data: await collectNews(body.query, {
      categories: body.categories, languages: body.languages,
      fetchFullText: body.fetchFullText, feedNames: body.feeds,
    }) };
  });

  app.post("/osint/news/google", async (request: FastifyRequest, reply: FastifyReply) => {
    const { query, language } = request.body as { query: string; language?: string };
    if (!query) return reply.code(400).send({ error: "query is required" });
    const { searchGoogleNews } = await import("../../osint/news-collector.js");
    return { success: true, data: await searchGoogleNews(query, { language }) };
  });

  app.post("/osint/news/fulltext", async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.body as { url: string };
    if (!url) return reply.code(400).send({ error: "article url is required" });
    const { getFullText } = await import("../../osint/news-collector.js");
    return { success: true, data: await getFullText(url) };
  });

  app.post("/osint/news/og", async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.body as { url: string };
    if (!url) return reply.code(400).send({ error: "url is required" });
    const { extractOgMeta } = await import("../../osint/news-collector.js");
    return { success: true, data: await extractOgMeta(url) };
  });

  // ── Social Media ──────────────────────────────────────
  app.post("/osint/social", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { query: string; platforms?: string[]; subreddits?: string[]; telegramChannels?: string[] };
    if (!body.query) return reply.code(400).send({ error: "query is required" });
    const { collectSocialMedia } = await import("../../osint/social-media.js");
    return { success: true, data: await collectSocialMedia(body.query, {
      platforms: body.platforms as any, subreddits: body.subreddits, telegramChannels: body.telegramChannels,
    }) };
  });

  app.post("/osint/social/reddit", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { query: string; subreddit?: string; sort?: string };
    if (!body.query) return reply.code(400).send({ error: "query is required" });
    const { searchReddit } = await import("../../osint/social-media.js");
    return { success: true, data: await searchReddit(body.query, { subreddit: body.subreddit, sort: body.sort }) };
  });

  app.post("/osint/social/hackernews", async (request: FastifyRequest, reply: FastifyReply) => {
    const { query } = request.body as { query: string };
    if (!query) return reply.code(400).send({ error: "query is required" });
    const { searchHackerNews } = await import("../../osint/social-media.js");
    return { success: true, data: await searchHackerNews(query) };
  });

  // ── Sentiment Analysis ────────────────────────────────
  app.post("/osint/sentiment", async (request: FastifyRequest, reply: FastifyReply) => {
    const { text } = request.body as { text: string };
    if (!text) return reply.code(400).send({ error: "text is required" });
    const { analyzeSentiment } = await import("../../osint/sentiment.js");
    return { success: true, data: analyzeSentiment(text) };
  });

  app.post("/osint/sentiment/opinion", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { query: string; posts: { content: string; timestamp?: string; score?: number }[] };
    if (!body.query || !body.posts) return reply.code(400).send({ error: "query and posts are required" });
    const { analyzeOpinion } = await import("../../osint/sentiment.js");
    return { success: true, data: analyzeOpinion(body.query, body.posts) };
  });

  // ── Combined: Social + Sentiment Pipeline ─────────────
  app.post("/osint/opinion", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { query: string; platforms?: string[]; subreddits?: string[] };
    if (!body.query) return reply.code(400).send({ error: "query is required" });

    const { collectSocialMedia } = await import("../../osint/social-media.js");
    const { collectNews } = await import("../../osint/news-collector.js");
    const { analyzeOpinion } = await import("../../osint/sentiment.js");

    // Collect from social media + news in parallel
    const [social, news] = await Promise.all([
      collectSocialMedia(body.query, { platforms: body.platforms as any, subreddits: body.subreddits }),
      collectNews(body.query, { maxPerSource: 5 }),
    ]);

    // Combine all posts
    const allPosts = [
      ...social.posts.map(p => ({ content: p.content, timestamp: p.timestamp, score: p.score })),
      ...news.articles.map(a => ({ content: `${a.title}. ${a.summary || ""}`, timestamp: a.published })),
    ];

    const opinion = analyzeOpinion(body.query, allPosts);

    return {
      success: true,
      data: {
        opinion,
        socialPosts: social.stats.totalPosts,
        newsArticles: news.stats.totalArticles,
        sources: [...social.platforms, ...news.sources],
      },
    };
  });
}
