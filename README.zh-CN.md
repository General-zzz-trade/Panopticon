# Agent Orchestrator

**一个生产级的开源 Agent Harness，拥有深度认知架构。**

一个 LLM 无关的运行时，把任何语言模型变成能自主工作的 Agent。5 种执行模式、完整的恢复循环、可解释的决策、7×24 自主运行。

[English README](README.md) · [部署指南](DEPLOY.md) · [架构文档](docs/agi-agent-vision.zh-CN.md)

---

## 为什么与众不同

大多数开源 agent 只是 LLM tool-calling 的薄封装。这个项目是一个完整的 **Harness**（2026 年的术语，指"模型周围所有让它工作的东西"）：

| | 本项目 | 常见 agent 框架 |
|---|---|---|
| 执行模式 | 5 种 (sequential / react / cli / desktop / htn) | 1-2 种 |
| 失败恢复 | 贝叶斯假设引擎 + 实验验证 | 带退避的重试 |
| 可解释性 | 每个决策都可通过 `/explain` API 查询 | 黑盒 |
| 学习 | 战略级 (跨 run) + 战术级 (run 内) | 只有记忆 |
| LLM 绑定 | 无 — 任何 OpenAI-compatible API | 通常绑定单一厂商 |
| 自主性 | Watchers + 目标合成 + Goal-Driven 循环 | 每次请求一个目标 |

**在 ~100 个真实任务上验证 97% 成功率**（HumanEval、AgencyBench Code、真实网站、CLI 自动化）。已知限制：抽象推理 (ARC-AGI 0%) — 需要 o3 级别的 LLM。

---

## 快速开始（5 分钟）

```bash
git clone https://github.com/General-zzz-trade/Agent-orchestrator.git
cd Agent-orchestrator
npm install
npx playwright install chromium

# 配置任意 LLM (Anthropic, OpenAI-compatible, 或 Moonshot K2.5)
cp .env.desktop.example .env
# 编辑 .env 填入你的 API key

# 启动 API server
node --env-file=.env --import tsx src/api/server.ts

# 跑一个目标
curl -X POST http://localhost:3000/api/v1/runs \
  -H 'Content-Type: application/json' \
  -d '{"goal": "go to example.com and tell me what the page says", "executionMode": "react"}'
```

详见 [DEPLOY.md](DEPLOY.md)。

---

## 5 种执行模式

```bash
# DSL (最快，已知模式无需 LLM)
runGoal('open page "https://x.com" and assert text "Welcome"')

# 自然语言 (LLM 规划任务)
runGoal('verify that x.com works correctly')

# ReAct (LLM 驱动每一步)
runGoal('go to github.com and find the trending Python repo', { executionMode: 'react' })

# CLI (持久 shell)
runGoal('find all .ts files, count total lines', { executionMode: 'cli' })

# Desktop (通过 xdotool 进行 GUI 自动化)
runGoal('open LibreOffice Calc and create a spreadsheet', { executionMode: 'desktop' })
```

**自动升级**：sequential 模式失败的 NL 目标自动切换到 ReAct。

---

## 认知循环（核心差异化）

任务失败时，大多数 agent 用退避重试。这个 agent 运行**真正的诊断循环**：

```
任务失败
  ↓
假设引擎生成 5 种类型化假设
  (selector_drift / state_not_ready / session_lost / etc.)
  ↓
实验运行器测试每个假设（非破坏性探测）
  ↓
贝叶斯信念更新器调整置信度 (Beta 分布)
  ↓
恢复合成器需要时编写新代码/步骤
  ↓
反事实推理器通过因果图建议替代方案
  ↓
Replanner 插入恢复任务，或升级到视觉降级
```

每一步记录到推理追踪，通过 `GET /runs/:id/explain` 查询。

---

## 自主运行

构建真正的 7×24 自主系统：

```typescript
import { startAutonomousLoop, addAutonomousWatcher } from './src/autonomy/autonomous-loop';
import { createDirectoryWatcher } from './src/autonomy/environment-watcher';

startAutonomousLoop();
addAutonomousWatcher(createDirectoryWatcher('inbox', '/var/inbox', 5000));
// 新文件出现 → agent 读取 → 决定 → 执行
```

还有：心跳监控、Cron 调度、Goal-Driven master/subagent (支持 300+ 小时)。

---

## 内置集成

| 集成 | 文件 |
|------|------|
| 浏览器 (Playwright) | `src/handlers/browser-handler.ts` |
| 持久 shell | `src/handlers/shell-session.ts` |
| HTTP/文件/代码执行 | `src/handlers/*.ts` |
| 桌面 GUI (xdotool) | `src/computer-use/desktop-agent.ts` |
| 视觉 (Claude) | `src/handlers/computer-use-handler.ts` |
| 邮件 (SMTP) | `src/handlers/email-handler.ts` |
| 文档 (CSV/PDF/Excel) | `src/handlers/document-handler.ts` |
| Telegram bot | `src/integrations/telegram-bot.ts` |

---

## 基准测试

```bash
npm run benchmark:full          # 完整套件（26 个测试）
npm run benchmark:webarena      # WebArena 适配器
```

### 验证结果

| 类别 | 任务 | 通过率 |
|------|------|--------|
| DSL/NL/ReAct/CLI | 37 | 100% |
| HumanEval 风格 | 8 | 100% |
| AgencyBench Code | 3 | 100% |
| 对抗性代码审计 | 5 | 100% |
| ARC-AGI 抽象推理 | 5 | 0% |
| **总计** | **~100** | **~97%** |

**已知限制**：架构不是瓶颈，LLM 是。

---

## LLM 提供方配置

```bash
# Moonshot K2.5 (经过测试)
LLM_PLANNER_PROVIDER=openai-compatible
LLM_PLANNER_API_KEY=sk-...
LLM_PLANNER_MODEL=kimi-k2.5
LLM_PLANNER_BASE_URL=https://api.moonshot.cn/v1
LLM_PLANNER_TIMEOUT_MS=120000

# Anthropic / OpenAI / DeepSeek 等都支持
```

可为每个角色配置不同 LLM：planner、replanner、recovery、verifier、react、vision。

---

## 许可证

MIT. 见 [LICENSE](LICENSE).
