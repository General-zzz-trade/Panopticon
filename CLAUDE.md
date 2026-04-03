# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Agent-orchestrator is a cognitive agent runtime for UI automation. It plans tasks from natural-language goals, executes them via browser/HTTP/file/shell handlers, verifies results at three levels, and recovers from failures using hypothesis-driven reasoning with Bayesian belief updates.

## Commands

```bash
# Build
npm run build                    # tsc → dist/

# Run
npm run dev -- "goal here"       # Development (tsx, no compile step)
npm start                        # Production (requires build first)
npm run api                      # Fastify API server (port 3000)
npm run sample:app               # Sample HTTP server for testing (port 3210)

# Tests — all use node:test (no Jest/Vitest)
npm test                         # Unit + smoke tests
npm run test:e2e                 # E2E (requires: npx playwright install chromium --with-deps)

# Run a single test file
node --import tsx --test src/path/to/file.test.ts

# Run all unit/integration tests (same as CI)
node --import tsx --test src/verifier/*.test.ts src/cognition/*.test.ts src/core/*.test.ts ...

# Utilities
npm run benchmark:planner
npm run inspect:run -- artifacts/runs/<run-id>.json
```

## Architecture

### Core Loop (`src/core/runtime.ts` — `runGoal()`)

The runtime executes a cognitive loop per task:

```
Plan → for each task: Observe → Execute → Verify → Decide → (Hypothesize → Experiment → Recover)
```

1. **Planning** (`src/planner/`): Four competing planners — template (regex patterns), regex (fallback), knowledge (learned templates), LLM (expensive last resort). Best plan wins by quality score.
2. **Execution** (`src/core/executor.ts` → `src/handlers/`): Dispatches to typed handlers (browser, HTTP, file, shell, code, vision).
3. **Verification** (`src/verifier/`): Three-layer cascade — action verifier (did it work?), state verifier (is state consistent?), goal verifier (progress toward goal?).
4. **Decision** (`src/cognition/executive-controller.ts`): Continue | Retry | Replan | Abort based on verification confidence and budget.
5. **Recovery** (on failure): Hypothesis engine generates typed failure hypotheses → experiment runner tests them → belief updater applies Bayesian updates → best recovery path chosen.

### Research Modules Integrated into Runtime

Before planning: semantic episode search provides context from similar past runs.
After verification: anomaly detector flags unusual state; meta-cognition adjusts confidence.
On failure: online adapter suggests in-run strategy changes.
After run: episode store persists run summary with embeddings for future retrieval.

### Key Abstractions

- **`RunContext`** (`src/types.ts`): Central state object threaded through the entire loop — holds tasks, observations, world state, browser session, usage ledger, and all cognitive artifacts.
- **`AgentTask`**: Typed action (`click`, `type`, `assert_text`, `visual_click`, `http_request`, `run_code`, etc. — 20 types) with payload and status.
- **`AgentObservation`** / **`WorldStateSnapshot`** (`src/cognition/types.ts`): Environment state captured by the observation engine.
- **`FailureHypothesis`**: Typed hypothesis (selector_drift, state_not_ready, session_not_established, etc.) with confidence and recovery hints.

### LLM Layer (`src/llm/`)

- `provider.ts` — abstraction over Anthropic, OpenAI-compatible, and mock providers
- Configured via env vars: `LLM_PLANNER_PROVIDER`, `LLM_PLANNER_API_KEY`, `LLM_PLANNER_MODEL` (same pattern for replanner, verifier)
- Token usage tracked in `src/observability/usage-ledger.ts` with budget enforcement

### Persistence

- SQLite via `better-sqlite3` — tables: `runs`, `artifacts`, `observations`, `verification_results`, `episode_events`, `api_keys`
- Schema in `src/db/schema.ts`, repository in `src/db/runs-repo.ts`
- Multi-tenant: all tables have `tenant_id` column

### API (`src/api/`)

Fastify server with routes at `/api/v1/{runs,stream,schedules,memory,tools,approvals,sessions}`. Auth via API keys. Rate limiting and input sanitization built in.

## Testing Conventions

- Framework: Node.js native `node:test` + `node:assert/strict`
- Test files: colocated as `*.test.ts` next to source
- Pattern: `import test from "node:test"` / `import assert from "node:assert/strict"`
- CI runs 3 parallel jobs: unit/integration, API, E2E (see `.github/workflows/ci.yml`)
- E2E tests require Playwright with Chromium

## Module Layout

```
src/core/          Runtime loop, executor, policy, retry, escalation, reflector
src/planner/       Template/regex/knowledge/LLM planners, quality scoring
src/cognition/     Observation, hypothesis, experiments, belief updates, decisions, meta-cognition
src/verifier/      Action/state/goal verification cascade
src/llm/           LLM provider abstraction, planner/replanner/diagnoser prompts
src/handlers/      Task execution (browser, HTTP, file, shell, code, vision, assertion)
src/knowledge/     Procedural memory (selector maps, failure patterns, templates)
src/learning/      Online adaptation, reflection loop, strategy updates
src/memory/        Episode store, semantic search, embeddings
src/world-model/   Causal graph, state extraction, pattern abstraction
src/db/            SQLite client, schema, repository
src/api/           Fastify server, routes, auth, security
src/observability/ Prometheus metrics, token usage ledger
src/orchestration/ Multi-agent parallel coordinator
src/scheduler/     Cron-based job scheduling
src/worker/        Job queue with concurrency control
```

## TypeScript

- Target: ES2022, Module: CommonJS, Strict mode
- No path aliases — all imports are relative
- Dev runner: `tsx` (no compile step needed)
