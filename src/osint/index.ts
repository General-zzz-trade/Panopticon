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

// Deep OSINT (non-search differentiators)
export { autoPivot } from "./pivot-engine.js";
export type { PivotResult, PivotDiscovery } from "./pivot-engine.js";

export { analyzeOverlap } from "./infra-overlap.js";
export type { OverlapResult, InfraOverlap } from "./infra-overlap.js";

export { analyzeTemporalProfile } from "./temporal-analysis.js";
export type { TemporalResult, TemporalAnomaly } from "./temporal-analysis.js";

export { collectSshFingerprint, crossMatchSsh, analyzeEmailSecurity, collectSmtpBanner } from "./protocol-analysis.js";
export type { SshFingerprint, EmailSecurityResult, SmtpBannerResult } from "./protocol-analysis.js";

export { attributeTarget } from "./attribution.js";

// Physical world OSINT
export { trackFlight, trackByIcao24, getFlightsInArea, getAirportFlights, getFlightHistory } from "./flight-tracker.js";
export type { FlightState, FlightTrackResult, AirportFlights } from "./flight-tracker.js";

export { searchVessel, lookupMmsi, getVesselsInArea, getPortActivity } from "./vessel-tracker.js";
export type { VesselInfo, VesselSearchResult, PortActivity } from "./vessel-tracker.js";

export { analyzeBlockchainAddress, analyzeBitcoinAddress, analyzeEthereumAddress } from "./blockchain.js";
export type { BlockchainResult, WalletInfo } from "./blockchain.js";

export { domainToCompany, searchSecEdgar, searchUkCompanies, searchWikipedia } from "./company-intel.js";
export type { CompanyInfo, CompanySearchResult } from "./company-intel.js";

export { geocode, reverseGeocode, getWeather, getEarthquakes, getFireHotspots, geospatialIntel } from "./geospatial.js";
export type { SatelliteResult, EarthquakeEvent } from "./geospatial.js";

export { checkSanctions, checkOfac } from "./sanctions.js";
export type { SanctionsResult, SanctionMatch } from "./sanctions.js";

export { searchAcademicPapers, lookupAuthor, searchPatents, researchEntity } from "./public-records.js";

// Deep analysis
export { deepExtractEntities, discoverRelations, correlateFindings, deepAnalyze } from "./deep-extract.js";
export type { DeepEntity, DeepRelation, DeepExtractionResult, CorrelationResult } from "./deep-extract.js";

export { buildHistoricalProfile, buildPersonProfile, generateNextSteps } from "./deep-profile.js";

export { llmExtractEntities, llmPlanInvestigation, llmGenerateReport } from "./llm-analyst.js";
export type { LlmAnalysisResult, InvestigationPlan } from "./llm-analyst.js";

export { checkNewCertificates, checkBgpChanges, captureDnsBaseline, detectDnsChanges, runPassiveCheck } from "./passive-monitor.js";
export type { PassiveAlert, DnsBaseline } from "./passive-monitor.js";

export { investigationToStix, investigationToMisp } from "./stix-export.js";
export type { StixBundle, MispEvent } from "./stix-export.js";

export { autoInvestigate } from "./auto-investigate.js";

// Deep scanning (no API keys)
export { isNmapAvailable, nmapQuickScan, nmapDeepScan, nmapVulnScan, nmapScriptScan } from "./nmap-scanner.js";
export type { NmapResult, NmapPort, OsGuess } from "./nmap-scanner.js";

export { checkUrlSafety, checkIpReputation } from "./safebrowsing.js";
export type { UrlSafetyResult } from "./safebrowsing.js";

export { harvestEmails } from "./email-harvester.js";
export type { HarvestResult, HarvestedEmail } from "./email-harvester.js";

export { getPassiveDnsHistory } from "./passive-dns.js";

export { getTwitterProfile, searchTwitter, twitterIntel } from "./twitter-intel.js";

export { extractChineseEntities, discoverChineseRelations, analyzeChineseSentiment, buildChineseTimeline } from "./chinese-nlp.js";

export { getYouTubeTranscript, searchYouTube, monitorOfficialBlogs, searchRedditDeep, getRedditThread, scrapeTelegramChannelDeep } from "./media-collector.js";
export type { YouTubeVideo, BlogPost, BlogMonitorResult, RedditThread, TelegramChannelResult } from "./media-collector.js";

export { generateIntelReport, formatIntelReportMarkdown } from "./intel-analysis.js";
export type { IntelReport, KeyJudgment, HypothesisAnalysis, Indicator, IntelGap } from "./intel-analysis.js";
export type { ChineseEntity, PersonRelation, TimelineEvent as CnTimelineEvent } from "./chinese-nlp.js";
export type { Tweet, TwitterProfileResult, TwitterSearchResult } from "./twitter-intel.js";
export type { PassiveDnsResult, DnsHistoryEntry } from "./passive-dns.js";
export type { AutoInvestigationResult, MultiDimensionScore } from "./auto-investigate.js";
export type { HistoricalProfile, PersonProfile, NextStep } from "./deep-profile.js";
export type { AcademicResult, PatentResult } from "./public-records.js";
export type { AttributionResult, Attribution } from "./attribution.js";
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
