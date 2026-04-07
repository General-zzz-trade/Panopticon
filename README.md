# Panopticon

**AI-powered open-source intelligence platform — no API keys required.**

Automated reconnaissance across domains, networks, identities, and web infrastructure. 63 OSINT modules, 131 API endpoints, 19 CLI commands, dark-themed React UI.

[中文文档](README.zh-CN.md) · [Deployment Guide](DEPLOY.md)

---

## What This Does

Panopticon conducts automated intelligence gathering using only free public data sources and system commands — no Shodan, no VirusTotal, no paid API keys.

| Capability | Modules | Data Sources |
|------------|---------|-------------|
| **Domain Recon** | WHOIS, DNS (10 types), subdomains (300+ prefix brute-force + crt.sh), certificates, zone transfer | `whois`, `dig`, crt.sh API |
| **Network Scan** | TCP port scan (30 ports), banner grabbing, IP geolocation, traceroute, HTTP header audit | TCP connect, ip-api.com, ipinfo.io |
| **Identity Lookup** | Username enumeration (37 platforms), email MX/SMTP validation, disposable detection | HTTP HEAD checks, `dig` MX |
| **Web Intel** | Tech stack (50+ signatures), Wayback Machine, Google dorks, robots.txt, sitemap, link extraction | fetch + pattern matching, archive.org CDX |
| **Threat Intel** | URLhaus malware check, 7 DNSBL blacklists, SSL security, phishing pattern detection | abuse.ch, DNS blacklists, `openssl` |
| **ASN / Reverse IP** | AS number lookup, CIDR mapping, co-hosted domain discovery, IP block info | Team Cymru, HackerTarget, RIPE |
| **Breach Check** | Password leak detection (HIBP k-anonymity), strength analysis, email breach lookup | HaveIBeenPwned API |
| **Deep Crawler** | Recursive site crawl, email/phone extraction, form discovery, screenshot capture | fetch BFS, Playwright |
| **JS Analysis** | Secret extraction (20 patterns), API endpoint discovery, internal URL detection | fetch + regex |
| **GitHub Scan** | Public repo search, code leak detection (15 secret patterns), org exposure scan | GitHub public API |
| **WAF/CDN Detection** | 14 WAF + 14 CDN fingerprints, trigger-based WAF probing | HTTP header/cookie analysis |
| **Subdomain Takeover** | 20 service fingerprints (GitHub Pages, Heroku, S3, Azure...), dangling CNAME detection | `dig` + fetch |
| **CVE Matching** | Service version extraction from banners, NVD database lookup | NVD REST API |
| **Typosquatting** | 8 variant types (swap, homograph, keyboard, bitsquat...), registration check | DNS resolution |
| **Cloud Enumeration** | S3/Azure Blob/GCP Storage bucket discovery, public read detection | HTTP probing |
| **API Discovery** | 60+ common path probing (Swagger, GraphQL, Actuator, debug endpoints) | HTTP probing |
| **News Monitor** | 8 security RSS feeds + 3 general feeds, keyword matching | RSS/Atom parsing |
| **Dark Web Search** | .onion presence via Ahmia.fi, paste site mentions | Public clearnet indexes |

Plus: investigation chain automation (5 templates), scheduled monitoring with change detection, batch processing, natural language query parsing, PDF report export, Slack/Discord/Telegram webhook notifications, SQLite persistence with history diff, and a knowledge graph that accumulates across investigations.

---

## Quick Start

```bash
git clone https://github.com/General-zzz-trade/Panopticon.git
cd Panopticon
npm install

# Start the server (no API keys needed for OSINT)
AGENT_API_AUTH=false node --import tsx src/api/server.ts

# Open the UI
open http://localhost:3000
```

### CLI Usage

```bash
# Full investigation
npm run osint -- investigate github.com

# Specific modules
npm run osint -- domain example.com
npm run osint -- network 8.8.8.8
npm run osint -- identity torvalds
npm run osint -- breach password123
npm run osint -- threat paypal-secure-login.tk

# Natural language
npm run osint -- nl "scan ports on 8.8.8.8"

# JSON output
npm run osint -- investigate github.com --json
```

