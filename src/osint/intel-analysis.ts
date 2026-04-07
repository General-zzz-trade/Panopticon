/**
 * Intelligence Analysis Engine — structured analytic techniques
 * Implements CIA/DIA methodology: ACH, link analysis, I&W, confidence assessment
 *
 * Transforms raw OSINT data into analytical judgments
 */

// ── Types ───────────────────────────────────────────────

export type ConfidenceLevel = "very_high" | "high" | "moderate" | "low" | "very_low";

export interface IntelReport {
  title: string;
  subject: string;
  classification: "UNCLASSIFIED" | "OSINT";
  preparedBy: string;
  date: string;

  executiveSummary: string;
  keyJudgments: KeyJudgment[];
  hypothesisAnalysis: HypothesisAnalysis;
  networkAnalysis: NetworkNode[];
  timelineNarrative: NarrativeEvent[];
  predictiveIndicators: Indicator[];
  intelGaps: IntelGap[];
  sourceReliability: SourceAssessment[];
  recommendations: string[];
  disseminationNote: string;

  // Raw data references
  entityCount: number;
  sourceCount: number;
  generatedAt: string;
}

export interface KeyJudgment {
  judgment: string;
  confidence: ConfidenceLevel;
  reasoning: string;
  evidence: string[];
  dissent?: string;  // Alternative view
}

export interface HypothesisAnalysis {
  question: string;
  hypotheses: Hypothesis[];
  conclusion: string;
}

export interface Hypothesis {
  id: string;
  statement: string;
  evidenceFor: string[];
  evidenceAgainst: string[];
  score: number;  // -10 to +10
  likelihood: "very_likely" | "likely" | "possible" | "unlikely" | "very_unlikely";
}

export interface NetworkNode {
  id: string;
  name: string;
  type: "person" | "organization" | "location" | "concept";
  role?: string;
  affiliation?: string;
  connections: { targetId: string; relationship: string; strength: "strong" | "moderate" | "weak" }[];
}

export interface NarrativeEvent {
  date: string;
  event: string;
  significance: "critical" | "major" | "minor";
  actors: string[];
  implications: string;
  sources: string[];
}

export interface Indicator {
  indicator: string;
  triggerCondition: string;
  implication: string;
  currentStatus: "active" | "dormant" | "triggered";
  priority: "critical" | "important" | "routine";
}

export interface IntelGap {
  question: string;
  importance: "critical" | "significant" | "useful";
  suggestedCollection: string;
  currentAssessment: string;
}

export interface SourceAssessment {
  source: string;
  reliability: "A" | "B" | "C" | "D" | "E" | "F";  // A=completely reliable, F=unreliable
  informationCredibility: "1" | "2" | "3" | "4" | "5" | "6";  // 1=confirmed, 6=cannot be judged
  notes: string;
}

// ── Confidence Assessment Logic ─────────────────────────

function assessConfidence(evidenceCount: number, sourceCount: number, consistency: number): ConfidenceLevel {
  const score = evidenceCount * 0.3 + sourceCount * 0.3 + consistency * 0.4;
  if (score > 8) return "very_high";
  if (score > 6) return "high";
  if (score > 4) return "moderate";
  if (score > 2) return "low";
  return "very_low";
}

function confidenceExplanation(level: ConfidenceLevel): string {
  const explanations: Record<ConfidenceLevel, string> = {
    very_high: "Multiple independent sources confirm. No significant conflicting evidence.",
    high: "Strong evidence from reliable sources. Minor gaps remain.",
    moderate: "Some evidence supports this, but significant gaps or conflicting information exist.",
    low: "Limited evidence. Assessment based on fragmentary information and analytical inference.",
    very_low: "Very limited information. This is largely an analytical estimate.",
  };
  return explanations[level];
}

// ── ACH: Analysis of Competing Hypotheses ───────────────

