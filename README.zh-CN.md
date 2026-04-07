# Panopticon

**AI 驱动的开源情报平台 — 无需 API Key**

自动化域名侦查、网络扫描、身份枚举、Web 情报收集、威胁评估。56 个 OSINT 模块，115 个 API 端点，19 个 CLI 命令，暗黑主题 React UI。

[English](README.md) · [部署指南](DEPLOY.md)

---

## 核心能力

所有模块仅使用免费公共数据源和系统命令，无需 Shodan、VirusTotal 或任何付费 API。

| 能力 | 模块 | 数据源 |
|------|------|--------|
| **域名侦查** | WHOIS、DNS（10类型）、子域名（300+前缀爆破+crt.sh）、证书、区域传输 | `whois`、`dig`、crt.sh |
| **网络扫描** | TCP端口扫描（30端口）、Banner抓取、IP地理定位、路由追踪、HTTP头审计 | TCP连接、ip-api.com |
| **身份查询** | 用户名枚举（37平台）、邮箱MX/SMTP验证、一次性邮箱检测 | HTTP HEAD、`dig` MX |
| **Web情报** | 技术栈（50+签名）、Wayback历史、Google Dork、robots.txt、站点地图 | fetch、archive.org |
| **威胁情报** | URLhaus恶意检测、7个DNSBL黑名单、SSL安全、钓鱼模式识别 | abuse.ch、DNS黑名单 |
| **ASN/反向IP** | AS号查询、CIDR映射、同IP域名发现、IP段信息 | Team Cymru、HackerTarget |
| **泄露检查** | 密码泄露检测（HIBP k-匿名）、强度分析、邮箱泄露查询 | HaveIBeenPwned |
| **深度爬虫** | 递归站点爬取、邮箱/电话提取、表单发现、截图捕获 | fetch BFS、Playwright |
| **JS分析** | 密钥提取（20种模式）、API端点发现、内部URL检测 | fetch + 正则 |
| **GitHub扫描** | 公开仓库搜索、代码泄露检测（15种密钥模式） | GitHub公开API |
| **WAF/CDN检测** | 14种WAF + 14种CDN指纹、触发式WAF探测 | HTTP头/Cookie分析 |
| **子域名接管** | 20种服务指纹、悬挂CNAME检测 | `dig` + fetch |
| **CVE匹配** | Banner版本提取 → NVD CVE查询 | NVD REST API |
| **域名仿冒** | 8种变体类型（交换、同形异义、键盘邻近...）、注册检查 | DNS解析 |
| **云存储枚举** | S3/Azure Blob/GCP Storage桶发现 | HTTP探测 |
| **API发现** | 60+常见路径探测 | HTTP探测 |
| **新闻监控** | 8个安全RSS源、关键词匹配 | RSS/Atom解析 |
| **暗网搜索** | Ahmia.fi .onion索引、粘贴站搜索 | 公开索引 |

另外还有：调查链自动化（5个模板）、定时监控与变化检测、批量处理、自然语言查询解析、PDF报告导出、Slack/Discord/Telegram通知、SQLite持久化、知识图谱累积。

---

## 快速开始

```bash
git clone https://github.com/General-zzz-trade/Panopticon.git
cd Panopticon
npm install

# 启动（OSINT 无需 API Key）
AGENT_API_AUTH=false node --import tsx src/api/server.ts

# 打开浏览器
open http://localhost:3000
```

### CLI 使用

```bash
npm run osint -- investigate github.com       # 综合调查
npm run osint -- domain example.com           # 域名侦查
npm run osint -- network 8.8.8.8              # 网络扫描
npm run osint -- identity torvalds            # 身份查询
npm run osint -- breach password123           # 泄露检查
npm run osint -- threat phishing-site.tk      # 威胁检测
npm run osint -- nl "扫描 8.8.8.8 的端口"      # 自然语言
npm run osint -- --help                       # 所有命令
```

### API 使用

```bash
# 综合调查
curl -X POST http://localhost:3000/api/v1/osint/investigate \
  -H 'Content-Type: application/json' \
  -d '{"target": "github.com"}'

# 用户名枚举
curl -X POST http://localhost:3000/api/v1/osint/username \
  -H 'Content-Type: application/json' \
  -d '{"username": "torvalds"}'

# 密码泄露检查
curl -X POST http://localhost:3000/api/v1/osint/breach/password \
  -H 'Content-Type: application/json' \
  -d '{"password": "password123"}'
```

---

## 调查链

预置的多步骤自动化工作流：

| 链名 | 步骤 |
|------|------|
| `full-domain` | 域名 → 网络 → Web → 威胁 → SSL → Dork |
| `deep-subdomain` | 子域名枚举 → 逐个端口扫描 |
| `identity-deep` | 身份 → 泄露 → GitHub |
| `infrastructure-map` | 域名 → ASN → 网络 |
| `web-exposure` | 爬虫 → 文档 → Dork → 威胁 |

```bash
curl -X POST http://localhost:3000/api/v1/osint/chain/execute \
  -H 'Content-Type: application/json' \
  -d '{"chain": "full-domain", "target": "example.com"}'
```

---

## LLM 配置（可选）

OSINT 模块无需 LLM。如需聊天功能：

```bash
# OpenAI
LLM_PLANNER_PROVIDER=openai-compatible
LLM_PLANNER_API_KEY=sk-...
LLM_PLANNER_MODEL=gpt-4o
LLM_PLANNER_BASE_URL=https://api.openai.com/v1

# 或 Ollama（本地免费）
LLM_PLANNER_PROVIDER=openai-compatible
LLM_PLANNER_API_KEY=ollama
LLM_PLANNER_MODEL=llama3
LLM_PLANNER_BASE_URL=http://localhost:11434/v1
```

---

## 技术栈

- **运行时**: Node.js 22, TypeScript 5.9
- **后端**: Fastify, better-sqlite3, Playwright
- **前端**: React 19, Vite 6, Tailwind CSS
- **数据源**: 系统命令 (`whois`/`dig`/`openssl`) + 免费公共API (crt.sh, ip-api.com, archive.org, abuse.ch, HaveIBeenPwned, NVD, HackerTarget, RIPE)

---

## 许可证

MIT