### API Usage

```bash
# Full investigation
curl -X POST http://localhost:3000/api/v1/osint/investigate \
  -H 'Content-Type: application/json' \
  -d '{"target": "github.com"}'

# Domain recon
curl http://localhost:3000/api/v1/osint/dns/github.com

# Port scan
curl -X POST http://localhost:3000/api/v1/osint/portscan \
  -H 'Content-Type: application/json' \
  -d '{"target": "8.8.8.8", "ports": [22, 80, 443]}'

# Username enumeration
curl -X POST http://localhost:3000/api/v1/osint/username \
  -H 'Content-Type: application/json' \
  -d '{"username": "torvalds"}'

# Breach check
curl -X POST http://localhost:3000/api/v1/osint/breach/password \
  -H 'Content-Type: application/json' \
  -d '{"password": "password123"}'
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React Frontend (dark OSINT theme)                       │
│  15 pages: Dashboard, Investigate, Domain, Network,      │
│  Identity, WebIntel, Threat, ASN, Crawler, Breach,       │
│  GitHub, Chain, Monitor, Batch, Reports                   │
├─────────────────────────────────────────────────────────┤
│  Fastify API (65 endpoints)                              │
│  /api/v1/osint/* — all OSINT operations                  │
│  /api/v1/runs — task execution pipeline                  │
│  SSE streaming, WebSocket, JWT auth                      │
├─────────────────────────────────────────────────────────┤
│  OSINT Modules (33 files, src/osint/)                    │
│  domain-recon    network-recon    identity-recon         │
│  web-intel       threat-intel     reverse-ip             │
│  breach-check    crawler          github-recon           │
│  dork-executor   doc-scanner      js-analyzer            │
│  waf-detect      subdomain-takeover  cve-matcher         │
│  typosquat       cloud-enum       api-discovery          │
│  news-monitor    darkweb          advanced-recon          │
│  metadata-extract  data-correlator  report-generator     │
│  investigation-chain  monitor     batch                   │
│  storage         pdf-export       webhook                │
│  nl-investigator  cli                                     │
├─────────────────────────────────────────────────────────┤
│  Agent Runtime (cognitive loop)                          │
│  Plan → Execute → Verify → Decide → Recover              │
│  Bayesian hypothesis engine, 10 OSINT task types         │
├─────────────────────────────────────────────────────────┤
│  Data Layer                                               │
│  SQLite persistence, entity graph accumulation,           │
│  investigation history diff, monitor baselines            │
├─────────────────────────────────────────────────────────┤
│  LLM (optional, pluggable)                               │
│  Anthropic · OpenAI-compatible · Ollama · No LLM mode    │
└─────────────────────────────────────────────────────────┘
```

### How a Full Investigation Works

```
Input: "investigate github.com"
  │
  ├─ Domain Recon (parallel)
  │   ├── WHOIS → registrar, dates, nameservers
  │   ├── DNS → 41 records (A/AAAA/MX/NS/TXT/SOA...)
  │   ├── Subdomains → 119 discovered (crt.sh + brute-force)
  │   ├── Certificates → CT log entries
  │   └── Zone Transfer → test AXFR
  │
  ├─ Network Recon (parallel)
  │   ├── Port Scan → 3 open (22/SSH, 80/HTTP, 443/HTTPS)
  │   ├── Banner Grab → SSH-2.0-ab54611
  │   ├── GeoIP → Japan, Tokyo, Microsoft Azure
  │   ├── Traceroute → hop analysis
  │   └── HTTP Headers → security audit
  │
  ├─ Web Intel (parallel)
  │   ├── Tech Stack → server, frameworks, CDN
  │   ├── Wayback → 200 snapshots since 2008
  │   ├── Robots.txt → disallowed paths
  │   └── Google Dorks → 12 queries generated
  │
  ├─ Intelligence Correlation
  │   ├── Entity Graph → 77 entities, 78 relations
  │   └── Risk Assessment → LOW (1 risk factor)
  │
  └─ Output
      ├── Structured JSON (all raw data)
      ├── Markdown report (risk factors + recommendations)
      └── PDF export (professional format)
```

