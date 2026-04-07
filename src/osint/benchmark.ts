/**
 * OSINT Benchmark Suite — end-to-end reliability testing
 * Tests every module against real targets, measures success rate + performance
 * Run: node --import tsx src/osint/benchmark.ts
 */

interface BenchmarkResult {
  module: string;
  test: string;
  status: "pass" | "fail" | "timeout" | "empty";
  durationMs: number;
  resultSize?: number;  // Number of items returned
  error?: string;
  details?: string;
}

interface BenchmarkReport {
  results: BenchmarkResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    timeout: number;
    empty: number;
    successRate: string;
    totalDurationMs: number;
  };
  byModule: Record<string, { pass: number; fail: number; avgMs: number }>;
  timestamp: string;
}

// ── Test Runner ─────────────────────────────────────────

async function runTest(
  module: string,
  test: string,
  fn: () => Promise<any>,
  validator: (result: any) => { ok: boolean; size?: number; detail?: string },
  timeoutMs = 30000
): Promise<BenchmarkResult> {
  const start = Date.now();

  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)),
    ]);

    const duration = Date.now() - start;
    const validation = validator(result);

    if (!validation.ok) {
      return { module, test, status: "empty", durationMs: duration, resultSize: validation.size || 0, details: validation.detail };
    }

    return { module, test, status: "pass", durationMs: duration, resultSize: validation.size, details: validation.detail };
  } catch (err) {
    const duration = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);

    return {
      module,
      test,
      status: msg === "TIMEOUT" ? "timeout" : "fail",
      durationMs: duration,
      error: msg,
    };
  }
}

// ── All Tests ───────────────────────────────────────────

