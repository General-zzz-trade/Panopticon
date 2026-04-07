/**
 * OSINT Module — Unified entry point
 * Orchestrates all reconnaissance modules without external APIs
 */

export { whoisLookup, dnsLookup, reverseDns, enumerateSubdomains, certTransparency, attemptZoneTransfer, fullDomainRecon } from "./domain-recon.js";
export type { WhoisResult, DnsRecord, SubdomainResult, CertEntry, DomainReconResult } from "./domain-recon.js";

export { portScan, grabBanner, geolocateIp, traceroute, analyzeHttpHeaders, fullNetworkRecon } from "./network-recon.js";
export type { PortResult, GeoIpResult, TracerouteHop, BannerResult, HttpHeaderAnalysis, NetworkReconResult } from "./network-recon.js";

export { enumerateUsername, validateEmail, emailDomainIntel, fullIdentityRecon } from "./identity-recon.js";
export type { UsernameResult, EmailValidation, SocialProfile, IdentityReconResult } from "./identity-recon.js";

export { generateDorks, waybackSnapshots, waybackDiff, detectTechStack, analyzeRobots, parseSitemap, extractLinks, fullWebIntel } from "./web-intel.js";
export type { GoogleDorkResult, WaybackSnapshot, TechStackResult, SiteMapEntry, RobotsAnalysis, ExtractedLink, WebIntelResult } from "./web-intel.js";

export { parseExif, extractExifFromUrl, httpFingerprint, parsePdfMetadata, extractPdfMetadataFromUrl } from "./metadata-extract.js";
export type { ExifData, HttpFingerprint, PdfMetadata } from "./metadata-extract.js";

export { IntelGraph } from "./data-correlator.js";
export type { Entity, Relation, EntityType, RelationType, TimelineEvent, CorrelationGraph } from "./data-correlator.js";

export { generateReport } from "./report-generator.js";
export type { OsintReport } from "./report-generator.js";

// New modules — P0
export { checkUrlhaus, checkPhishTank, checkDnsBlacklists, checkSslSecurity, detectSuspiciousPatterns, fullThreatCheck } from "./threat-intel.js";
export type { ThreatResult, ThreatEntry, BlacklistResult } from "./threat-intel.js";

export { reverseIpLookup, asnLookup, asnPrefixes, ipBlockInfo, fullNetworkIntel } from "./reverse-ip.js";
export type { ReverseIpResult, AsnInfo, AsnPrefixes, IpBlockInfo, NetworkIntelResult } from "./reverse-ip.js";

export { crawlSite, captureScreenshot } from "./crawler.js";
export type { CrawlResult, CrawlPage, CrawlOptions, ScreenshotResult } from "./crawler.js";

export { checkPasswordLeak, analyzePassword, checkEmailBreaches, fullBreachCheck } from "./breach-check.js";
export type { BreachResult, BreachEntry, PasswordAnalysis } from "./breach-check.js";

// New modules — P1
export { subdomainBruteforce, mineEmailPattern, sslDeepAnalysis, detectWhoisPrivacy, waybackContentDiff, buildSocialGraph } from "./advanced-recon.js";
export type { SubdomainBruteResult, EmailPattern, SslDeepResult, WhoisPrivacyResult, WaybackDiffResult, SocialGraphResult } from "./advanced-recon.js";

// New modules — Extended
export { searchGithubRepos, searchGithubCode, scanForSecrets, scanOrgLeaks, fullGithubRecon } from "./github-recon.js";
export type { GithubReconResult, GithubRepo, CodeMatch } from "./github-recon.js";

export { executeDork, executeDorkSuite } from "./dork-executor.js";
export type { DorkResult, DorkSuiteResult, SearchResult } from "./dork-executor.js";

export { fullDocScan } from "./doc-scanner.js";
export type { DocScanResult, DocEntry, ImageEntry } from "./doc-scanner.js";

export { executeChain, CHAIN_TEMPLATES } from "./investigation-chain.js";
export type { ChainResult, ChainDefinition, ChainStep } from "./investigation-chain.js";

export { addMonitorTarget, listMonitorTargets, removeMonitorTarget, runMonitorCheck, runAllMonitors } from "./monitor.js";
export type { MonitorTarget, MonitorAlert, MonitorResult } from "./monitor.js";

export { parseBatchInput, executeBatch } from "./batch.js";
export type { BatchResult, BatchTarget } from "./batch.js";

export { initOsintSchema, saveInvestigation, getInvestigation, listInvestigations, compareHistory, accumulateEntity, getKnowledgeGraphStats } from "./storage.js";

export { checkTakeover, checkTakeoverBatch } from "./subdomain-takeover.js";
export type { TakeoverResult } from "./subdomain-takeover.js";

export { detectWaf } from "./waf-detect.js";
export type { WafDetectResult, WafMatch, CdnMatch } from "./waf-detect.js";