---

## API Reference

### Core Investigation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/osint/investigate` | POST | Full investigation (auto-detect target type) |
| `/osint/domain` | POST | Domain recon (WHOIS + DNS + subs + certs) |
| `/osint/network` | POST | Network scan (ports + geo + banners) |
| `/osint/identity` | POST | Identity lookup (37 platforms + email) |
| `/osint/web` | POST | Web intel (tech + wayback + dorks) |
| `/osint/threat` | POST | Threat check (malware + DNSBL + SSL) |

### Specific Lookups

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/osint/whois/:domain` | GET | WHOIS data |
| `/osint/dns/:domain` | GET | DNS records |
| `/osint/subdomains/:domain` | GET | Subdomain enumeration |
| `/osint/certs/:domain` | GET | Certificate transparency |
| `/osint/geoip/:ip` | GET | IP geolocation |
| `/osint/reverseip/:ip` | GET | Co-hosted domains |
| `/osint/asn/:ip` | GET | ASN lookup |
| `/osint/email/:email` | GET | Email validation |
| `/osint/dorks/:domain` | GET | Google dork queries |
| `/osint/ssl-deep/:domain` | GET | SSL/TLS deep analysis |
| `/osint/fingerprint?url=` | GET | HTTP fingerprint |
| `/osint/techstack?url=` | GET | Technology detection |
| `/osint/wayback?url=` | GET | Wayback Machine history |

### Advanced Modules

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/osint/portscan` | POST | Custom port scan |
| `/osint/username` | POST | Username enumeration |
| `/osint/subdomains-deep` | POST | 300+ prefix brute-force |
| `/osint/breach` | POST | Breach/leak check |
| `/osint/breach/password` | POST | Password leak + strength |
| `/osint/crawl` | POST | Deep site crawl |
| `/osint/screenshot` | POST | Page screenshot |
| `/osint/github` | POST | GitHub code leak scan |
| `/osint/waf` | POST | WAF/CDN detection |
| `/osint/js-analyze` | POST | JS secret extraction |
| `/osint/cve` | POST | CVE vulnerability match |
| `/osint/typosquat` | POST | Domain similarity check |
| `/osint/cloud` | POST | S3/Azure/GCP enumeration |
| `/osint/api-discover` | POST | Hidden API discovery |
| `/osint/news` | POST | Security news monitor |
| `/osint/darkweb` | POST | Dark web index search |
| `/osint/takeover` | POST | Subdomain takeover check |
| `/osint/docs` | POST | Document metadata scan |
| `/osint/exif` | POST | Image EXIF extraction |
| `/osint/email-pattern` | POST | Email format mining |
| `/osint/wayback-diff` | POST | Content change analysis |
| `/osint/network-intel` | POST | Full ASN/reverse IP |

### Automation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/osint/chain/execute` | POST | Run investigation chain |
| `/osint/chains` | GET | List chain templates |
| `/osint/monitors` | GET/POST | Monitor targets |
| `/osint/monitors/:id/run` | POST | Run monitor check |
| `/osint/batch` | POST | Batch investigation |
| `/osint/nl` | POST | Natural language parse |
| `/osint/nl/execute` | POST | NL parse + execute |
| `/osint/export/pdf` | POST | PDF report export |
| `/osint/webhooks` | GET/POST | Webhook notifications |
| `/osint/history` | GET | Investigation history |
| `/osint/knowledge-graph` | GET | Accumulated entity stats |

---

## Investigation Chains

Pre-built multi-step workflows:

