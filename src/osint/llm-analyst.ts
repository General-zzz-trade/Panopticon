/**
 * LLM-Powered OSINT Analyst — semantic entity extraction, narrative reports,
 * automatic investigation planning, and relationship inference
 *
 * Uses the project's existing LLM provider abstraction
 * Falls back to local heuristics when no LLM is configured
 */

export interface LlmAnalysisResult {
  entities: LlmEntity[];
  relationships: LlmRelationship[];
  summary: string;
  riskAssessment: string;
  keyFindings: string[];
  recommendations: string[];
  confidence: number;
  usedLlm: boolean;
}

export interface LlmEntity {
  name: string;
  type: string;
  significance: "critical" | "high" | "medium" | "low";
  context: string;
}

export interface LlmRelationship {
  from: string;
  to: string;
  type: string;
  evidence: string;
}

export interface InvestigationPlan {
  target: string;
  targetType: "domain" | "ip" | "person" | "organization" | "email" | "crypto";
  phases: InvestigationPhase[];
  estimatedDuration: string;
  reasoning: string;
}

export interface InvestigationPhase {
  name: string;
  modules: string[];
  purpose: string;
  dependsOn?: string;
}

// ── LLM Provider Helper ─────────────────────────────────

async function callLlm(systemPrompt: string, userMessage: string): Promise<string | null> {
  try {
    const { readProviderConfig } = await import("../llm/provider.js");
    const config = readProviderConfig("planner");
    if (!config || !config.apiKey) return null;

    const response = await fetch(`${config.baseUrl || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

// ── AI Entity Extraction ────────────────────────────────

export async function llmExtractEntities(text: string): Promise<LlmAnalysisResult> {
  const systemPrompt = `You are an OSINT intelligence analyst. Extract entities and relationships from the given text.
Return JSON only (no markdown):
{
  "entities": [{"name": "...", "type": "person|org|domain|ip|location|technology|money", "significance": "critical|high|medium|low", "context": "why significant"}],
  "relationships": [{"from": "entity1", "to": "entity2", "type": "owns|works_at|located_in|uses|connected_to", "evidence": "how you know"}],
  "summary": "2-3 sentence intelligence summary",
  "riskAssessment": "risk level and reasoning",
  "keyFindings": ["finding1", "finding2"],
  "recommendations": ["action1", "action2"]
}`;

  const llmResult = await callLlm(systemPrompt, `Analyze this intelligence data:\n\n${text.slice(0, 4000)}`);

  if (llmResult) {
    try {
      const parsed = JSON.parse(llmResult.replace(/```json\n?|\n?```/g, ""));
      return { ...parsed, confidence: 0.85, usedLlm: true };
    } catch {}
  }

  // Fallback: use local extraction
  const { deepExtractEntities, discoverRelations } = await import("./deep-extract.js");
  const entities = deepExtractEntities(text);
  const relations = discoverRelations(text);

  return {
    entities: entities.slice(0, 20).map(e => ({
      name: e.text, type: e.type,
      significance: e.confidence > 0.8 ? "high" : "medium" as any,
      context: e.context,
    })),
    relationships: relations.map(r => ({
      from: r.entity1, to: r.entity2, type: r.relationType, evidence: r.evidence,
    })),
    summary: `Found ${entities.length} entities and ${relations.length} relationships via pattern matching.`,
    riskAssessment: "Unable to assess risk without LLM — configure LLM_PLANNER_API_KEY for AI analysis.",
    keyFindings: entities.filter(e => e.type === "credential").map(e => `Potential credential: ${e.text}`),
    recommendations: ["Configure LLM for deeper semantic analysis"],
    confidence: 0.5,
    usedLlm: false,
  };
}

// ── AI Investigation Planner ────────────────────────────

export async function llmPlanInvestigation(target: string, context?: string): Promise<InvestigationPlan> {
  const systemPrompt = `You are an OSINT investigation planner. Given a target, create an investigation plan.
Available modules: domain_recon, network_recon, identity_recon, web_intel, threat_intel, asn_lookup,
breach_check, github_recon, js_analyzer, waf_detect, subdomain_takeover, cve_matcher, cloud_enum,
api_discovery, news_collector, social_media, sentiment, blockchain, company_intel, geospatial, sanctions.

Return JSON only:
{
  "targetType": "domain|ip|person|organization|email|crypto",
  "phases": [
    {"name": "Phase 1: ...", "modules": ["module1", "module2"], "purpose": "why", "dependsOn": null},
    {"name": "Phase 2: ...", "modules": ["module3"], "purpose": "why", "dependsOn": "Phase 1"}
  ],
  "estimatedDuration": "X minutes",
  "reasoning": "why this plan"
}`;

  const userMsg = `Target: ${target}${context ? `\nContext: ${context}` : ""}\n\nCreate an investigation plan.`;
  const llmResult = await callLlm(systemPrompt, userMsg);

  if (llmResult) {
    try {
      const parsed = JSON.parse(llmResult.replace(/```json\n?|\n?```/g, ""));
      return { target, ...parsed };
    } catch {}
  }

  // Fallback: rule-based planning
  return buildRuleBasedPlan(target);
}

function buildRuleBasedPlan(target: string): InvestigationPlan {
  const isEmail = target.includes("@");
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(target);
  const isCrypto = /^(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1)/.test(target);
  const isDomain = !isEmail && !isIp && !isCrypto && target.includes(".");

  if (isDomain) {
    return {
      target, targetType: "domain",
      phases: [
        { name: "Phase 1: Infrastructure Discovery", modules: ["domain_recon", "network_recon"], purpose: "Map DNS, IPs, subdomains, open ports" },
        { name: "Phase 2: Web Analysis", modules: ["web_intel", "js_analyzer", "waf_detect"], purpose: "Identify technology stack, secrets, WAF" },
        { name: "Phase 3: Threat Assessment", modules: ["threat_intel", "subdomain_takeover", "cve_matcher"], purpose: "Check threats, vulnerabilities, takeover risk" },
        { name: "Phase 4: Organization Intel", modules: ["company_intel", "github_recon"], purpose: "Identify owning organization, code leaks", dependsOn: "Phase 1" },
        { name: "Phase 5: Deep Analysis", modules: ["api_discovery", "cloud_enum"], purpose: "Find hidden APIs, exposed storage", dependsOn: "Phase 2" },
      ],
      estimatedDuration: "3-5 minutes",
      reasoning: "Domain target: start with infrastructure, then analyze web presence, check threats, identify organization, and probe for hidden assets.",
    };
  }

  if (isIp) {
    return {
      target, targetType: "ip",
      phases: [
        { name: "Phase 1: Network Intelligence", modules: ["network_recon", "asn_lookup"], purpose: "Port scan, geolocation, ASN ownership" },
        { name: "Phase 2: Co-hosting Analysis", modules: ["domain_recon"], purpose: "Reverse IP, find co-hosted domains", dependsOn: "Phase 1" },
        { name: "Phase 3: Threat Check", modules: ["threat_intel", "sanctions"], purpose: "Blacklist check, reputation" },
      ],
      estimatedDuration: "2-3 minutes",
      reasoning: "IP target: identify network owner, find hosted services, check reputation.",
    };
  }

  if (isEmail) {
    return {
      target, targetType: "email",
      phases: [
        { name: "Phase 1: Email Validation", modules: ["identity_recon"], purpose: "Validate email, check MX, detect disposable" },
        { name: "Phase 2: Identity Expansion", modules: ["identity_recon", "breach_check"], purpose: "Find social profiles, check breaches" },
        { name: "Phase 3: Domain Intel", modules: ["domain_recon", "company_intel"], purpose: "Investigate email domain" },
      ],
      estimatedDuration: "2-3 minutes",
      reasoning: "Email target: validate, expand to social profiles, check breaches, investigate domain.",
    };
  }

  if (isCrypto) {
    return {
      target, targetType: "crypto",
      phases: [
        { name: "Phase 1: Wallet Analysis", modules: ["blockchain"], purpose: "Balance, transaction history, related addresses" },
        { name: "Phase 2: Risk Assessment", modules: ["sanctions"], purpose: "Check sanctions lists" },
      ],
      estimatedDuration: "1-2 minutes",
      reasoning: "Cryptocurrency address: analyze wallet activity, check sanctions.",
    };
  }

  // Default: person/organization
  return {
    target, targetType: "person",
    phases: [
      { name: "Phase 1: Identity Search", modules: ["identity_recon"], purpose: "Find across 37+ platforms" },
      { name: "Phase 2: Background", modules: ["social_media", "news_collector"], purpose: "Social media presence, news mentions" },
      { name: "Phase 3: Professional", modules: ["company_intel"], purpose: "Company associations" },
    ],
    estimatedDuration: "2-3 minutes",
    reasoning: "Person/org target: enumerate identity, check social/news, find company links.",
  };
}

// ── AI Narrative Report ─────────────────────────────────

export async function llmGenerateReport(findings: Record<string, any>, target: string): Promise<string> {
  const systemPrompt = `You are a senior OSINT analyst writing an intelligence briefing.
Write a professional narrative report (not bullet points) that:
1. Opens with an executive summary
2. Describes key findings in order of significance
3. Identifies risks and threats
4. Maps relationships between entities
5. Provides actionable recommendations
6. Notes confidence levels and data gaps

Write in clear, professional English. Use markdown formatting.
Length: 500-1000 words.`;

  const findingsStr = JSON.stringify(findings, null, 2).slice(0, 6000);
  const userMsg = `Target: ${target}\n\nInvestigation findings:\n${findingsStr}\n\nWrite the intelligence briefing.`;

  const report = await callLlm(systemPrompt, userMsg);

  if (report) return report;

  // Fallback: structured template report
  return generateTemplateReport(findings, target);
}

function generateTemplateReport(findings: Record<string, any>, target: string): string {
  const sections: string[] = [];
  sections.push(`# Intelligence Briefing: ${target}`);
  sections.push(`\n*Generated: ${new Date().toISOString()} | Analyst: Panopticon Automated System*\n`);
  sections.push("## Executive Summary\n");
  sections.push(`This report presents the findings of an automated OSINT investigation on **${target}**. `);

  const moduleCount = Object.keys(findings).length;
  sections.push(`${moduleCount} intelligence modules were employed in this investigation.\n`);

  if (findings.domain) {
    sections.push("## Domain Infrastructure\n");
    const d = findings.domain;
    if (d.whois?.registrar) sections.push(`The domain is registered through **${d.whois.registrar}**`);
    if (d.dns?.length) sections.push(`, with ${d.dns.length} DNS records configured`);
    if (d.subdomains?.length) sections.push(` and **${d.subdomains.length} subdomains** discovered`);
    sections.push(".\n");
  }

  if (findings.network) {
    sections.push("## Network Posture\n");
    const n = findings.network;
    const open = (n.openPorts || []).filter((p: any) => p.state === "open");
    sections.push(`The target has ${open.length} open port(s): ${open.map((p: any) => `${p.port}/${p.service || "unknown"}`).join(", ")}. `);
    if (n.geo?.country) sections.push(`Infrastructure is located in **${n.geo.country}** (${n.geo.city || "unknown city"}).\n`);
  }

  if (findings.threat) {
    sections.push("## Threat Assessment\n");
    sections.push(`Risk score: **${findings.threat.riskScore || 0}/100**. `);
    if (findings.threat.malicious) sections.push("⚠ **Target flagged as potentially malicious.**\n");
    else sections.push("No active threats detected in current scan.\n");
  }

  sections.push("\n## Recommendations\n");
  sections.push("1. Conduct periodic re-assessment to detect infrastructure changes\n");
  sections.push("2. Configure LLM API for AI-enhanced narrative analysis\n");
  sections.push("3. Monitor identified subdomains for takeover vulnerabilities\n");

  sections.push(`\n---\n*Note: This is an automated template report. Configure an LLM provider for AI-generated narrative analysis with deeper insights.*`);

  return sections.join("");
}
