import React, { useEffect, useState, useCallback } from "react";
import { Modal } from "./Modal";

interface HealthData {
  status: string;
  memoryMB?: { heapUsed: number };
  uptimeMs?: number;
}

interface QueueData {
  pending: number;
  running: number;
  concurrency: number;
}

interface RunEntry {
  id: string;
  goal?: string;
  status: string;
  taskCount?: number;
}

interface UsageData {
  runs: number;
  limitRuns: number;
  tokens: number;
  limitTokens: number;
  plan?: string;
}

interface PlanInfo {
  id: string;
  name: string;
  price: string;
  limits: { runs: number; tokens: number };
}

interface FeedbackStats {
  total: number;
  up: number;
  down: number;
}

interface MCPTool {
  name: string;
  description: string;
}

interface DashboardState {
  loading: boolean;
  error: string | null;
  health: HealthData | null;
  queue: QueueData | null;
  runs: RunEntry[];
  usage: UsageData | null;
  plans: PlanInfo[];
  feedbackStats: FeedbackStats | null;
  mcpTools: MCPTool[];
}

const API = "/api/v1";

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function MetricCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-2">
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
      <div className={`text-lg font-semibold ${colorClass || ""}`}>{value}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg h-16 mb-3 bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 animate-pulse" />
  );
}

