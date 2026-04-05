# Agent-Orchestrator 部署指南

## 最快启动 (5 分钟)

```bash
# 1. 克隆并安装依赖
git clone <repo>
cd Agent-orchestrator
npm install
npx playwright install chromium --with-deps

# 2. 配置 LLM API (至少一个)
cat > .env << 'EOF'
# Moonshot K2.5 (中国)
LLM_PLANNER_PROVIDER=openai-compatible
LLM_PLANNER_API_KEY=sk-your-key-here
LLM_PLANNER_MODEL=kimi-k2.5
LLM_PLANNER_BASE_URL=https://api.moonshot.cn/v1
LLM_PLANNER_TIMEOUT_MS=120000

LLM_REACT_PROVIDER=openai-compatible
LLM_REACT_API_KEY=sk-your-key-here
LLM_REACT_MODEL=kimi-k2.5
LLM_REACT_BASE_URL=https://api.moonshot.cn/v1
LLM_REACT_TIMEOUT_MS=120000
LLM_REACT_MAX_TOKENS=4000

# 或者用 Anthropic Claude
# ANTHROPIC_API_KEY=sk-ant-...
EOF

# 3. 启动 API server
node --env-file=.env --import tsx src/api/server.ts

# 4. 测试 (另一个终端)
curl -X POST http://localhost:3000/api/v1/runs \
  -H 'Content-Type: application/json' \
  -d '{"goal": "open page \"https://example.com\" and assert text \"Example Domain\""}'

# 5. 检查健康
curl http://localhost:3000/health
```

## 执行模式

| 模式 | 适用场景 | 调用方式 |
|------|---------|---------|
| `sequential` | DSL/NL 目标 | 默认 |
| `react` | 开放式 NL 目标 | `{"executionMode": "react"}` |
| `cli` | Shell 任务 | `{"executionMode": "cli"}` |
| `desktop` | 桌面 GUI 操作 | `{"executionMode": "desktop"}` |
| `htn` | 分层任务分解 | `{"executionMode": "htn"}` |

## Docker 部署

```bash
# 基础 API server
docker compose up --build -d

# 完整桌面环境 (含 LibreOffice + VNC)
docker compose -f docker-compose.desktop.yml up --build -d
# 访问 http://localhost:6080/vnc.html 实时观看
```

## 环境变量配置

详见 `.env.desktop.example` 和 `.env.moonshot.example`

## Telegram Bot 集成

```bash
export TELEGRAM_BOT_TOKEN=your-token
node --env-file=.env --import tsx -e "
const { startTelegramBot } = require('./src/integrations/telegram-bot');
startTelegramBot(process.env.TELEGRAM_BOT_TOKEN);
"
```