export { analyzeJavaScript } from "./js-analyzer.js";
export type { JsAnalysisResult, SecretFinding } from "./js-analyzer.js";

export { matchCves, extractVersions } from "./cve-matcher.js";
export type { CveMatch, CveMatchResult } from "./cve-matcher.js";

export { generateVariants, checkTyposquats } from "./typosquat.js";
export type { TyposquatResult, DomainVariant } from "./typosquat.js";

export { enumerateCloud } from "./cloud-enum.js";
export type { CloudEnumResult, CloudBucket } from "./cloud-enum.js";

export { discoverApis } from "./api-discovery.js";
export type { ApiDiscoveryResult, DiscoveredEndpoint } from "./api-discovery.js";

export { monitorNews } from "./news-monitor.js";
export type { NewsMonitorResult, NewsArticle } from "./news-monitor.js";

export { dirBruteforce, checkCors, discoverParams } from "./dir-bruteforce.js";
export type { DirBruteResult, CorsCheckResult, ParamDiscoveryResult } from "./dir-bruteforce.js";

export { cacheGet, cacheSet, cacheClear, cacheStats, fetchRetry, safeExec, parsePortRange } from "./utils.js";

export { collectNews, searchGoogleNews, getFullText, fetchGoogleCache, fetchWaybackVersion, extractOgMeta } from "./news-collector.js";
export type { NewsCollectorResult } from "./news-collector.js";
export type { NewsArticle as CollectedArticle } from "./news-collector.js";

export { collectSocialMedia, searchReddit, searchHackerNews, scrapeTelegramChannel, searchGithubDiscussions, searchStackOverflow } from "./social-media.js";
export type { SocialMediaResult, SocialPost } from "./social-media.js";

export { analyzeSentiment, extractEntities, analyzeKeywords, analyzeOpinion } from "./sentiment.js";
export type { SentimentResult, OpinionAnalysis, ExtractedEntity } from "./sentiment.js";

export { searchDarkWebIndexes } from "./darkweb.js";
export type { DarkWebResult } from "./darkweb.js";

export { parseNaturalLanguage } from "./nl-investigator.js";
export type { NlParseResult } from "./nl-investigator.js";

export { generatePdfReport } from "./pdf-export.js";
export { addWebhook, listWebhooks, removeWebhook, dispatchWebhook } from "./webhook.js";
export type { WebhookConfig, WebhookPayload } from "./webhook.js";

import { fullDomainRecon, type DomainReconResult } from "./domain-recon.js";
import { fullNetworkRecon, type NetworkReconResult } from "./network-recon.js";
import { fullIdentityRecon, type IdentityReconResult } from "./identity-recon.js";
import { fullWebIntel, type WebIntelResult } from "./web-intel.js";
import { IntelGraph } from "./data-correlator.js";
import { generateReport, type OsintReport } from "./report-generator.js";

export type OsintInvestigationType = "domain" | "network" | "identity" | "web" | "full";

export interface OsintInvestigationResult {
  target: string;
  type: OsintInvestigationType;
  domain?: DomainReconResult;
  network?: NetworkReconResult;
  identity?: IdentityReconResult;
  web?: WebIntelResult;
  graph: ReturnType<IntelGraph["toJSON"]>;
  report: OsintReport;
  timestamp: string;
  durationMs: number;
}

/**
 * Run a complete OSINT investigation on a target.
 *
 * @param target - Domain, IP, email, or username
 * @param type - Investigation scope (default: auto-detect)
 */
export async function investigate(
  target: string,
  type?: OsintInvestigationType
): Promise<OsintInvestigationResult> {
  const start = Date.now();
  const graph = new IntelGraph();

  // Auto-detect target type if not specified
  if (!type) {
    if (target.includes("@")) type = "identity";
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(target)) type = "network";
    else if (target.includes(".")) type = "full";  // Looks like a domain
    else type = "identity";  // Assume username
  }

  let domain: DomainReconResult | undefined;
  let network: NetworkReconResult | undefined;
  let identity: IdentityReconResult | undefined;
  let web: WebIntelResult | undefined;

  if (type === "domain" || type === "full") {
    domain = await fullDomainRecon(target);
    graph.ingestDomainRecon(domain);
  }

  if (type === "network" || type === "full") {
    network = await fullNetworkRecon(target);
    graph.ingestNetworkRecon(network);
  }

  if (type === "identity") {
    identity = await fullIdentityRecon(target);
    graph.ingestIdentityRecon(identity);
  }

  if (type === "web" || type === "full") {
    const url = target.startsWith("http") ? target : `https://${target}`;
    web = await fullWebIntel(url);
    graph.ingestWebIntel(web);
  }

  const report = generateReport(target, { domain, network, identity, web, graph });

  return {
    target,
    type,
    domain,
    network,
    identity,
    web,
    graph: graph.toJSON(),
    report,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}
