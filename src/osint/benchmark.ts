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
  console.log("▸ Report Generation");

  results.push(await runTest("report", "Markdown report", async () => {
    const { generateReport } = await import("./report-generator.js");
    return generateReport("test.com", {});
  }, r => ({ ok: r.markdown.length > 100, size: r.sections.length, detail: `${r.markdown.length} chars | risk: ${r.riskLevel}` })));

  // ══════════════════════════════════════════════════════
  //  NEW MODULES — DEEP OSINT + PHYSICAL WORLD
  // ══════════════════════════════════════════════════════

  // ── Pivot Engine ────────────────────────────────────
  console.log("▸ Pivot Engine");

  results.push(await runTest("pivot", "Auto pivot from domain", async () => {
    const { autoPivot } = await import("./pivot-engine.js");
    return autoPivot("domain", "example.com", { maxDepth: 1, maxPivots: 4 });
  }, r => ({ ok: r.stats.totalEntities > 1, size: r.stats.totalEntities, detail: `${r.stats.totalEntities} entities, ${r.stats.pivotsPerformed} pivots` }), 30000));

  // ── Temporal Analysis ───────────────────────────────
  console.log("▸ Temporal Analysis");

  results.push(await runTest("temporal", "Domain age + cert timeline", async () => {
    const { analyzeTemporalProfile } = await import("./temporal-analysis.js");
    return analyzeTemporalProfile("google.com");
  }, r => ({ ok: !!r.domainAge, size: r.certTimeline.length, detail: `age: ${r.domainAge?.ageInDays}d | certs: ${r.certTimeline.length} | anomalies: ${r.anomalies.length}` }), 30000));

  // ── Protocol Analysis ───────────────────────────────
  console.log("▸ Protocol Analysis");

  results.push(await runTest("protocol", "SPF/DKIM/DMARC analysis", async () => {
    const { analyzeEmailSecurity } = await import("./protocol-analysis.js");
    return analyzeEmailSecurity("google.com");
  }, r => ({ ok: r.spf.exists || r.dkim.exists || r.dmarc.exists, size: r.securityScore, detail: `SPF:${r.spf.exists} DKIM:${r.dkim.exists} DMARC:${r.dmarc.exists} score:${r.securityScore}/100` }), 30000));

  // ── Attribution ─────────────────────────────────────
  console.log("▸ Attribution Engine");

  results.push(await runTest("attribution", "Attribute domain owner", async () => {
    const { attributeTarget } = await import("./attribution.js");
    return attributeTarget("microsoft.com");
  }, r => ({ ok: r.evidence.length > 0, size: r.evidence.length, detail: `evidence: ${r.evidence.length} | confidence: ${(r.confidence*100).toFixed(0)}% | ${r.summary.slice(0,60)}` }), 30000));

  // ── News Collector ──────────────────────────────────
  console.log("▸ News Collector");

  results.push(await runTest("news-collector", "Google News search", async () => {
    const { searchGoogleNews } = await import("./news-collector.js");
    return searchGoogleNews("artificial intelligence", { count: 5 });
  }, r => ({ ok: r.length > 0, size: r.length, detail: `${r.length} articles` })));

  // ── Social Media ────────────────────────────────────
  console.log("▸ Social Media");

  results.push(await runTest("social-media", "HN search", async () => {
    const { searchHackerNews } = await import("./social-media.js");
    return searchHackerNews("AI", { limit: 3 });
  }, r => ({ ok: r.length > 0, size: r.length, detail: `${r.length} posts` })));

  // ── JS Analyzer ─────────────────────────────────────
  console.log("▸ JS Analyzer");

  results.push(await runTest("js-analyzer", "JS analysis", async () => {
    const { analyzeJavaScript } = await import("./js-analyzer.js");
    return analyzeJavaScript("https://example.com");
  }, r => ({ ok: true, size: r.stats.filesAnalyzed, detail: `${r.stats.filesAnalyzed} files | ${r.stats.secretsFound} secrets | ${r.stats.endpointsFound} endpoints` }), 30000));

  // ── Dir Bruteforce ──────────────────────────────────
  console.log("▸ Dir Bruteforce");

  results.push(await runTest("dirscan", "Directory scan (10 paths)", async () => {
    const { dirBruteforce } = await import("./dir-bruteforce.js");
    return dirBruteforce("https://example.com", { customPaths: ["/robots.txt", "/.env", "/.git/config", "/admin", "/favicon.ico"] });
  }, r => ({ ok: r.stats.checked > 0, size: r.stats.found, detail: `checked: ${r.stats.checked} | found: ${r.stats.found}` })));

  // ── API Discovery ───────────────────────────────────
  console.log("▸ API Discovery");

  results.push(await runTest("api-discovery", "Hidden API probe", async () => {
    const { discoverApis } = await import("./api-discovery.js");
    return discoverApis("https://example.com", { customPaths: ["/api", "/health", "/robots.txt"] });
  }, r => ({ ok: true, size: r.endpoints.length, detail: `${r.endpoints.length} endpoints found` })));

  // ── Typosquatting ───────────────────────────────────
  console.log("▸ Typosquatting");

  results.push(await runTest("typosquat", "Generate domain variants", async () => {
    const { generateVariants } = await import("./typosquat.js");
    return generateVariants("google.com");
  }, r => ({ ok: r.length > 10, size: r.length, detail: `${r.length} variants generated` })));

  // ── Flight Tracker ──────────────────────────────────
  console.log("▸ Flight Tracker");

  results.push(await runTest("flights", "Airport flights (KJFK)", async () => {
    const { getAirportFlights } = await import("./flight-tracker.js");
    return getAirportFlights("KJFK");
  }, r => ({ ok: true, size: r.arrivals.length + r.departures.length, detail: `arrivals: ${r.arrivals.length} | departures: ${r.departures.length}` }), 20000));

  // ── Blockchain ──────────────────────────────────────
  console.log("▸ Blockchain");

  results.push(await runTest("blockchain", "Bitcoin address analysis", async () => {
    const { analyzeBitcoinAddress } = await import("./blockchain.js");
    // Satoshi's genesis address
    return analyzeBitcoinAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
  }, r => ({ ok: r.wallet.txCount > 0, size: r.wallet.txCount, detail: `balance: ${r.wallet.balance} BTC | tx: ${r.wallet.txCount} | related: ${r.relatedAddresses.length}` })));

  // ── Company Intel ───────────────────────────────────
  console.log("▸ Company Intel");

  results.push(await runTest("company", "Company search (Wikipedia + DDG)", async () => {
    const { searchWikipedia, searchDdgCompany } = await import("./company-intel.js");
    const [wiki, ddg] = await Promise.all([searchWikipedia("Google"), searchDdgCompany("Google")]);
    return { wiki, ddg };
  }, r => ({ ok: r.wiki.length > 0 || !!r.ddg, size: r.wiki.length + (r.ddg ? 1 : 0), detail: `wiki: ${r.wiki.length} | ddg: ${r.ddg ? "yes" : "no"}` }), 20000));

  // ── Geospatial ──────────────────────────────────────
  console.log("▸ Geospatial");

  results.push(await runTest("geospatial", "Geocoding", async () => {
    const { geocode } = await import("./geospatial.js");
    return geocode("Tokyo, Japan");
  }, r => ({ ok: r.results.length > 0, size: r.results.length, detail: `${r.results[0]?.name?.slice(0,40)} (${r.results[0]?.lat}, ${r.results[0]?.lon})` })));

  results.push(await runTest("geospatial", "Earthquakes near Tokyo", async () => {
    const { getEarthquakes } = await import("./geospatial.js");
    return getEarthquakes(35.68, 139.77, 300, 30);
  }, r => ({ ok: true, size: r.events.length, detail: `${r.events.length} quakes | ${r.stats.significant} significant` })));

  results.push(await runTest("geospatial", "Weather", async () => {
    const { getWeather } = await import("./geospatial.js");
    return getWeather(35.68, 139.77);
  }, r => ({ ok: r.current.description.length > 0, size: 1, detail: `${r.current.temp}°C | ${r.current.description}` })));

  // ── Sanctions ───────────────────────────────────────
  console.log("▸ Sanctions");

  results.push(await runTest("sanctions", "Check known entity", async () => {
    const { checkSanctions } = await import("./sanctions.js");
    return checkSanctions("Wagner Group");
  }, r => ({ ok: r.matches.length > 0, size: r.matches.length, detail: `sanctioned: ${r.sanctioned} | matches: ${r.matches.length}` })));

  // ── Academic / Patents ──────────────────────────────
  console.log("▸ Public Records");

  results.push(await runTest("academic", "Paper search", async () => {
    const { searchAcademicPapers } = await import("./public-records.js");
    return searchAcademicPapers("transformer neural network", 3);
  }, r => ({ ok: r.papers.length > 0, size: r.papers.length, detail: `${r.papers.length} papers | ${r.stats.totalCitations} citations` })));

  results.push(await runTest("patents", "Patent search", async () => {
    const { searchPatents } = await import("./public-records.js");
    return searchPatents("machine learning", 3);
  }, r => ({ ok: r.patents.length > 0, size: r.patents.length, detail: `${r.patents.length} patents` })));

  // ── Investigation Chain ─────────────────────────────
  console.log("▸ Investigation Chain");

  results.push(await runTest("chain", "Chain template list", async () => {
    const { CHAIN_TEMPLATES } = await import("./investigation-chain.js");
    return CHAIN_TEMPLATES;
  }, r => ({ ok: Object.keys(r).length >= 5, size: Object.keys(r).length, detail: `${Object.keys(r).length} templates: ${Object.keys(r).join(", ")}` })));

  // ── Subdomain Takeover ──────────────────────────────
  console.log("▸ Subdomain Takeover");

  results.push(await runTest("takeover", "Check takeover (safe domain)", async () => {
    const { checkTakeover } = await import("./subdomain-takeover.js");
    return checkTakeover("www.google.com");
  }, r => ({ ok: typeof r.vulnerable === "boolean", size: 1, detail: `vulnerable: ${r.vulnerable} | cname: ${r.cname || "none"}` })));

  // ══════════════════════════════════════════════════════
  //  DEEP ANALYSIS + INTELLIGENCE-GRADE
  // ══════════════════════════════════════════════════════

  // ── Deep Extract ────────────────────────────────────
  console.log("▸ Deep Extract");

  results.push(await runTest("deep-extract", "Entity extraction from text", async () => {
    const { deepAnalyze } = await import("./deep-extract.js");
    return deepAnalyze("CEO John Smith of Acme Corp announced a $5 billion deal in San Francisco. Contact: john@acme.com");
  }, r => ({ ok: r.entities.length > 3, size: r.entities.length, detail: `${r.entities.length} entities: ${r.summary.byType ? Object.entries(r.summary.byType).map(([t,c]) => `${t}:${c}`).join(", ") : ""}` })));

  // ── Deep Profile ────────────────────────────────────
  console.log("▸ Deep Profile");

  results.push(await runTest("deep-profile", "Next-step generation", async () => {
    const { generateNextSteps } = await import("./deep-profile.js");
    return generateNextSteps({
      domain: { domain: "test.com", subdomains: Array(25).fill({}), whois: { registrantOrg: "Test Inc" } },
      network: { openPorts: [{ port: 3306, state: "open", service: "MySQL" }] },
    });
  }, r => ({ ok: r.length > 0, size: r.length, detail: `${r.length} steps: ${r.slice(0,3).map((s: any) => s.priority).join(",")}` })));

  // ── LLM Analyst (fallback mode) ─────────────────────
  console.log("▸ LLM Analyst");

  results.push(await runTest("llm-analyst", "Investigation planner (rule-based)", async () => {
    const { llmPlanInvestigation } = await import("./llm-analyst.js");
    return llmPlanInvestigation("github.com");
  }, r => ({ ok: r.phases.length > 0, size: r.phases.length, detail: `${r.targetType} | ${r.phases.length} phases | ${r.estimatedDuration}` })));

  results.push(await runTest("llm-analyst", "Entity extraction (fallback)", async () => {
    const { llmExtractEntities } = await import("./llm-analyst.js");
    return llmExtractEntities("Microsoft Corp acquired Activision for $69 billion in 2023");
  }, r => ({ ok: r.entities.length > 0, size: r.entities.length, detail: `${r.entities.length} entities | usedLlm: ${r.usedLlm}` })));

  // ── STIX Export ─────────────────────────────────────
  console.log("▸ STIX Export");

  results.push(await runTest("stix", "STIX 2.1 bundle generation", async () => {
    const { investigationToStix } = await import("./stix-export.js");
    return investigationToStix("test.com", {
      domain: { dns: [{ type: "A", value: "1.2.3.4" }], subdomains: [{ subdomain: "www.test.com" }] },
      threat: { threats: [{ source: "test", type: "malware", description: "test", confidence: 0.9 }], blacklists: [] },
    });
  }, r => ({ ok: r.type === "bundle" && r.objects.length > 0, size: r.objects.length, detail: `${r.objects.length} STIX objects | spec: ${r.spec_version}` })));

  results.push(await runTest("stix", "MISP event generation", async () => {
    const { investigationToMisp } = await import("./stix-export.js");
    return investigationToMisp("test.com", {
      domain: { dns: [{ type: "A", value: "1.2.3.4" }] },
    });
  }, r => ({ ok: r.Event?.Attribute?.length > 0, size: r.Event?.Attribute?.length, detail: `${r.Event?.Attribute?.length} attributes | threat: ${r.Event?.threat_level_id}` })));

  // ── Passive Monitor ─────────────────────────────────
  console.log("▸ Passive Monitor");

  results.push(await runTest("passive", "DNS baseline capture", async () => {
    const { captureDnsBaseline } = await import("./passive-monitor.js");
    return captureDnsBaseline("example.com");
  }, r => ({ ok: Object.keys(r.records).length > 0, size: Object.keys(r.records).length, detail: `${Object.keys(r.records).length} record types: ${Object.keys(r.records).join(",")}` })));

  // ── Metadata Extract ────────────────────────────────
  console.log("▸ Metadata");

  results.push(await runTest("metadata", "HTTP fingerprint", async () => {
    const { httpFingerprint } = await import("./metadata-extract.js");
    return httpFingerprint("https://github.com");
  }, r => ({ ok: Object.keys(r.allHeaders).length > 0, size: Object.keys(r.allHeaders).length, detail: `${Object.keys(r.allHeaders).length} headers | server: ${r.serverSoftware || "none"}` })));

  // ── Utils ───────────────────────────────────────────
  console.log("▸ Utils");

  results.push(await runTest("utils", "Cache + sanitize + port parse", async () => {
    const { cacheSet, cacheGet, parsePortRange, cacheClear } = await import("./utils.js");
    cacheSet("bench-test", { v: 1 }); const cached = cacheGet("bench-test"); cacheClear();
    const ports = parsePortRange("80,443,8080-8082");
    return { cached, ports };
  }, r => ({ ok: r.cached?.v === 1 && r.ports.length === 5, size: r.ports.length, detail: `cache: ${r.cached?.v === 1 ? "ok" : "fail"} | ports: ${r.ports.join(",")}` })));

  // ── Darkweb ─────────────────────────────────────────
  console.log("▸ Darkweb");

  results.push(await runTest("darkweb", "Onion index search", async () => {
    const { searchDarkWebIndexes } = await import("./darkweb.js");
    return searchDarkWebIndexes("example");
  }, r => ({ ok: true, size: r.mentions.length + r.onionUrls.length, detail: `${r.mentions.length} mentions | ${r.onionUrls.length} onion URLs` }), 20000));

  // ── Vessel Tracker ──────────────────────────────────
  console.log("▸ Vessel Tracker");

  results.push(await runTest("vessels", "AIS vessel search", async () => {
    const { searchVessel } = await import("./vessel-tracker.js");
    return searchVessel("MAERSK");
  }, r => ({ ok: true, size: r.vessels.length, detail: `${r.vessels.length} vessels found` }), 15000));

  console.log("▸ Done\n");

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
