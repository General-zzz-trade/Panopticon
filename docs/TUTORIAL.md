# Panopticon OSINT Tutorial

A step-by-step guide to conducting OSINT investigations.

## Quick Start

```bash
git clone https://github.com/General-zzz-trade/Panopticon.git
cd Panopticon
npm install
sudo apt-get install -y whois dnsutils nmap   # OSINT dependencies

# Start server
AGENT_API_AUTH=false node --import tsx src/api/server.ts
# Open http://localhost:3000
```

## Tutorial 1: Investigate a Domain

**Goal:** Full security assessment of `example.com`

### CLI (one command)

```bash
npm run osint -- investigate example.com
```

### API (step by step)

```bash
# Step 1: WHOIS
curl -s http://localhost:3000/api/v1/osint/whois/example.com | jq .

# Step 2: DNS Records
curl -s http://localhost:3000/api/v1/osint/dns/example.com | jq '.data | length'

# Step 3: Subdomains
curl -s http://localhost:3000/api/v1/osint/subdomains/example.com | jq '.count'

# Step 4: Port Scan (nmap)
curl -s -X POST http://localhost:3000/api/v1/osint/nmap/quick \
  -H 'Content-Type: application/json' \
  -d '{"target": "example.com"}' | jq '.data.stats'

# Step 5: Email Security
curl -s http://localhost:3000/api/v1/osint/email-security/example.com | jq '.data.securityScore'

# Step 6: Full Auto Investigation (all modules)
curl -s -X POST http://localhost:3000/api/v1/osint/auto \
  -H 'Content-Type: application/json' \
  -d '{"target": "example.com", "depth": "deep"}' | jq '.data.multiDimensionScore'
```

**Expected output:** Risk score, 87 subdomains, open ports, email security rating, threat assessment.

---

## Tutorial 2: Investigate a Person

**Goal:** Digital footprint of a public figure

```bash
# Step 1: Username enumeration (37 platforms)
curl -s -X POST http://localhost:3000/api/v1/osint/username \
  -H 'Content-Type: application/json' \
  -d '{"username": "torvalds"}' | jq '.found, .total'

# Step 2: Email validation
curl -s http://localhost:3000/api/v1/osint/email/info@github.com | jq .

# Step 3: Breach check
curl -s -X POST http://localhost:3000/api/v1/osint/breach/password \
  -H 'Content-Type: application/json' \
  -d '{"password": "test123"}' | jq '.data.leaked, .data.leakCount'

# Step 4: News monitoring
curl -s -X POST http://localhost:3000/api/v1/osint/news/collect \
  -H 'Content-Type: application/json' \
  -d '{"query": "Linus Torvalds"}' | jq '.data.stats'

# Step 5: Twitter/X sentiment
curl -s -X POST http://localhost:3000/api/v1/osint/twitter/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "Linus Torvalds", "sentiment": true}' | jq '.data.sentiment'
```

---

## Tutorial 3: Threat Assessment

**Goal:** Check if a domain/URL is malicious

```bash
# Multi-engine URL safety check
curl -s -X POST http://localhost:3000/api/v1/osint/safety/url \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://suspicious-site.tk"}' | jq '.data.safe, .data.riskScore'

# Threat intelligence
curl -s -X POST http://localhost:3000/api/v1/osint/threat \
  -H 'Content-Type: application/json' \
  -d '{"target": "suspicious-site.tk"}' | jq '.data.riskScore, .data.suspiciousPatterns'

# Phishing pattern detection
curl -s -X POST http://localhost:3000/api/v1/osint/threat/suspicious \
  -H 'Content-Type: application/json' \
  -d '{"domain": "paypal-secure-login.tk"}' | jq .
```

---

## Tutorial 4: Bitcoin Address Tracking

```bash
# Analyze Satoshi's genesis address
curl -s -X POST http://localhost:3000/api/v1/osint/blockchain \
  -H 'Content-Type: application/json' \
  -d '{"address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"}' | jq '.data.wallet'
```

---

## Tutorial 5: News & Sentiment Analysis

```bash
# Collect news from 28 sources
curl -s -X POST http://localhost:3000/api/v1/osint/news/collect \
  -H 'Content-Type: application/json' \
  -d '{"query": "artificial intelligence", "fetchFullText": true}' | jq '.data.stats'

# Combined opinion analysis (social + news + sentiment)
curl -s -X POST http://localhost:3000/api/v1/osint/opinion \
  -H 'Content-Type: application/json' \
  -d '{"query": "OpenAI"}' | jq '.data.opinion.sentimentBreakdown'

# Official blog monitoring
curl -s -X POST http://localhost:3000/api/v1/osint/blogs \
  -H 'Content-Type: application/json' \
  -d '{"filter": ["OpenAI", "Anthropic"]}' | jq '.data.stats'
```

---

## Tutorial 6: STIX Export (for MISP/OpenCTI)

```bash
# Run investigation then export as STIX 2.1
RESULT=$(curl -s -X POST http://localhost:3000/api/v1/osint/investigate \
  -H 'Content-Type: application/json' \
  -d '{"target": "example.com"}')

curl -s -X POST http://localhost:3000/api/v1/osint/export/stix \
  -H 'Content-Type: application/json' \
  -d "{\"target\": \"example.com\", \"findings\": $RESULT}" | jq '.data.objects | length'
```

---

## CLI Reference

```bash
npm run osint -- investigate github.com       # Full investigation
npm run osint -- domain example.com           # Domain recon
npm run osint -- network 8.8.8.8              # Network scan
npm run osint -- identity torvalds            # Username enum
npm run osint -- breach password123           # Breach check
npm run osint -- threat phishing.tk           # Threat intel
npm run osint -- web https://example.com      # Web intel
npm run osint -- nl "scan ports on 8.8.8.8"   # Natural language
npm run osint -- --help                       # All commands
```

## Benchmark

```bash
npm run osint:benchmark                       # Run 62 tests (95% pass rate)
```