```bash
# Full domain investigation (6 steps)
curl -X POST http://localhost:3000/api/v1/osint/chain/execute \
  -H 'Content-Type: application/json' \
  -d '{"chain": "full-domain", "target": "example.com"}'
```

| Chain | Steps |
|-------|-------|
| `full-domain` | domain → network → web → threat → ssl → dorks |
| `deep-subdomain` | subdomain enum → port scan each |
| `identity-deep` | identity → breach → github |
| `infrastructure-map` | domain → asn → network |
| `web-exposure` | crawl → docs → dorks → threat |

---

## Configuration

OSINT modules work without any configuration. For LLM-powered chat and task planning:

```bash
# Any OpenAI-compatible API
LLM_PLANNER_PROVIDER=openai-compatible
LLM_PLANNER_API_KEY=sk-...
LLM_PLANNER_MODEL=gpt-4o
LLM_PLANNER_BASE_URL=https://api.openai.com/v1

# Or Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...

# Or local Ollama (free)
LLM_PLANNER_PROVIDER=openai-compatible
LLM_PLANNER_API_KEY=ollama
LLM_PLANNER_MODEL=llama3
LLM_PLANNER_BASE_URL=http://localhost:11434/v1

# Auth (disable for local dev)
AGENT_API_AUTH=false
```

---

## Development

```bash
npm run build          # TypeScript → dist/
npm run api            # Start API server (dev mode)
npm run osint -- --help  # CLI tool
npm test               # Unit tests
npm run test:e2e       # E2E tests (requires Playwright)
```

### Module Layout

```
src/osint/              33 OSINT modules
  domain-recon.ts         WHOIS, DNS, subdomains, certificates
  network-recon.ts        Port scan, geolocation, banners, traceroute
  identity-recon.ts       Username enum (37 platforms), email validation
  web-intel.ts            Tech stack, Wayback, dorks, robots.txt
  threat-intel.ts         URLhaus, DNSBL, SSL, phishing patterns
  reverse-ip.ts           Reverse IP, ASN, CIDR, IP blocks
  breach-check.ts         HIBP k-anonymity, password strength
  crawler.ts              Deep crawl, screenshot capture
  github-recon.ts         Code leak scan, secret detection
  dork-executor.ts        DuckDuckGo/Bing automated search
  doc-scanner.ts          PDF/image metadata batch extraction
  js-analyzer.ts          JS secret/endpoint extraction
  waf-detect.ts           WAF/CDN fingerprinting
  subdomain-takeover.ts   Dangling CNAME detection
  cve-matcher.ts          NVD vulnerability matching
  typosquat.ts            Domain variant generation + check
  cloud-enum.ts           S3/Azure/GCP bucket discovery
  api-discovery.ts        Hidden endpoint probing
  news-monitor.ts         Security RSS feed monitoring
  darkweb.ts              .onion index search
  advanced-recon.ts       Subdomain wordlist, email patterns, SSL deep
  metadata-extract.ts     EXIF, PDF metadata, HTTP fingerprint
  data-correlator.ts      Entity graph, clustering, path finding
  report-generator.ts     Markdown + risk assessment
  investigation-chain.ts  Multi-step workflow automation
  monitor.ts              Change detection + alerting
  batch.ts                CSV/list batch processing
  storage.ts              SQLite persistence + history diff
  pdf-export.ts           HTML→PDF report generation
  webhook.ts              Slack/Discord/Telegram notifications
  nl-investigator.ts      Natural language → module selection
  cli.ts                  Command-line interface (19 commands)
  index.ts                Unified exports
```

---

## Tech Stack

- **Runtime**: Node.js 22, TypeScript 5.9
- **Backend**: Fastify, better-sqlite3, Playwright
- **Frontend**: React 19, Vite 6, Tailwind CSS
- **OSINT Data**: System commands (`whois`, `dig`, `openssl`), free public APIs (crt.sh, ip-api.com, archive.org, abuse.ch, HaveIBeenPwned, NVD, HackerTarget, RIPE)

---

## License

MIT