function buildAch(
  question: string,
  hypotheses: { statement: string; evidenceFor: string[]; evidenceAgainst: string[] }[]
): HypothesisAnalysis {
  const scored = hypotheses.map((h, i) => {
    const score = h.evidenceFor.length * 2 - h.evidenceAgainst.length * 3;
    let likelihood: Hypothesis["likelihood"];
    if (score > 5) likelihood = "very_likely";
    else if (score > 2) likelihood = "likely";
    else if (score > -2) likelihood = "possible";
    else if (score > -5) likelihood = "unlikely";
    else likelihood = "very_unlikely";

    return { id: `H${i + 1}`, ...h, score, likelihood };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const conclusion = `Based on available evidence, ${best.statement} is assessed as ${best.likelihood} (score: ${best.score}). ` +
    `${scored.length > 1 ? `Alternative hypothesis "${scored[1].statement}" is ${scored[1].likelihood}.` : ""}`;

  return { question, hypotheses: scored, conclusion };
}

// ── Source Reliability Matrix (NATO system) ──────────────

function assessSourceReliability(sources: string[]): SourceAssessment[] {
  const assessments: SourceAssessment[] = [];

  const reliability: Record<string, { rel: SourceAssessment["reliability"]; cred: SourceAssessment["informationCredibility"]; notes: string }> = {
    "whois": { rel: "B", cred: "2", notes: "Official registry data, generally reliable but can be masked by privacy services" },
    "dns": { rel: "A", cred: "1", notes: "Authoritative DNS records, technically verifiable" },
    "crt.sh": { rel: "B", cred: "1", notes: "Certificate Transparency logs, cryptographically verifiable" },
    "certspotter": { rel: "B", cred: "1", notes: "CT log aggregator, cross-references multiple logs" },
    "hackertarget": { rel: "C", cred: "3", notes: "Free tier, limited daily queries, data may not be current" },
    "ip-api.com": { rel: "C", cred: "3", notes: "Free GeoIP, approximate location, ISP data generally accurate" },
    "nmap": { rel: "A", cred: "1", notes: "Direct port scanning, technically verifiable results" },
    "urlhaus": { rel: "B", cred: "2", notes: "Community-reported malware URLs, verified by abuse.ch" },
    "hibp": { rel: "A", cred: "1", notes: "HaveIBeenPwned, k-anonymity API, widely trusted" },
    "google-news": { rel: "B", cred: "3", notes: "News aggregator, source quality varies by publisher" },
    "twitter": { rel: "D", cred: "4", notes: "Social media, high noise, unverified claims common" },
    "reddit": { rel: "D", cred: "4", notes: "Forum posts, anonymous users, verification difficult" },
    "hackernews": { rel: "C", cred: "3", notes: "Tech-focused community, generally informed but opinionated" },
    "wikipedia": { rel: "C", cred: "3", notes: "Community-edited, generally accurate for major topics but can contain errors" },
    "duckduckgo": { rel: "C", cred: "3", notes: "Search engine results, quality depends on indexed content" },
    "sec-edgar": { rel: "A", cred: "1", notes: "Official SEC filings, legally required disclosures" },
    "opensky": { rel: "B", cred: "2", notes: "ADS-B transponder data, generally reliable but can be spoofed" },
    "blockstream": { rel: "A", cred: "1", notes: "Blockchain data, cryptographically verifiable" },
    "usgs": { rel: "A", cred: "1", notes: "US government seismological data, scientifically validated" },
    "openalex": { rel: "B", cred: "2", notes: "Academic publication index, comprehensive but may have gaps" },
    "search-engine": { rel: "D", cred: "4", notes: "Web search results, surface-level, not independently verified" },
    "pattern-guess": { rel: "E", cred: "5", notes: "Algorithmic inference, not based on observed data" },
    "syndication": { rel: "C", cred: "3", notes: "Platform-provided embed data, may be incomplete" },
    // Module name aliases
    "domain_recon": { rel: "A", cred: "1", notes: "WHOIS + DNS + CT logs, authoritative and verifiable" },
    "nmap_scan": { rel: "A", cred: "1", notes: "Direct nmap port scanning, technically verifiable" },
    "web_intel": { rel: "B", cred: "2", notes: "Tech stack detection + Wayback + robots.txt" },
    "waf_detect": { rel: "B", cred: "2", notes: "HTTP header/cookie fingerprinting" },
    "email_security": { rel: "A", cred: "1", notes: "SPF/DKIM/DMARC DNS records, authoritative" },
    "url_safety": { rel: "B", cred: "2", notes: "Multi-engine URL check (Google/URLhaus/PhishTank)" },
    "threat_intel": { rel: "B", cred: "2", notes: "URLhaus + DNSBL + SSL + pattern analysis" },
    "dir_scan": { rel: "C", cred: "3", notes: "Directory probing, may have false positives on app-routed sites" },
    "company_intel": { rel: "C", cred: "3", notes: "SEC EDGAR + Wikipedia, mixed quality" },
    "attribution": { rel: "C", cred: "3", notes: "Multi-source inference, moderate confidence" },
    "email_harvest": { rel: "C", cred: "3", notes: "Web scraping + pattern guessing" },
    "news_collector": { rel: "B", cred: "3", notes: "Google News RSS + publisher feeds" },
    "social_media": { rel: "D", cred: "4", notes: "HN + Reddit, community content" },
    "pivot": { rel: "B", cred: "2", notes: "Automated chain discovery from verified DNS/WHOIS" },
    "temporal": { rel: "B", cred: "2", notes: "Certificate timeline + domain age analysis" },
  };

  for (const source of [...new Set(sources)]) {
    const key = source.toLowerCase().replace(/[^a-z-]/g, "");
    const match = Object.entries(reliability).find(([k]) => key.includes(k));
    if (match) {
      assessments.push({ source, reliability: match[1].rel, informationCredibility: match[1].cred, notes: match[1].notes });
    } else {
      assessments.push({ source, reliability: "D", informationCredibility: "4", notes: "Unknown source, reliability not assessed" });
    }
  }

  return assessments.sort((a, b) => (a.reliability || "F").localeCompare(b.reliability || "F"));
}

// ── Build Relationship Network ──────────────────────────

function buildNetwork(entities: { text: string; type: string }[], relations: { person1: string; person2: string; relationType: string }[]): NetworkNode[] {
  const nodes = new Map<string, NetworkNode>();

  // Create nodes from entities
  for (const e of entities) {
    if (!nodes.has(e.text)) {
      nodes.set(e.text, {
        id: e.text,
        name: e.text,
        type: e.type as any,
        connections: [],
      });
    }
  }

  // Add relationships
  for (const r of relations) {
    const src = nodes.get(r.person1);
    const tgt = nodes.get(r.person2);
    if (src) {
      src.connections.push({
        targetId: r.person2,
        relationship: r.relationType,
        strength: r.relationType === "opposition" ? "strong" : "moderate",
      });
    }
    if (tgt && !tgt.connections.find(c => c.targetId === r.person1)) {
      tgt.connections.push({
        targetId: r.person1,
        relationship: r.relationType + " (reverse)",
        strength: "moderate",
      });
    }
  }

  return Array.from(nodes.values()).sort((a, b) => b.connections.length - a.connections.length);
}

// ── Generate Predictive Indicators ──────────────────────

function generateIndicators(entities: { text: string; type: string }[], context: string): Indicator[] {
  const indicators: Indicator[] = [];
  const lowerContext = context.toLowerCase();

  // Military indicators
  if (lowerContext.includes("军") || lowerContext.includes("military") || lowerContext.includes("导弹") || lowerContext.includes("missile")) {
    indicators.push({
      indicator: "Military escalation monitoring",
      triggerCondition: "New military exercises, weapons tests, or defense spending increases announced",
      implication: "Potential escalation of regional tensions",
      currentStatus: lowerContext.includes("军演") || lowerContext.includes("exercise") ? "triggered" : "active",
      priority: "critical",
    });
  }

  // Diplomatic indicators
  if (lowerContext.includes("访问") || lowerContext.includes("visit") || lowerContext.includes("会谈") || lowerContext.includes("meeting")) {
    indicators.push({
      indicator: "Diplomatic activity tracking",
      triggerCondition: "Unexpected high-level meetings or cancellation of scheduled diplomacy",
      implication: "Shift in diplomatic alignment or crisis",
      currentStatus: "active",
      priority: "important",
    });
  }

  // Economic indicators
  if (lowerContext.includes("投资") || lowerContext.includes("invest") || lowerContext.includes("台积电") || lowerContext.includes("tsmc") || lowerContext.includes("半导体")) {
    indicators.push({
      indicator: "Semiconductor supply chain shifts",
      triggerCondition: "TSMC accelerates overseas fab construction or announces capacity changes",
      implication: "May signal anticipation of supply chain disruption",
      currentStatus: "active",
      priority: "important",
    });
  }

  // Political stability
  if (lowerContext.includes("反对") || lowerContext.includes("opposition") || lowerContext.includes("抗议") || lowerContext.includes("protest")) {
    indicators.push({
      indicator: "Domestic political stability",
      triggerCondition: "Mass protests, legislative gridlock, or approval rating below 30%",
      implication: "Weakened governing capacity, potential policy shifts",
      currentStatus: "dormant",
      priority: "routine",
    });
  }

  // Sanctions / trade
  if (lowerContext.includes("制裁") || lowerContext.includes("sanction") || lowerContext.includes("贸易") || lowerContext.includes("trade")) {
    indicators.push({
      indicator: "Trade and sanctions changes",
      triggerCondition: "New sanctions, trade restrictions, or economic coercion measures",
      implication: "Economic impact on target entity or region",
      currentStatus: "dormant",
      priority: "important",
    });
  }

  return indicators;
}

// ── Identify Intelligence Gaps ──────────────────────────

function detectTargetType(subject: string, context: string): "domain" | "person" | "organization" | "generic" {
  if (subject.includes(".") && !subject.includes(" ")) return "domain";
  if (context.includes("总统") || context.includes("president") || context.includes("CEO")) return "person";
  if (context.includes("company") || context.includes("公司") || context.includes("Corp")) return "organization";
  return "generic";
}

function identifyGaps(
  entities: { text: string; type: string }[],
  context: string,
  sources: string[]
): IntelGap[] {
  const gaps: IntelGap[] = [];
  const targetType = detectTargetType("", context);

  // Domain-specific gaps
  if (targetType === "domain" || context.includes("subdomain") || context.includes("port")) {
    if (!context.includes("takeover")) {
      gaps.push({ question: "Are any subdomains vulnerable to takeover?", importance: "critical", suggestedCollection: "Check CNAME records for dangling references to decommissioned services", currentAssessment: "Subdomain takeover scan not included in current investigation" });
    }
    if (!context.includes("内部") && !context.includes("internal")) {
      gaps.push({ question: "What internal services are exposed unintentionally?", importance: "significant", suggestedCollection: "Deep port scan (1-65535) + service version fingerprinting", currentAssessment: "Only top ports scanned" });
    }
    if (!context.includes("history") && !context.includes("历史")) {
      gaps.push({ question: "How has the infrastructure changed over the past year?", importance: "useful", suggestedCollection: "Historical DNS records, Wayback Machine snapshots, CT log timeline", currentAssessment: "Only current state analyzed" });
    }
  }

  // Person-specific gaps
  if (targetType === "person") {
    gaps.push({ question: "What are the subject's financial assets and affiliations?", importance: "significant", suggestedCollection: "Public financial disclosures, property records, corporate registrations", currentAssessment: "No financial data collected" });
    gaps.push({ question: "What is the subject's network of close associates?", importance: "critical", suggestedCollection: "Social media analysis, co-authorship, event attendance", currentAssessment: "Only platform presence checked, not relationship mapping" });
  }

  // Organization-specific gaps
  if (targetType === "organization") {
    gaps.push({ question: "What is the organization's ownership structure?", importance: "critical", suggestedCollection: "SEC filings, corporate registry, beneficial ownership databases", currentAssessment: "Only surface-level company search performed" });
    gaps.push({ question: "What are the organization's key vendor and partner relationships?", importance: "significant", suggestedCollection: "SPF includes, technology integrations, press releases", currentAssessment: "Partial data from SPF/technology detection" });
  }

  // Universal gaps
  gaps.push({ question: "What information exists in non-public databases?", importance: "useful", suggestedCollection: "Commercial OSINT platforms (Shodan, SecurityTrails, VirusTotal Enterprise)", currentAssessment: "Only free public sources used — premium data unavailable" });

  return gaps;
}

// ══════════════════════════════════════════════════════════
//  MAIN: Generate Intelligence Report
// ══════════════════════════════════════════════════════════

export function generateIntelReport(
  subject: string,
  data: {
    entities: { text: string; type: string; confidence?: number }[];
    relations: { person1: string; person2: string; relationType: string; evidence?: string }[];
    newsHeadlines: string[];
    sentiment: { score: number; label: string; positiveWords?: string[]; negativeWords?: string[] };
    timelineEvents: { date: string; event: string; actors?: string[] }[];
    sources: string[];
    rawContext: string;
    customHypotheses?: { question: string; hypotheses: { statement: string; evidenceFor: string[]; evidenceAgainst: string[] }[] };
  }
): IntelReport {
  const people = data.entities.filter(e => e.type === "person").map(e => e.text);
  const orgs = data.entities.filter(e => e.type === "organization").map(e => e.text);
  const locations = data.entities.filter(e => e.type === "location").map(e => e.text);

  // Key Judgments
  const keyJudgments: KeyJudgment[] = [];

  // Generate judgments from evidence patterns
  if (data.newsHeadlines.some(h => h.toLowerCase().includes("military") || h.includes("军"))) {
    keyJudgments.push({
      judgment: `${subject} is prioritizing military modernization and defense readiness.`,
      confidence: assessConfidence(
        data.newsHeadlines.filter(h => h.includes("military") || h.includes("defense") || h.includes("军") || h.includes("导弹")).length,
        data.sources.length, 7
      ),
      reasoning: "Multiple news reports reference military inspections, defense spending, and weapons production.",
      evidence: data.newsHeadlines.filter(h => h.includes("military") || h.includes("defense") || h.includes("军") || h.includes("导弹")).slice(0, 3),
      dissent: "Military activity may be routine rather than indicating escalation.",
    });
  }

  if (data.newsHeadlines.some(h => h.toLowerCase().includes("us ") || h.toLowerCase().includes("america") || h.includes("美国"))) {
    keyJudgments.push({
      judgment: `${subject} is actively strengthening ties with the United States.`,
      confidence: assessConfidence(
        data.newsHeadlines.filter(h => h.includes("US ") || h.includes("Senate") || h.includes("美国") || h.includes("参议员")).length,
        data.sources.length, 6
      ),
      reasoning: "Evidence of meetings with US congressional delegations and alignment on defense policy.",
      evidence: data.newsHeadlines.filter(h => h.includes("US ") || h.includes("Senate") || h.includes("美国")).slice(0, 3),
    });
  }

  if (data.sentiment.score < -3) {
    keyJudgments.push({
      judgment: `Public sentiment toward ${subject} is predominantly negative.`,
      confidence: "moderate",
      reasoning: `Sentiment analysis shows score of ${data.sentiment.score} with negative keywords: ${(data.sentiment.negativeWords || []).join(", ")}`,
      evidence: data.sentiment.negativeWords || [],
    });
  } else if (data.sentiment.score > 3) {
    keyJudgments.push({
      judgment: `Public discourse around ${subject} is generally positive.`,
      confidence: "moderate",
      reasoning: `Sentiment analysis shows score of ${data.sentiment.score} with positive indicators.`,
      evidence: data.sentiment.positiveWords || [],
    });
  }

  // Domain-specific judgments (infrastructure, security posture)
  const targetType = detectTargetType(subject, data.rawContext);
  if (targetType === "domain") {
    // Subdomains
    const subCount = data.rawContext.match(/subdomains[":]*\s*(\d+)/)?.[1];
    if (subCount && parseInt(subCount) > 50) {
      keyJudgments.push({
        judgment: `${subject} has a large attack surface with ${subCount} discovered subdomains.`,
        confidence: "high",
        reasoning: "Large number of subdomains increases the risk of abandoned or misconfigured services that could be exploited.",
        evidence: [`${subCount} subdomains discovered via CT logs and DNS brute-force`],
      });
    }

    // Email security
    const emailScore = data.rawContext.match(/emailSecurity[":]*\s*(\d+)/)?.[1];
    if (emailScore) {
      const score = parseInt(emailScore);
      keyJudgments.push({
        judgment: score >= 80
          ? `${subject} maintains strong email security posture (${score}/100).`
          : `${subject} has weak email security (${score}/100) — vulnerable to spoofing.`,
        confidence: "high",
        reasoning: `Email security score ${score}/100 based on SPF/DKIM/DMARC configuration.`,
        evidence: [`Email security audit: ${score}/100`],
      });
    }

    // Threat risk
    const threatScore = data.rawContext.match(/threats[":]*\s*(\d+)/)?.[1];
    if (threatScore) {
      const tr = parseInt(threatScore);
      if (tr > 50) {
        keyJudgments.push({
          judgment: `${subject} shows elevated threat indicators (risk score: ${tr}/100).`,
          confidence: "moderate",
          reasoning: "Multiple threat intelligence sources flagged the target.",
          evidence: [`Threat risk score: ${tr}/100`],
        });
      }
    }

    // Attribution
    const attribution = data.rawContext.match(/attribution[":]*\s*"([^"]+)"/)?.[1];
    if (attribution && attribution !== "N/A") {
      keyJudgments.push({
        judgment: `${subject} is attributed to ${attribution}.`,
        confidence: "moderate",
        reasoning: "Attribution based on WHOIS, certificates, DNS, Wikipedia, and DuckDuckGo evidence.",
        evidence: [`Attribution analysis result`],
      });
    }
  }

  // Ensure at least one judgment
  if (keyJudgments.length === 0) {
    keyJudgments.push({
      judgment: `Available OSINT evidence is insufficient for high-confidence analytical judgments about ${subject}.`,
      confidence: "low",
      reasoning: "Limited data collected. More comprehensive collection is needed.",
      evidence: [`${data.entities.length} entities`, `${data.newsHeadlines.length} news articles`],
    });
  }

  // ACH — adapt to target type
  let defaultAchQuestion: string;
  let defaultHypotheses: { statement: string; evidenceFor: string[]; evidenceAgainst: string[] }[];

  if (targetType === "domain") {
    defaultAchQuestion = `What is the security posture of ${subject}?`;
    defaultHypotheses = [
      {
        statement: `${subject} has a strong security posture with proactive defense`,
        evidenceFor: data.newsHeadlines.filter(h => h.toLowerCase().match(/secur|protect|patch|update|defense|waf/)).map(h => h.slice(0, 80)),
        evidenceAgainst: data.newsHeadlines.filter(h => h.toLowerCase().match(/breach|hack|vuln|leak|exposed/)).map(h => h.slice(0, 80)),
      },
      {
        statement: `${subject} has security weaknesses that could be exploited`,
        evidenceFor: data.newsHeadlines.filter(h => h.toLowerCase().match(/breach|vuln|leak|exposed|attack/)).map(h => h.slice(0, 80)),
        evidenceAgainst: data.newsHeadlines.filter(h => h.toLowerCase().match(/secur|patch|protect|award/)).map(h => h.slice(0, 80)),
      },
    ];
  } else {
    defaultAchQuestion = `What is the primary strategic direction of ${subject}?`;
    defaultHypotheses = [
      {
        statement: `${subject} is pursuing a defensive posture to maintain the status quo`,
        evidenceFor: data.newsHeadlines.filter(h => h.includes("defense") || h.includes("防御") || h.includes("稳定")).map(h => h.slice(0, 80)),
        evidenceAgainst: data.newsHeadlines.filter(h => h.includes("provoc") || h.includes("挑衅") || h.includes("独立")).map(h => h.slice(0, 80)),
      },
      {
        statement: `${subject} is actively changing the status quo`,
        evidenceFor: data.newsHeadlines.filter(h => h.includes("independence") || h.includes("独立") || h.includes("主权")).map(h => h.slice(0, 80)),
        evidenceAgainst: data.newsHeadlines.filter(h => h.includes("peace") || h.includes("和平") || h.includes("对话")).map(h => h.slice(0, 80)),
      },
    ];
  }

  const hypothesisAnalysis = data.customHypotheses
    ? buildAch(data.customHypotheses.question, data.customHypotheses.hypotheses)
    : buildAch(defaultAchQuestion, defaultHypotheses);

  // Network
  const networkAnalysis = buildNetwork(data.entities, data.relations);

  // Timeline narrative
  const timelineNarrative: NarrativeEvent[] = data.timelineEvents.slice(0, 15).map(e => ({
    date: e.date,
    event: e.event,
    significance: e.event.includes("军") || e.event.includes("military") ? "critical" : e.event.length > 50 ? "major" : "minor",
    actors: e.actors || people.slice(0, 3),
    implications: "",
    sources: ["OSINT collection"],
  }));

  // Predictive indicators
  const predictiveIndicators = generateIndicators(data.entities, data.rawContext);

  // Intelligence gaps
  const intelGaps = identifyGaps(data.entities, data.rawContext, data.sources);

  // Source reliability
  const sourceReliability = assessSourceReliability(data.sources);

  // Executive summary
  const executiveSummary = [
    `This intelligence assessment examines ${subject} based on ${data.entities.length} identified entities across ${data.sources.length} open sources.`,
    keyJudgments[0] ? `Key finding: ${keyJudgments[0].judgment} (${keyJudgments[0].confidence} confidence).` : "",
    `${intelGaps.filter(g => g.importance === "critical").length} critical intelligence gaps remain.`,
    `Analysis produced ${predictiveIndicators.filter(i => i.currentStatus === "active" || i.currentStatus === "triggered").length} active monitoring indicators.`,
  ].filter(Boolean).join(" ");

  // Recommendations
  const recommendations = [
    `Continue monitoring ${predictiveIndicators.filter(i => i.priority === "critical").length} critical indicators.`,
    ...intelGaps.filter(g => g.importance === "critical").map(g => `Priority collection: ${g.question}`),
    `Update this assessment when new significant events occur.`,
    `Cross-reference with HUMINT and SIGINT if available.`,
  ];

  return {
    title: `Intelligence Assessment: ${subject}`,
    subject,
    classification: "OSINT",
    preparedBy: "Panopticon OSINT Platform",
    date: new Date().toISOString().split("T")[0],
    executiveSummary,
    keyJudgments,
    hypothesisAnalysis,
    networkAnalysis,
    timelineNarrative,
    predictiveIndicators,
    intelGaps,
    sourceReliability,
    recommendations,
    disseminationNote: "This assessment is based entirely on open-source intelligence (OSINT). Classification: UNCLASSIFIED//OSINT. Handle according to your organization's information classification policy.",
    entityCount: data.entities.length,
    sourceCount: data.sources.length,
    generatedAt: new Date().toISOString(),
  };
}

// ── Format as Markdown ──────────────────────────────────

export function formatIntelReportMarkdown(report: IntelReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push("");
  lines.push(`**Classification:** ${report.classification}`);
  lines.push(`**Date:** ${report.date}`);
  lines.push(`**Prepared by:** ${report.preparedBy}`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(report.executiveSummary);
  lines.push("");

  lines.push("## Key Judgments");
  lines.push("");
  for (const kj of report.keyJudgments) {
    lines.push(`### [${kj.confidence.toUpperCase()}] ${kj.judgment}`);
    lines.push("");
    lines.push(`**Reasoning:** ${kj.reasoning}`);
    lines.push("");
    if (kj.evidence.length > 0) {
      lines.push("**Evidence:**");
      kj.evidence.forEach(e => lines.push(`- ${e}`));
      lines.push("");
    }
    if (kj.dissent) {
      lines.push(`> **Alternative view:** ${kj.dissent}`);
      lines.push("");
    }
  }

  lines.push("## Analysis of Competing Hypotheses");
  lines.push("");
  lines.push(`**Question:** ${report.hypothesisAnalysis.question}`);
  lines.push("");
  for (const h of report.hypothesisAnalysis.hypotheses) {
    lines.push(`### ${h.id}: ${h.statement}`);
    lines.push(`**Likelihood:** ${h.likelihood} (score: ${h.score})`);
    if (h.evidenceFor.length) { lines.push("**Evidence for:**"); h.evidenceFor.forEach(e => lines.push(`- ${e}`)); }
    if (h.evidenceAgainst.length) { lines.push("**Evidence against:**"); h.evidenceAgainst.forEach(e => lines.push(`- ${e}`)); }
    lines.push("");
  }
  lines.push(`**Conclusion:** ${report.hypothesisAnalysis.conclusion}`);
  lines.push("");

  lines.push("## Key Actor Network");
  lines.push("");
  for (const node of report.networkAnalysis.filter(n => n.connections.length > 0).slice(0, 10)) {
    const conns = node.connections.map(c => `${c.relationship} → ${c.targetId}`).join(", ");
    lines.push(`- **${node.name}** (${node.type}): ${conns}`);
  }
  lines.push("");

  lines.push("## Indicators & Warnings");
  lines.push("");
  lines.push("| Priority | Indicator | Status | Trigger |");
  lines.push("|----------|-----------|--------|---------|");
  for (const i of report.predictiveIndicators) {
    lines.push(`| ${i.priority} | ${i.indicator} | ${i.currentStatus} | ${i.triggerCondition.slice(0, 50)} |`);
  }
  lines.push("");

  lines.push("## Intelligence Gaps");
  lines.push("");
  for (const gap of report.intelGaps) {
    lines.push(`- **[${gap.importance.toUpperCase()}]** ${gap.question}`);
    lines.push(`  - Collection suggestion: ${gap.suggestedCollection}`);
    lines.push(`  - Current: ${gap.currentAssessment}`);
  }
  lines.push("");

  lines.push("## Source Reliability Assessment");
  lines.push("");
  lines.push("| Source | Reliability | Credibility | Notes |");
  lines.push("|--------|-------------|-------------|-------|");
  for (const s of report.sourceReliability.slice(0, 10)) {
    lines.push(`| ${s.source} | ${s.reliability} | ${s.informationCredibility} | ${s.notes.slice(0, 50)} |`);
  }
  lines.push("");

  lines.push("## Recommendations");
  lines.push("");
  report.recommendations.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`*${report.disseminationNote}*`);
  lines.push("");
  lines.push(`*Generated: ${report.generatedAt} | Entities: ${report.entityCount} | Sources: ${report.sourceCount}*`);

  return lines.join("\n");
}