async function runAllBenchmarks(): Promise<BenchmarkReport> {
  const results: BenchmarkResult[] = [];
  const totalStart = Date.now();

  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║  Panopticon OSINT Benchmark Suite                  ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  // ── Domain Recon ────────────────────────────────────
  console.log("▸ Domain Recon");

  results.push(await runTest("domain", "WHOIS lookup", async () => {
    const { whoisLookup } = await import("./domain-recon.js");
    return whoisLookup("github.com");
  }, r => ({ ok: !!r.registrar || r.raw?.length > 100, size: r.nameServers?.length, detail: `registrar: ${r.registrar || "N/A"}` })));

  results.push(await runTest("domain", "DNS enumeration", async () => {
    const { dnsLookup } = await import("./domain-recon.js");
    return dnsLookup("github.com", ["A", "MX", "NS"]);
  }, r => ({ ok: r.length > 0, size: r.length, detail: `${r.length} records` })));

  results.push(await runTest("domain", "Subdomain discovery", async () => {
    const { enumerateSubdomains } = await import("./domain-recon.js");
    return enumerateSubdomains("github.com");
  }, r => ({ ok: r.length > 0, size: r.length, detail: `${r.length} subdomains` }), 60000));

  results.push(await runTest("domain", "Reverse DNS", async () => {
    const { reverseDns } = await import("./domain-recon.js");
    return reverseDns("8.8.8.8");
  }, r => ({ ok: true, size: r.length, detail: r.join(", ") || "no PTR" })));

  // ── Network Recon ───────────────────────────────────
  console.log("▸ Network Recon");

  results.push(await runTest("network", "Port scan (3 ports)", async () => {
    const { portScan } = await import("./network-recon.js");
    return portScan("1.1.1.1", [53, 80, 443], { timeoutMs: 5000 });
  }, r => {
    const open = r.filter((p: any) => p.state === "open");
    return { ok: open.length > 0, size: open.length, detail: open.map((p: any) => `${p.port}/${p.service}`).join(", ") };
  }));

  results.push(await runTest("network", "GeoIP lookup", async () => {
    const { geolocateIp } = await import("./network-recon.js");
    return geolocateIp("8.8.8.8");
  }, r => ({ ok: !!r.country, size: 1, detail: `${r.country} ${r.city} (${r.source})` })));

  results.push(await runTest("network", "HTTP header analysis", async () => {
    const { analyzeHttpHeaders } = await import("./network-recon.js");
    return analyzeHttpHeaders("https://github.com");
  }, r => ({ ok: r.statusCode > 0, size: Object.keys(r.headers).length, detail: `${r.statusCode} | server: ${r.server || "N/A"}` })));

  // ── Identity Recon ──────────────────────────────────
  console.log("▸ Identity Recon");

  results.push(await runTest("identity", "Username enum (dev only)", async () => {
    const { enumerateUsername } = await import("./identity-recon.js");
    return enumerateUsername("torvalds", { categories: ["dev"], concurrency: 5 });
  }, r => {
    const found = r.filter((p: any) => p.exists);
    return { ok: found.length > 0, size: found.length, detail: `${found.length}/${r.length} platforms` };
  }, 60000));

  results.push(await runTest("identity", "Email validation", async () => {
    const { validateEmail } = await import("./identity-recon.js");
    return validateEmail("info@github.com");
  }, r => ({ ok: r.format && r.mxRecords.length > 0, size: r.mxRecords.length, detail: `MX: ${r.mxRecords[0] || "none"} | disposable: ${r.disposable}` })));

  // ── Web Intel ───────────────────────────────────────
  console.log("▸ Web Intel");

  results.push(await runTest("web", "Tech stack detection", async () => {
    const { detectTechStack } = await import("./web-intel.js");
    return detectTechStack("https://vercel.com");
  }, r => ({ ok: !!r.server || r.javascript.length > 0, size: r.javascript.length + r.css.length, detail: `server: ${r.server} | JS: ${r.javascript.join(", ") || "none"}` })));

  results.push(await runTest("web", "Google dorks generation", async () => {
    const { generateDorks } = await import("./web-intel.js");
    return generateDorks("github.com");
  }, r => ({ ok: Object.keys(r).length > 0, size: Object.keys(r).length, detail: `${Object.keys(r).length} dork queries` })));

  results.push(await runTest("web", "Robots.txt analysis", async () => {
    const { analyzeRobots } = await import("./web-intel.js");
    return analyzeRobots("https://github.com");
  }, r => ({ ok: true, size: r.disallowed.length, detail: `${r.disallowed.length} disallowed, ${r.sitemaps.length} sitemaps` })));

  // ── Threat Intel ────────────────────────────────────
  console.log("▸ Threat Intel");

  results.push(await runTest("threat", "Suspicious pattern detection", async () => {
    const { detectSuspiciousPatterns } = await import("./threat-intel.js");
    return detectSuspiciousPatterns("paypal-secure-login.tk");
  }, r => ({ ok: r.length >= 2, size: r.length, detail: `${r.length} patterns detected` })));

  results.push(await runTest("threat", "DNSBL check", async () => {
    const { checkDnsBlacklists } = await import("./threat-intel.js");
    return checkDnsBlacklists("8.8.8.8");
  }, r => ({ ok: r.length > 0, size: r.length, detail: `${r.length} DNSBLs checked, ${r.filter((b: any) => b.listed).length} listed` })));

  // ── Breach Check ────────────────────────────────────
  console.log("▸ Breach Check");

  results.push(await runTest("breach", "HIBP password check", async () => {
    const { checkPasswordLeak } = await import("./breach-check.js");
    return checkPasswordLeak("password");
  }, r => ({ ok: r.leaked, size: r.count, detail: `leaked: ${r.leaked} | count: ${r.count.toLocaleString()}` })));

  results.push(await runTest("breach", "Password strength", async () => {
    const { analyzePassword } = await import("./breach-check.js");
    return analyzePassword("Tr0ub4dor&3");
  }, r => ({ ok: r.entropy > 0, size: 1, detail: `score: ${r.score} | entropy: ${r.entropy} bits | crack: ${r.timeToCrack}` })));

  // ── ASN / Reverse IP ────────────────────────────────
  console.log("▸ ASN / Reverse IP");

  results.push(await runTest("asn", "ASN lookup", async () => {
    const { asnLookup } = await import("./reverse-ip.js");
    return asnLookup("8.8.8.8");
  }, r => ({ ok: !!r.asn, size: 1, detail: `${r.asn} ${r.name} | CIDR: ${r.cidr}` })));

  results.push(await runTest("asn", "Reverse IP lookup", async () => {
    const { reverseIpLookup } = await import("./reverse-ip.js");
    return reverseIpLookup("20.27.177.113");
  }, r => ({ ok: true, size: r.domains.length, detail: `${r.domains.length} co-hosted domains` })));

  // ── WAF/CDN ─────────────────────────────────────────
  console.log("▸ WAF / CDN Detection");

  results.push(await runTest("waf", "WAF/CDN detection", async () => {
    const { detectWaf } = await import("./waf-detect.js");
    return detectWaf("https://github.com");
  }, r => ({ ok: true, size: r.waf.length + r.cdn.length, detail: `WAF: ${r.waf.map((w: any) => w.name).join(", ") || "none"} | CDN: ${r.cdn.map((c: any) => c.name).join(", ") || "none"}` })));

  // ── SSL Deep ────────────────────────────────────────
  console.log("▸ SSL Analysis");

  results.push(await runTest("ssl", "SSL deep analysis", async () => {
    const { sslDeepAnalysis } = await import("./advanced-recon.js");
    return sslDeepAnalysis("github.com");
  }, r => ({ ok: !!r.protocol, size: r.sanNames?.length || 0, detail: `${r.protocol} | ${r.cipher} | chain: ${r.chainLength} | issues: ${r.issues?.length}` })));

  // ── News ────────────────────────────────────────────
  console.log("▸ News Collection");

  results.push(await runTest("news", "Google News RSS", async () => {
    const { searchGoogleNews } = await import("./news-collector.js");
    return searchGoogleNews("technology");
  }, r => ({ ok: r.length > 0, size: r.length, detail: `${r.length} articles` })));

  // ── Social Media ────────────────────────────────────
  console.log("▸ Social Media");

  results.push(await runTest("social", "Hacker News search", async () => {
    const { searchHackerNews } = await import("./social-media.js");
    return searchHackerNews("security", { limit: 5 });
  }, r => ({ ok: r.length > 0, size: r.length, detail: `${r.length} posts` })));

  // ── Sentiment ───────────────────────────────────────
  console.log("▸ Sentiment Analysis");

  results.push(await runTest("sentiment", "English sentiment", async () => {
    const { analyzeSentiment } = await import("./sentiment.js");
    return analyzeSentiment("This product is excellent and amazing, truly outstanding quality");
  }, r => ({ ok: r.score > 0 && r.label.includes("positive"), size: 1, detail: `score: ${r.score} | label: ${r.label}` })));

  results.push(await runTest("sentiment", "Chinese sentiment", async () => {
    const { analyzeSentiment } = await import("./sentiment.js");
    return analyzeSentiment("股价暴跌，投资者亏损严重，市场担忧加剧");
  }, r => ({ ok: r.score < 0, size: 1, detail: `score: ${r.score} | label: ${r.label}` })));

  results.push(await runTest("sentiment", "Entity extraction", async () => {
    const { extractEntities } = await import("./sentiment.js");
    return extractEntities("Apple announced $5 billion revenue in United States");
  }, r => ({ ok: r.length > 0, size: r.length, detail: r.map((e: any) => `${e.type}:${e.text}`).join(", ") })));

  // ── NL Investigator ─────────────────────────────────
  console.log("▸ NL Investigator");

  results.push(await runTest("nl", "Domain target parse", async () => {
    const { parseNaturalLanguage } = await import("./nl-investigator.js");
    return parseNaturalLanguage("investigate github.com");
  }, r => ({ ok: r.targets.includes("github.com"), size: r.suggestedChain.steps.length, detail: `targets: ${r.targets.join(",")} | steps: ${r.suggestedChain.steps.length}` })));

  results.push(await runTest("nl", "IP target parse", async () => {
    const { parseNaturalLanguage } = await import("./nl-investigator.js");
    return parseNaturalLanguage("scan ports on 8.8.8.8");
  }, r => ({ ok: r.targets.includes("8.8.8.8"), size: r.suggestedChain.steps.length, detail: `targets: ${r.targets.join(",")} | steps: ${r.suggestedChain.steps.map((s: any) => s.type).join("→")}` })));

  // ── Graph ───────────────────────────────────────────
  console.log("▸ Data Correlator");

  results.push(await runTest("graph", "Entity graph + clustering", async () => {
    const { IntelGraph } = await import("./data-correlator.js");
    const g = new IntelGraph();
    const d = g.addEntity("domain", "test.com");
    const ip = g.addEntity("ip", "1.2.3.4");
    g.addRelation(d, ip, "resolves_to");
    return g.toJSON();
  }, r => ({ ok: (r as any).stats.entityCount === 2, size: (r as any).stats.entityCount, detail: `${(r as any).stats.entityCount} entities, ${(r as any).stats.relationCount} relations` })));

  // ── Dir Bruteforce ──────────────────────────────────
  console.log("▸ Security Scanning");

  results.push(await runTest("dirscan", "CORS check", async () => {
    const { checkCors } = await import("./dir-bruteforce.js");
    return checkCors("https://example.com");
  }, r => ({ ok: typeof r.vulnerable === "boolean", size: r.issues.length, detail: `vulnerable: ${r.vulnerable} | issues: ${r.issues.length}` })));

  // ── Report ──────────────────────────────────────────
  console.log("▸ Report Generation\n");

  results.push(await runTest("report", "Markdown report", async () => {
    const { generateReport } = await import("./report-generator.js");
    return generateReport("test.com", {});
  }, r => ({ ok: r.markdown.length > 100, size: r.sections.length, detail: `${r.markdown.length} chars | risk: ${r.riskLevel}` })));

  // ── Summary ─────────────────────────────────────────

  const totalDuration = Date.now() - totalStart;
  const pass = results.filter(r => r.status === "pass").length;
  const fail = results.filter(r => r.status === "fail").length;
  const timeout = results.filter(r => r.status === "timeout").length;
  const empty = results.filter(r => r.status === "empty").length;

  // Print results
  console.log("═══════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("═══════════════════════════════════════════════════\n");

  for (const r of results) {
    const icon = r.status === "pass" ? "✓" : r.status === "empty" ? "○" : r.status === "timeout" ? "⏱" : "✗";
    const color = r.status === "pass" ? "\x1b[32m" : r.status === "fail" ? "\x1b[31m" : r.status === "timeout" ? "\x1b[33m" : "\x1b[90m";
    const time = `${(r.durationMs / 1000).toFixed(1)}s`.padStart(6);
    console.log(`${color}  ${icon} ${r.module.padEnd(12)} ${r.test.padEnd(30)} ${time}  ${r.details || r.error || ""}\x1b[0m`);
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  Total: ${results.length} | Pass: ${pass} | Fail: ${fail} | Timeout: ${timeout} | Empty: ${empty}`);
  console.log(`  Success Rate: ${((pass / results.length) * 100).toFixed(1)}%`);
  console.log(`  Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log("═══════════════════════════════════════════════════\n");

  // By module
  const byModule: Record<string, { pass: number; fail: number; avgMs: number }> = {};
  for (const r of results) {
    if (!byModule[r.module]) byModule[r.module] = { pass: 0, fail: 0, avgMs: 0 };
    if (r.status === "pass") byModule[r.module].pass++;
    else byModule[r.module].fail++;
    byModule[r.module].avgMs += r.durationMs;
  }
  for (const m of Object.values(byModule)) {
    m.avgMs = Math.round(m.avgMs / (m.pass + m.fail));
  }

  return {
    results,
    summary: {
      total: results.length,
      pass, fail, timeout, empty,
      successRate: `${((pass / results.length) * 100).toFixed(1)}%`,
      totalDurationMs: totalDuration,
    },
    byModule,
    timestamp: new Date().toISOString(),
  };
}

// ── Main ────────────────────────────────────────────────

runAllBenchmarks().then(report => {
  // Save report
  const fs = require("fs");
  const path = `artifacts/benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  try {
    fs.mkdirSync("artifacts", { recursive: true });
    fs.writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(`Report saved: ${path}`);
  } catch {}

  process.exit(report.summary.fail > 0 ? 1 : 0);
});
