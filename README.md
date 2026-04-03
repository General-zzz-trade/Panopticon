# Agent Orchestrator

An engineering-grade cognitive agent runtime for UI and tool workflows.

中文版本：[README.zh-CN.md](README.zh-CN.md) | [docs/agi-agent-vision.zh-CN.md](docs/agi-agent-vision.zh-CN.md)

## What It Does

A recoverable agent platform with a complete cognitive loop:

- **Plan** with rule planners, knowledge templates, and LLM planners (4 competing strategies)
- **Execute** browser, vision, HTTP, file, shell, and code actions (19 task types)
- **Observe** environment state before and after every action
- **Verify** action outcomes, state consistency, and goal progress (three-layer verification)
- **Recover** from failures with hypothesis-driven experiments and Bayesian belief updates
- **Learn** procedural memory from past runs and reuse it in planning and recovery
- **Track** LLM token usage, enforce budgets, expose Prometheus metrics

## Architecture

```
CLI / API Client
       │
  Fastify API Server (/api/v1/runs, /stream, /schedules, /approvals)
       │
  Worker Pool (configurable concurrency)
       │
  runGoal() ── Main Runtime Loop
  ├─ Planning Phase (template → regex → knowledge → LLM, best wins)
  ├─ Execution Loop (per task):
  │   1. Observe → 2. Execute → 3. Verify (action + state + goal)
  │   4. Decide (continue | retry | replan | abort)
  │   5. If failed → Hypothesize → Experiment → Belief Update → Recover
  └─ Post-Execution: extract knowledge, save run, reflect
       │
  Subsystems: Playwright browser, LLM providers (Anthropic/OpenAI),
              SQLite persistence, session management, plugin registry
```

## Quick Start

```bash
# Install
npm install
npx playwright install chromium

# Run via CLI
npm run dev -- 'start app "npm run dev" and wait for server "http://localhost:3000" and open page "http://localhost:3000" and click "#login" and assert text "Dashboard" and screenshot to artifacts/shot.png and stop app'

# Run via API
npm run api                    # Starts on port 3000
curl -X POST http://localhost:3000/api/v1/runs \
  -H "Content-Type: application/json" \
  -d '{"goal": "open page \"https://example.com\" and screenshot"}'
```

## Configuration

LLM providers are configured via environment variables:

```bash
# Planner (generates task sequences from goals)
LLM_PLANNER_PROVIDER=anthropic          # or openai-compatible
LLM_PLANNER_MODEL=claude-sonnet-4-20250514
LLM_PLANNER_API_KEY=sk-...

# Replanner (recovery planning on failures)
LLM_REPLANNER_PROVIDER=anthropic
LLM_REPLANNER_API_KEY=sk-...

# Goal Verifier (optional semantic goal verification)
LLM_VERIFIER_PROVIDER=anthropic
LLM_VERIFIER_API_KEY=sk-...

# Server
PORT=3000
LOG_LEVEL=info
WORKER_CONCURRENCY=4
```

## Testing

```bash
# Unit + integration tests (191 tests)
node --import tsx --test src/verifier/*.test.ts src/cognition/*.test.ts \
  src/core/*.test.ts src/approval/*.test.ts src/auth/*.test.ts \
  src/observability/*.test.ts src/llm/provider.test.ts

# API tests (21 tests)
node --import tsx --test src/api/server.test.ts src/api/sanitize.test.ts \
  src/api/security.test.ts

# E2E tests (5 scenarios, requires Playwright)
node --import tsx --test src/e2e.integration.test.ts

# All at once
npm test
```

CI runs automatically on push/PR to main via GitHub Actions (`.github/workflows/ci.yml`).

## Project Structure

```
src/
├── core/           Runtime loop, executor, policy, escalation, retry, reflector
├── cognition/      Observation, hypothesis, experiments, belief updates, decisions
├── verifier/       Action, state, and goal verification (three-layer cascade)
├── planner/        Template, regex, knowledge, prior-aware planners + replanner
├── llm/            LLM provider abstraction (Anthropic + OpenAI), planner, replanner, diagnoser
├── handlers/       Browser, vision, HTTP, file, shell, code, assertion handlers
├── knowledge/      Procedural memory: selector maps, failure lessons, task templates
├── api/            Fastify server, routes, auth plugin, rate limiting, sanitization
├── db/             SQLite client, schema, runs repository
├── observability/  Prometheus metrics, usage ledger (token tracking + budgets)
├── approval/       Human-in-the-loop task approval gate
├── auth/           Session manager, cookie persistence
├── streaming/      Real-time event bus, screencast recording
├── scheduler/      Cron-based job scheduling
├── worker/         Job queue with concurrency control
├── plugins/        Plugin registry for custom action handlers
├── vision/         LLM-powered visual element location
├── sandbox/        Docker-sandboxed code execution
└── ...             CLI, types, browser/shell infrastructure
```

## Key Design Decisions

**Multi-strategy planning** — Four planners compete; quality scoring selects the best. LLM is a fallback, not default, keeping costs low.

**Three-layer verification** — Every task is verified at action level (did it work?), state level (is the world consistent?), and goal level (are we making progress?). The goal verifier cascades through quote extraction, task-completion heuristic, and LLM semantic check.

**Hypothesis-driven recovery** — Failures generate typed hypotheses (selector drift, state not ready, session lost, etc.) plus learned patterns from the knowledge store. Low-risk experiments test each hypothesis. Bayesian belief updates (with evidence weighting by experiment reliability) rank the best recovery path.

**Procedural memory** — Successful runs are distilled into selector maps, failure lessons, and task templates. Future runs query these for planning priors and recovery strategies.

**LLM cost control** — Token-level tracking (input + output) per run. Budget enforcement via `isTokenBudgetExceeded()`. Prometheus counters for monitoring.

## Documentation

- [Architecture Vision](docs/agi-agent-vision.md)
- [Phase 1 Spec: Verification Layer](docs/superpowers/specs/2026-04-03-verification-layer-hardening-design.md)
- [Phase 2 Spec: Cognition Learning](docs/superpowers/specs/2026-04-03-phase2-cognition-learning-auth-tests-design.md)
- [Phase 3 Spec: LLM Cost Control](docs/superpowers/specs/2026-04-03-phase3-llm-cost-control-design.md)

## Monitoring

```bash
# Prometheus metrics endpoint
curl http://localhost:3000/metrics

# Available metrics:
# agent_runs_total, agent_runs_success_total, agent_runs_failed_total
# agent_tasks_total, agent_replans_total, agent_llm_calls_total
# agent_llm_input_tokens_total, agent_llm_output_tokens_total
# agent_llm_latency_ms_total
# agent_queue_pending, agent_queue_running
```

## Run Inspection

```bash
npm run inspect:run -- artifacts/runs/<run-id>.json
```

Shows the full cognition trace: world state history, observations, verification results, hypothesis generation, experiment outcomes, belief updates, and executive decisions.
