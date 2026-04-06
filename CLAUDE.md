# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Panopticon is an AI-powered open-source intelligence (OSINT) platform with 33 reconnaissance modules, 65 API endpoints, and a dark-themed React UI. It conducts automated domain intelligence, network scanning, identity enumeration, web technology detection, threat assessment, and metadata extraction — all without external API keys. It uses system commands (`whois`, `dig`, `openssl`), TCP connect scanning, and free public data sources (crt.sh, ip-api.com, archive.org, abuse.ch, HaveIBeenPwned, NVD).

## Commands

```bash
# Build
npm run build                    # tsc → dist/

# Run
npm run api                      # Fastify API server (port 3000)
npm run dev -- "goal here"       # Development (tsx, no compile step)
npm start                        # Production (requires build first)

# OSINT CLI
npm run osint -- investigate github.com    # Full investigation
npm run osint -- domain example.com        # Domain recon
npm run osint -- network 8.8.8.8           # Network scan
npm run osint -- identity torvalds         # Username enum (37 platforms)
npm run osint -- breach password123        # HIBP leak check
npm run osint -- threat evil-site.tk       # Threat intelligence
npm run osint -- nl "scan ports on 8.8.8.8"  # Natural language
npm run osint -- --help                    # All 19 commands

# Tests — all use node:test (no Jest/Vitest)
npm test                         # Unit + smoke tests
npm run test:e2e                 # E2E (requires: npx playwright install chromium --with-deps)

# Run a single test file
node --import tsx --test src/path/to/file.test.ts
```

## Architecture

### OSINT Modules (`src/osint/` — 33 files)

The core OSINT engine is modular — each file is a self-contained reconnaissance capability:

**Reconnaissance:**
- `domain-recon.ts` — WHOIS, DNS (10 types), subdomains (crt.sh + brute-force), certificates, zone transfer
- `network-recon.ts` — TCP port scan, banner grab, IP geolocation, traceroute, HTTP header audit
- `identity-recon.ts` — Username enumeration (37 platforms), email MX/SMTP validation
- `web-intel.ts` — Tech stack (50+ signatures), Wayback Machine, Google dorks, robots.txt
- `advanced-recon.ts` — 300+ prefix subdomain wordlist, email pattern mining, SSL deep analysis, WHOIS privacy detection, Wayback diff, social graph

**Threat & Vulnerability:**
- `threat-intel.ts` — URLhaus, PhishTank, 7 DNSBL blacklists, SSL security, phishing patterns
- `cve-matcher.ts` — Banner version extraction → NVD CVE lookup
- `subdomain-takeover.ts` — 20 service fingerprints, dangling CNAME detection
- `waf-detect.ts` — 14 WAF + 14 CDN fingerprints

**Deep Analysis:**
- `js-analyzer.ts` — 20 secret patterns, API endpoint discovery, internal URL extraction
- `github-recon.ts` — Public repo search, 15 secret patterns, org leak scan
- `crawler.ts` — BFS site crawl, email/phone extraction, screenshot capture
- `dork-executor.ts` — DuckDuckGo/Bing automated search
- `doc-scanner.ts` — PDF/image metadata batch extraction

**Network Intelligence:**
- `reverse-ip.ts` — Reverse IP (HackerTarget), ASN (Team Cymru), CIDR, IP blocks
- `cloud-enum.ts` — S3/Azure Blob/GCP Storage bucket enumeration
- `typosquat.ts` — 8 domain variant types, registration check
- `api-discovery.ts` — 60+ common path probing

**Monitoring & Intelligence:**
- `breach-check.ts` — HIBP k-anonymity password check, strength analysis
- `news-monitor.ts` — 8 security RSS feeds, keyword matching
- `darkweb.ts` — .onion presence via Ahmia.fi, paste site search
- `metadata-extract.ts` — EXIF GPS, PDF metadata, HTTP fingerprint

**Infrastructure:**
- `data-correlator.ts` — Entity graph (16 types, 16 relation types), BFS traversal, clustering
- `report-generator.ts` — Markdown report, risk assessment, recommendations
- `investigation-chain.ts` — 5 pre-built multi-step workflows
- `monitor.ts` — Scheduled change detection (subdomains, ports, SSL, uptime)
- `batch.ts` — CSV/list batch processing with concurrency control
- `storage.ts` — SQLite persistence, history diff, knowledge graph accumulation
- `pdf-export.ts` — HTML→PDF via Playwright
- `webhook.ts` — Slack/Discord/Telegram/generic notifications
- `nl-investigator.ts` — Natural language → target detection + module selection
- `cli.ts` — 19-command CLI tool
- `index.ts` — Unified exports

### Agent Runtime (`src/core/`)

The runtime executes a cognitive loop per task:

```
Plan → Execute → Verify → Decide → (Hypothesize → Recover)
```

1. **Planning** (`src/planner/`): Template, regex, knowledge, and LLM planners. Best plan wins by quality score.
2. **Execution** (`src/core/executor.ts` → `src/handlers/`): Dispatches to typed handlers. 10 OSINT task types: `osint_investigate`, `osint_domain`, `osint_network`, `osint_identity`, `osint_web`, `osint_threat`, `osint_asn`, `osint_crawl`, `osint_breach`, `osint_screenshot`.
3. **Verification** (`src/verifier/`): Three-layer cascade — action, state, goal verification.
4. **Recovery** (on failure): Bayesian hypothesis engine → experiment runner → belief updater → recovery synthesizer.

### API (`src/api/`)

Fastify server with 65 endpoints at `/api/v1/osint/*`. Also serves the React frontend as SPA with fallback routing.

### Frontend (`webapp/`)

React 19 + Vite 6 + Tailwind CSS. Dark OSINT theme (`#0a0e17` bg, `#00ff88` accent). 16 pages with Canvas force-directed graph visualization.

### Key Abstractions

- **`RunContext`** (`src/types.ts`): Central state threaded through the loop — tasks, observations, world state, browser session, usage ledger.
- **`AgentTask`**: Typed action with payload. 15 base types + 10 OSINT types.
- **`IntelGraph`** (`src/osint/data-correlator.ts`): In-memory entity-relation graph with BFS, shortest path, centrality, and clustering.

## Module Layout

```
src/osint/          33 OSINT reconnaissance modules
src/core/           Runtime loop, executor, policy, retry
src/planner/        Template/regex/knowledge/LLM planners
src/cognition/      Hypothesis engine, belief updates, decisions
src/verifier/       Action/state/goal verification
src/llm/            LLM provider abstraction (Anthropic/OpenAI/Ollama)
src/handlers/       Task execution (browser, HTTP, shell, OSINT, etc.)
src/api/            Fastify server, 65+ routes, auth
src/db/             SQLite client, schema, repository
src/knowledge/      Procedural memory, failure patterns
src/memory/         Episode store, semantic search
src/worker/         Job queue with concurrency control
webapp/             React frontend (16 OSINT pages)
```

## TypeScript

- Target: ES2022, Module: CommonJS, Strict mode
- No path aliases — all imports are relative
- Dev runner: `tsx` (no compile step needed)
- Shell commands use `execFileNoThrow` (not `exec`) to prevent injection

## Testing Conventions

- Framework: Node.js native `node:test` + `node:assert/strict`
- Test files: colocated as `*.test.ts` next to source
- CI: 3 parallel jobs — unit/integration, API, E2E