export function Dashboard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<DashboardState>({
    loading: false,
    error: null,
    health: null,
    queue: null,
    runs: [],
    usage: null,
    plans: [],
    feedbackStats: null,
    mcpTools: [],
  });

  const fetchData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const jwtToken = localStorage.getItem("jwtToken");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (jwtToken) {
      headers["Authorization"] = `Bearer ${jwtToken}`;
    }

    try {
      const [healthRes, queueRes, runsRes, usageRes, plansRes, feedbackRes, mcpRes] = await Promise.all([
        fetch("/health")
          .then((r) => r.json() as Promise<HealthData>)
          .catch(() => null),
        fetch(`${API}/queue/stats`, { headers })
          .then((r) => r.json() as Promise<QueueData>)
          .catch(() => null),
        fetch(`${API}/runs?limit=20`, { headers })
          .then((r) => r.json() as Promise<{ runs: RunEntry[] }>)
          .catch(() => null),
        jwtToken
          ? fetch(`${API}/billing/usage`, { headers })
              .then((r) => (r.ok ? (r.json() as Promise<UsageData>) : null))
              .catch(() => null)
          : Promise.resolve(null),
        fetch(`${API}/billing/plans`, { headers })
          .then((r) => r.ok ? r.json() as Promise<{ plans: PlanInfo[] }> : null)
          .catch(() => null),
        fetch(`${API}/feedback/stats`, { headers })
          .then((r) => r.ok ? r.json() as Promise<FeedbackStats> : null)
          .catch(() => null),
        fetch(`${API}/mcp/tools`, { headers })
          .then((r) => r.ok ? r.json() as Promise<{ tools: MCPTool[] }> : null)
          .catch(() => null),
      ]);

      setState({
        loading: false,
        error: null,
        health: healthRes,
        queue: queueRes,
        runs: runsRes?.runs || [],
        usage: usageRes,
        plans: plansRes?.plans || [],
        feedbackStats: feedbackRes,
        mcpTools: mcpRes?.tools || [],
      });
    } catch (err: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load dashboard",
      }));
    }
  }, []);

  // Fetch data when modal opens
  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  const { loading, error, health, queue, runs, usage, plans, feedbackStats, mcpTools } = state;

  const successCount = runs.filter((r) => r.status === "success").length;
  const successPct =
    runs.length > 0 ? ((successCount * 100) / runs.length).toFixed(0) : "0";

  return (
    <Modal open={open} onClose={onClose} title="Dashboard" maxWidth="max-w-2xl">
      <div className="text-sm space-y-4">
        {/* Loading skeleton */}
        {loading && (
          <div>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <p className="text-red-500 text-xs">Error: {error}</p>
        )}

        {/* Health section */}
        {!loading && health && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Health
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard
                label="Status"
                value={health.status}
                colorClass={
                  health.status === "ok" ? "text-green-600" : "text-red-600"
                }
              />
              <MetricCard
                label="Heap"
                value={`${health.memoryMB?.heapUsed ?? 0}MB`}
              />
              <MetricCard
                label="Uptime"
                value={formatUptime(health.uptimeMs || 0)}
              />
            </div>
          </div>
        )}

        {/* Usage section (JWT only) */}
        {!loading && usage && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Usage
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard
                label="Runs"
                value={`${usage.runs}/${usage.limitRuns}`}
              />
              <MetricCard
                label="Tokens"
                value={`${usage.tokens}/${usage.limitTokens}`}
              />
              <MetricCard label="Plan" value={usage.plan || "free"} />
            </div>
          </div>
        )}

        {/* Queue section */}
        {!loading && queue && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Queue
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="Pending" value={String(queue.pending)} />
              <MetricCard label="Running" value={String(queue.running)} />
              <MetricCard label="Workers" value={String(queue.concurrency)} />
            </div>
          </div>
        )}

        {/* Recent runs */}
        {!loading && runs.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Runs
            </div>
            <div className="text-xs text-gray-500 mb-2">
              {runs.length} recent &middot; {successCount} success &middot;{" "}
              {successPct}%
            </div>
            <div className="space-y-0">
              {runs.slice(0, 8).map((run) => (
                <div
                  key={run.id}
                  className="flex gap-2 items-center text-xs py-1 border-b border-gray-100 dark:border-gray-800"
                >
                  <span
                    className={
                      run.status === "success"
                        ? "text-green-600"
                        : run.status === "failed"
                        ? "text-red-600"
                        : "text-gray-400"
                    }
                  >
                    {run.status === "success"
                      ? "\u2713"
                      : run.status === "failed"
                      ? "\u2717"
                      : "\u25CB"}
                  </span>
                  <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                    {run.goal || ""}
                  </span>
                  <span className="text-gray-400">
                    {run.taskCount || 0}t
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Billing Plans */}
        {!loading && plans.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Plans</div>
            <div className="grid grid-cols-3 gap-2">
              {plans.map((p) => (
                <div key={p.id} className={`border rounded-lg p-3 text-center ${usage?.plan === p.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20' : 'border-gray-200 dark:border-gray-800'}`}>
                  <div className="font-semibold text-sm">{p.name}</div>
                  <div className="text-lg font-bold mt-1">{p.price}</div>
                  <div className="text-[10px] text-gray-500 mt-1">{p.limits?.runs || '?'} runs/mo</div>
                  {usage?.plan !== p.id && p.id !== 'free' && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`${API}/billing/upgrade`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('jwtToken') ? { Authorization: `Bearer ${localStorage.getItem('jwtToken')}` } : {}) }, body: JSON.stringify({ plan: p.id }) });
                          const data = await res.json();
                          if (data.checkoutUrl) window.open(data.checkoutUrl, '_blank');
                        } catch {}
                      }}
                      className="mt-2 px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Upgrade
                    </button>
                  )}
                  {usage?.plan === p.id && <div className="mt-2 text-xs text-blue-600 font-medium">Current</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feedback Stats */}
        {!loading && feedbackStats && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Feedback</div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="Total" value={String(feedbackStats.total)} />
              <MetricCard label="Positive" value={String(feedbackStats.up)} colorClass="text-green-600" />
              <MetricCard label="Negative" value={String(feedbackStats.down)} colorClass="text-red-600" />
            </div>
          </div>
        )}

        {/* MCP Tools */}
        {!loading && mcpTools.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">MCP Tools ({mcpTools.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {mcpTools.map((tool) => (
                <span key={tool.name} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg" title={tool.description}>
                  {tool.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !health && !queue && runs.length === 0 && (
          <p className="text-xs text-gray-400">No data available</p>
        )}
      </div>
    </Modal>
  );
}
