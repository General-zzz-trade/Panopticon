/**
 * Heartbeat — periodic health monitoring and stale task detection.
 *
 * Reports:
 *   - Process uptime and memory usage
 *   - Active run count
 *   - Last successful run timestamp
 *   - Component health (DB, browser, LLM)
 *   - Stale task detection (running too long)
 */

import { logModuleError } from "../core/module-logger";

export interface ComponentHealth {
  name: string;
  healthy: boolean;
  latencyMs?: number;
  message: string;
}

export interface HeartbeatReport {
  timestamp: string;
  uptimeMs: number;
  memoryMB: { rss: number; heapUsed: number; heapTotal: number };
  components: ComponentHealth[];
  activeRuns: number;
  lastSuccessfulRun?: string;
  staleRuns: string[];
  healthy: boolean;
}

const startTime = Date.now();
let lastSuccessfulRun: string | undefined;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatCallback: ((report: HeartbeatReport) => void) | null = null;

// Track active runs
const activeRuns = new Map<string, { startedAt: number; goal: string }>();

/**
 * Record a run starting.
 */
export function recordRunStart(runId: string, goal: string): void {
  activeRuns.set(runId, { startedAt: Date.now(), goal });
}

/**
 * Record a run completing.
 */
export function recordRunEnd(runId: string, success: boolean): void {
  activeRuns.delete(runId);
  if (success) {
    lastSuccessfulRun = new Date().toISOString();
  }
}

/**
 * Generate a heartbeat report.
 */
export async function generateHeartbeat(): Promise<HeartbeatReport> {
  const mem = process.memoryUsage();
  const components = await checkComponents();
  const staleRuns = detectStaleRuns(300000); // 5 min threshold

  return {
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - startTime,
    memoryMB: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
    },
    components,
    activeRuns: activeRuns.size,
    lastSuccessfulRun,
    staleRuns,
    healthy: components.every(c => c.healthy) && staleRuns.length === 0
  };
}

/**
 * Start periodic heartbeat.
 */
export function startHeartbeat(
  intervalMs: number = 30000,
  callback?: (report: HeartbeatReport) => void
): void {
  if (heartbeatInterval) return;
  heartbeatCallback = callback ?? null;

  heartbeatInterval = setInterval(async () => {
    try {
      const report = await generateHeartbeat();
      if (heartbeatCallback) heartbeatCallback(report);
      if (!report.healthy) {
        console.warn("[heartbeat] UNHEALTHY:", report.components.filter(c => !c.healthy).map(c => c.name).join(", "));
        if (report.staleRuns.length > 0) {
          console.warn("[heartbeat] Stale runs:", report.staleRuns.join(", "));
        }
      }
    } catch (error) {
      logModuleError("heartbeat", "critical", error, "heartbeat check failed");
    }
  }, intervalMs);
}

/**
 * Stop periodic heartbeat.
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ── Component checks ────────────────────────────────────────────────────

async function checkComponents(): Promise<ComponentHealth[]> {
  const results: ComponentHealth[] = [];

  // DB check
  results.push(checkDatabase());

  // LLM check
  results.push(checkLLM());

  // Memory check
  results.push(checkMemory());

  return results;
}

function checkDatabase(): ComponentHealth {
  try {
    const start = Date.now();
    const { getDb } = require("../db/client");
    const db = getDb();
    db.prepare("SELECT 1").get();
    return { name: "database", healthy: true, latencyMs: Date.now() - start, message: "SQLite OK" };
  } catch (error) {
    return { name: "database", healthy: false, message: error instanceof Error ? error.message : "DB unavailable" };
  }
}

function checkLLM(): ComponentHealth {
  const key = process.env.LLM_PLANNER_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.LLM_REACT_API_KEY;
  if (!key) {
    return { name: "llm", healthy: true, message: "No LLM configured (rule-only mode)" };
  }
  return { name: "llm", healthy: true, message: "API key configured" };
}

function checkMemory(): ComponentHealth {
  const mem = process.memoryUsage();
  const heapUsedMB = mem.heapUsed / 1024 / 1024;
  const healthy = heapUsedMB < 1024; // Alert if > 1GB
  return {
    name: "memory",
    healthy,
    message: healthy ? `Heap: ${heapUsedMB.toFixed(0)}MB` : `HIGH MEMORY: ${heapUsedMB.toFixed(0)}MB`
  };
}

function detectStaleRuns(thresholdMs: number): string[] {
  const now = Date.now();
  const stale: string[] = [];
  for (const [runId, info] of activeRuns) {
    if (now - info.startedAt > thresholdMs) {
      stale.push(`${runId} (${info.goal.slice(0, 50)}, ${Math.round((now - info.startedAt) / 1000)}s)`);
    }
  }
  return stale;
}
