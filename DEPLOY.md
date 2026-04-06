# Panopticon 部署指南

## 快速启动（3 分钟）

```bash
# 1. 克隆并安装
git clone https://github.com/General-zzz-trade/Agent-orchestrator.git
cd Agent-orchestrator
npm install

# 2. 启动（OSINT 模块无需 API Key）
AGENT_API_AUTH=false node --import tsx src/api/server.ts

# 3. 打开浏览器
open http://localhost:3000
```

OSINT 模块开箱即用，无需任何配置。LLM 聊天功能需要额外配置（见下文）。

## CLI 工具

```bash
# 19 个 OSINT 命令
npm run osint -- investigate github.com       # 综合调查
npm run osint -- domain example.com           # 域名侦查
npm run osint -- network 8.8.8.8              # 网络扫描
npm run osint -- identity torvalds            # 身份查询（37平台）
npm run osint -- breach password123           # 泄露检查
npm run osint -- threat phishing-site.tk      # 威胁情报
npm run osint -- web https://example.com      # Web 情报
npm run osint -- nl "调查 github.com 的子域名" # 自然语言

# 输出 JSON
npm run osint -- investigate github.com --json

# 所有命令
npm run osint -- --help
```

## LLM 配置（可选）

OSINT 模块不需要 LLM。如需聊天和智能任务规划：

```bash
cat > .env << 'EOF'
# ── 选择一个 LLM ─────────────────────

# OpenAI
LLM_PLANNER_PROVIDER=openai-compatible
LLM_PLANNER_API_KEY=sk-...
LLM_PLANNER_MODEL=gpt-4o
LLM_PLANNER_BASE_URL=https://api.openai.com/v1

# 或 Anthropic Claude
# ANTHROPIC_API_KEY=sk-ant-...

# 或 Moonshot K2.5（中国）
# LLM_PLANNER_PROVIDER=openai-compatible
# LLM_PLANNER_API_KEY=sk-...
# LLM_PLANNER_MODEL=kimi-k2.5
# LLM_PLANNER_BASE_URL=https://api.moonshot.cn/v1

# 或 Ollama（本地免费）
# LLM_PLANNER_PROVIDER=openai-compatible
# LLM_PLANNER_API_KEY=ollama
# LLM_PLANNER_MODEL=llama3
# LLM_PLANNER_BASE_URL=http://localhost:11434/v1

# ── 认证（开发模式关闭）────────────
AGENT_API_AUTH=false
EOF

# 启动
node --env-file=.env --import tsx src/api/server.ts
```

## Docker 部署

```bash
# 基础 API 服务器
docker compose up --build -d

# 完整桌面环境（含 Chromium + VNC）
docker compose -f docker-compose.desktop.yml up --build -d
# VNC 访问: http://localhost:6080/vnc.html
```

## API 端点速查

### 核心调查

```bash
# 综合调查
curl -X POST http://localhost:3000/api/v1/osint/investigate \
  -H 'Content-Type: application/json' \
  -d '{"target": "example.com"}'

# 域名侦查
curl http://localhost:3000/api/v1/osint/dns/example.com
curl http://localhost:3000/api/v1/osint/whois/example.com
curl http://localhost:3000/api/v1/osint/subdomains/example.com

# 网络扫描
curl -X POST http://localhost:3000/api/v1/osint/portscan \
  -H 'Content-Type: application/json' \
  -d '{"target": "8.8.8.8"}'

# 身份查询
curl -X POST http://localhost:3000/api/v1/osint/username \
  -H 'Content-Type: application/json' \
  -d '{"username": "torvalds"}'

# IP 地理定位
curl http://localhost:3000/api/v1/osint/geoip/8.8.8.8

# ASN 查询
curl http://localhost:3000/api/v1/osint/asn/8.8.8.8
```

### 威胁 & 漏洞

```bash
# 威胁检查
curl -X POST http://localhost:3000/api/v1/osint/threat \
  -H 'Content-Type: application/json' \
  -d '{"target": "suspicious-site.tk"}'

# 泄露检查
curl -X POST http://localhost:3000/api/v1/osint/breach/password \
  -H 'Content-Type: application/json' \
  -d '{"password": "test123"}'

# WAF 检测
curl -X POST http://localhost:3000/api/v1/osint/waf \
  -H 'Content-Type: application/json' \
  -d '{"target": "https://example.com"}'
```

### 自动化

```bash
# 调查链
curl http://localhost:3000/api/v1/osint/chains  # 列出可用链

curl -X POST http://localhost:3000/api/v1/osint/chain/execute \
  -H 'Content-Type: application/json' \
  -d '{"chain": "full-domain", "target": "example.com"}'

# 自然语言调查
curl -X POST http://localhost:3000/api/v1/osint/nl/execute \
  -H 'Content-Type: application/json' \
  -d '{"query": "scan ports on 8.8.8.8"}'

# 批量调查
curl -X POST http://localhost:3000/api/v1/osint/batch \
  -H 'Content-Type: application/json' \
  -d '{"targets": ["github.com", "gitlab.com"]}'
```

## 系统要求

- Node.js 22+
- 系统命令: `whois`, `dig`, `openssl`（大多数 Linux 发行版自带）
- 可选: Playwright Chromium（截图和深度爬虫）
- 可选: Docker（桌面环境和代码沙箱）

```bash
# 安装系统依赖（Ubuntu/Debian）
sudo apt-get install -y whois dnsutils openssl

# 安装 Playwright（可选）
npx playwright install chromium --with-deps
```

## Webhook 通知

支持 Slack、Discord、Telegram、通用 HTTP webhook：

```bash
# 添加 Slack webhook
curl -X POST http://localhost:3000/api/v1/osint/webhooks \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "slack",
    "url": "https://hooks.slack.com/services/...",
    "name": "Security Alerts",
    "events": ["threat_detected", "monitor_alert"]
  }'

# 添加 Telegram 通知
curl -X POST http://localhost:3000/api/v1/osint/webhooks \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "telegram",
    "url": "",
    "token": "YOUR_BOT_TOKEN",
    "chatId": "YOUR_CHAT_ID",
    "name": "OSINT Bot",
    "events": ["investigation_complete"]
  }'
```

## 监控

```bash
# 添加监控目标
curl -X POST http://localhost:3000/api/v1/osint/monitors \
  -H 'Content-Type: application/json' \
  -d '{
    "target": "example.com",
    "checks": ["subdomains", "ports", "ssl_expiry", "uptime"],
    "intervalMs": 3600000
  }'

# 手动触发检查
curl -X POST http://localhost:3000/api/v1/osint/monitors/<id>/run
```
