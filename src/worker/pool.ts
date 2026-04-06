import { runGoal } from "../core/runtime";
import { setRunStatus, clearRunStatus } from "../api/run-store";
import { JobQueue, JobRequest } from "./queue";
import { incCounter, setGauge } from "../observability/metrics-store";
import { upsertRun } from "../db/runs-repo";
import { logModuleError } from "../core/module-logger";
import { ensureBus } from "../streaming/event-bus";

const DEFAULT_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

let _queue: JobQueue | null = null;

export function getQueue(): JobQueue {
  if (_queue) return _queue;

  _queue = new JobQueue(DEFAULT_CONCURRENCY);
  _queue.setHandler(processJob);
  return _queue;
}

async function processJob(job: JobRequest): Promise<void> {
  setRunStatus(job.runId, "running");
  incCounter("agent_runs_total");
  updateQueueGauges();
  try {
    const ctx = await runGoal(job.goal, { ...(job.options as Record<string, unknown>), tenantId: job.tenantId, runId: job.runId } as never);
    // Persist with tenant scoping
    upsertRun(ctx, job.tenantId);
    // Conversation continuity: record turn back into conversation
    const convoId = (job.options as Record<string, unknown>).conversationId as string | undefined;
    if (convoId) {
      try {
        const { getConversation, recordTurn } = await import("../session/conversation");
        const conv = getConversation(convoId);
        if (conv) recordTurn(conv, ctx);
      } catch (err) {
        logModuleError("pool", "optional", err, "recording conversation turn");
      }
    }
    if (ctx.result?.success) {
      incCounter("agent_runs_success_total");
    } else {
      incCounter("agent_runs_failed_total");
    }
    incCounter("agent_tasks_total", ctx.tasks.length);
    incCounter("agent_replans_total", ctx.replanCount);
    incCounter("agent_llm_calls_total", ctx.usageLedger?.totalLLMInteractions ?? 0);
    setRunStatus(job.runId, "success");
  } catch (error) {
    logModuleError("pool", "critical", error, "processing worker job");
    incCounter("agent_runs_failed_total");
    setRunStatus(job.runId, "failed");
  } finally {
    clearRunStatus(job.runId);
    updateQueueGauges();
  }
}

function updateQueueGauges(): void {
  const q = getQueue();
  setGauge("agent_queue_pending", q.stats.pending);
  setGauge("agent_queue_running", q.stats.running);
  setGauge("agent_queue_concurrency", q.stats.concurrency);
}

export function submitJob(runId: string, goal: string, options: Record<string, unknown> = {}, tenantId = "default"): void {
  const job: JobRequest = {
    runId,
    goal,
    options,
    tenantId,
    submittedAt: new Date().toISOString()
  };
  setRunStatus(runId, "pending");
  // Pre-register event bus so SSE subscribers can connect before worker starts
  ensureBus(runId);
  getQueue().enqueue(job);
  updateQueueGauges();
}
