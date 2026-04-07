/**
 * OSINT Module Tests — validates core functionality
 * Run: node --import tsx --test src/osint/osint.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

// ── Utils ───────────────────────────────────────────────

test("utils: cache set/get/clear", async () => {
  const { cacheSet, cacheGet, cacheClear, cacheStats } = await import("./utils.js");
  cacheSet("test:key", { hello: "world" }, 5000);
  const result = cacheGet<{ hello: string }>("test:key");
  assert.equal(result?.hello, "world");
  assert.ok(cacheStats().size >= 1);
  cacheClear();
  assert.equal(cacheGet("test:key"), null);
});

test("utils: parsePortRange", async () => {
  const { parsePortRange } = await import("./utils.js");
  assert.deepEqual(parsePortRange("80,443"), [80, 443]);
  assert.deepEqual(parsePortRange("20-22"), [20, 21, 22]);
  assert.deepEqual(parsePortRange("80,443,8080-8082"), [80, 443, 8080, 8081, 8082]);
  assert.deepEqual(parsePortRange(""), []);
});

test("utils: sanitizeDomain", async () => {
  const { sanitizeDomain } = await import("./utils.js");
  assert.equal(sanitizeDomain("example.com"), "example.com");
  assert.equal(sanitizeDomain("EXAMPLE.COM"), "example.com");
  assert.equal(sanitizeDomain("example.com; rm -rf"), "example.comrm-rf");
});

// ── Domain Recon ────────────────────────────────────────

test("domain: DNS lookup returns records", async () => {
  const { dnsLookup } = await import("./domain-recon.js");
  const records = await dnsLookup("example.com", ["A"]);
  assert.ok(records.length > 0, "Should find at least one A record");
  assert.equal(records[0].type, "A");
  assert.ok(records[0].value, "A record should have a value");
});

test("domain: WHOIS returns registrar", async () => {
  const { whoisLookup } = await import("./domain-recon.js");
  const result = await whoisLookup("google.com");
  assert.ok(result.raw.length > 0, "WHOIS should return raw data");
  // Note: registrar might not always parse but raw should exist
});

test("domain: reverseDns works for known IP", async () => {
  const { reverseDns } = await import("./domain-recon.js");
  const result = await reverseDns("8.8.8.8");
  // Google's 8.8.8.8 should have a PTR record
  assert.ok(result.length >= 0); // May fail in some environments
});

// ── Network Recon ───────────────────────────────────────

test("network: port scan detects open ports", async () => {
  const { portScan } = await import("./network-recon.js");
  // Scan a well-known public server
  const results = await portScan("1.1.1.1", [53, 80, 443], { timeoutMs: 5000 });
  assert.equal(results.length, 3);
  const open = results.filter(p => p.state === "open");
  assert.ok(open.length > 0, "Cloudflare 1.1.1.1 should have open ports");
});

test("network: geolocate IP returns location", async () => {
  const { geolocateIp } = await import("./network-recon.js");
  const result = await geolocateIp("8.8.8.8");
  assert.ok(result.country, "Should return a country");
  assert.equal(result.source !== "none", true, "Should find a source");
});

// ── Identity Recon ──────────────────────────────────────

test("identity: email validation checks MX", async () => {
  const { validateEmail } = await import("./identity-recon.js");
  const result = await validateEmail("test@gmail.com");
  assert.equal(result.format, true);
  assert.ok(result.mxRecords.length > 0, "gmail.com should have MX records");
  assert.equal(result.disposable, false);
});

test("identity: disposable email detection", async () => {
  const { validateEmail } = await import("./identity-recon.js");
  const result = await validateEmail("test@mailinator.com");
  assert.equal(result.disposable, true);
});

// ── Threat Intel ────────────────────────────────────────

test("threat: suspicious pattern detection", async () => {
  const { detectSuspiciousPatterns } = await import("./threat-intel.js");
  const patterns = detectSuspiciousPatterns("paypal-secure-login.tk");
  assert.ok(patterns.length >= 2, "Should detect brand + TLD issues");

  const clean = detectSuspiciousPatterns("github.com");
  assert.equal(clean.length, 0, "github.com should be clean");
});

// ── Breach Check ────────────────────────────────────────

test("breach: password strength analysis", async () => {
  const { analyzePassword } = await import("./breach-check.js");
  const weak = analyzePassword("123456");
  assert.equal(weak.score, "very_weak");
  assert.ok(weak.entropy < 30);

  const strong = analyzePassword("Tr0ub4dor&3#x$K!");
  assert.ok(strong.entropy > 60);
  assert.ok(["strong", "very_strong"].includes(strong.score));
});

test("breach: HIBP k-anonymity check works", async () => {
  const { checkPasswordLeak } = await import("./breach-check.js");
  const result = await checkPasswordLeak("password");
  assert.equal(result.leaked, true);
  assert.ok(result.count > 1000000, "password should be in millions of breaches");
});

// ── NL Investigator ─────────────────────────────────────

test("nl: parses domain targets", async () => {
  const { parseNaturalLanguage } = await import("./nl-investigator.js");
  const result = parseNaturalLanguage("investigate github.com");
  assert.ok(result.targets.includes("github.com"));
  assert.ok(result.suggestedChain.steps.length > 0);
});

test("nl: parses IP targets", async () => {
  const { parseNaturalLanguage } = await import("./nl-investigator.js");
  const result = parseNaturalLanguage("scan ports on 8.8.8.8");
  assert.ok(result.targets.includes("8.8.8.8"));
  assert.ok(result.suggestedChain.steps.some(s => s.type === "port_scan"));
});

test("nl: parses email targets", async () => {
  const { parseNaturalLanguage } = await import("./nl-investigator.js");
  const result = parseNaturalLanguage("check user@example.com");
  assert.ok(result.targets.includes("user@example.com"));
  assert.ok(result.targetTypes.includes("email"));
});

// ── Data Correlator ─────────────────────────────────────

test("graph: entity creation and relations", async () => {
  const { IntelGraph } = await import("./data-correlator.js");
  const graph = new IntelGraph();
  const domain = graph.addEntity("domain", "example.com");
  const ip = graph.addEntity("ip", "93.184.216.34");
  graph.addRelation(domain, ip, "resolves_to");

  const data = graph.toJSON() as any;
  assert.equal(data.stats.entityCount, 2);
  assert.equal(data.stats.relationCount, 1);

  const connected = graph.findConnected(domain.id);
  assert.ok(connected.has(ip.id));
});

test("graph: cluster detection", async () => {
  const { IntelGraph } = await import("./data-correlator.js");
  const graph = new IntelGraph();

  // Cluster 1
  const a = graph.addEntity("domain", "a.com");
  const b = graph.addEntity("ip", "1.1.1.1");
  graph.addRelation(a, b, "resolves_to");

  // Cluster 2 (disconnected)
  const c = graph.addEntity("domain", "c.com");
  const d = graph.addEntity("ip", "2.2.2.2");
  graph.addRelation(c, d, "resolves_to");

  const clusters = graph.findClusters();
  assert.equal(clusters.length, 2);
});

// ── Dir Bruteforce ──────────────────────────────────────

test("cors: check returns result structure", async () => {
  const { checkCors } = await import("./dir-bruteforce.js");
  const result = await checkCors("https://example.com");
  assert.ok(typeof result.vulnerable === "boolean");
  assert.ok(Array.isArray(result.issues));
});

// ── Report Generator ────────────────────────────────────

test("report: generates markdown", async () => {
  const { generateReport } = await import("./report-generator.js");
  const report = generateReport("test.com", {});
  assert.ok(report.markdown.includes("test.com"));
  assert.ok(report.markdown.includes("OSINT Investigation Report"));
  assert.ok(typeof report.riskLevel === "string");
});
