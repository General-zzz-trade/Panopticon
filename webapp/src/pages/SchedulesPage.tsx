import React, { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../api/client";
import { Modal } from "../components/Modal";

interface Schedule {
  id: string;
  goal: string;
  name?: string;
  cron: string;
  mode: string;
  status: "active" | "paused";
  lastRun?: string;
  nextRun?: string;
}

interface HistoryEntry {
  id: string;
  scheduleId: string;
  goal?: string;
  status: string;
  startedAt: string;
  durationMs?: number;
}

type Tab = "schedules" | "history";

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at 9am", value: "0 9 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Weekly (Mon 9am)", value: "0 9 * * 1" },
  { label: "Custom", value: "" },
];

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 py-3 px-4 animate-pulse">
      <div className="h-3 w-1/3 bg-gray-200 dark:bg-gray-700 rounded" />
      <div className="h-3 w-24 bg-gray-100 dark:bg-gray-800 rounded" />
      <div className="h-3 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
      <div className="h-3 w-20 bg-gray-100 dark:bg-gray-800 rounded" />
    </div>
  );
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "--";
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("schedules");
  const [showCreate, setShowCreate] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create form state
  const [newGoal, setNewGoal] = useState("");
  const [newCron, setNewCron] = useState("0 9 * * *");
  const [cronPreset, setCronPreset] = useState("0 9 * * *");
  const [newMode, setNewMode] = useState("auto");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/schedules");
      const data = await res.json();
      setSchedules(data.schedules ?? []);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load schedules"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await apiFetch("/schedules/history");
      const data = await res.json();
      setHistory(data.history ?? []);
    } catch {
      // silently fail for history tab
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  useEffect(() => {
    if (tab === "history") {
      fetchHistory();
    }
  }, [tab, fetchHistory]);

  const handlePause = async (id: string) => {
    setActionLoading(id);
    try {
      await apiFetch(`/schedules/${id}/pause`, { method: "POST" });
      setSchedules((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "paused" } : s))
      );
    } catch {}
    setActionLoading(null);
  };

  const handleResume = async (id: string) => {
    setActionLoading(id);
    try {
      await apiFetch(`/schedules/${id}/resume`, { method: "POST" });
      setSchedules((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "active" } : s))
      );
    } catch {}
    setActionLoading(null);
  };

  const handleRunNow = async (id: string) => {
    setActionLoading(id);
    try {
      await apiFetch(`/schedules/${id}/run-now`, { method: "POST" });
    } catch {}
    setActionLoading(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this schedule?")) return;
    setActionLoading(id);
    try {
      await apiFetch(`/schedules/${id}`, { method: "DELETE" });
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch {}
    setActionLoading(null);
  };

  const handleCreate = async () => {
    if (!newGoal.trim()) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await apiFetch("/schedules", {
        method: "POST",
        body: JSON.stringify({
          goal: newGoal,
          cron: newCron,
          mode: newMode,
        }),
      });
      const data = await res.json();
      if (data.schedule) {
        setSchedules((prev) => [data.schedule, ...prev]);
      }
      setShowCreate(false);
      setNewGoal("");
      setNewCron("0 9 * * *");
      setCronPreset("0 9 * * *");
      setNewMode("auto");
    } catch (err: unknown) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create schedule"
      );
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">Schedules</h1>
            <p className="text-sm text-gray-500">
              Manage recurring automated tasks
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            New Schedule
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-800">
          <button
            onClick={() => setTab("schedules")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === "schedules"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Schedules
          </button>
          <button
            onClick={() => setTab("history")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === "history"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            History
          </button>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-lg">
            {error}
          </div>
        )}

        {/* Schedules tab */}
        {tab === "schedules" && (
          <>
            {loading && (
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            )}

            {!loading && schedules.length === 0 && (
              <div className="text-center py-16">
                <p className="text-gray-400 text-sm">No schedules yet</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-2 text-xs text-blue-600 hover:underline"
                >
                  Create your first schedule
                </button>
              </div>
            )}

            {!loading && schedules.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                {/* Table header */}
                <div className="hidden md:grid grid-cols-[1fr_120px_80px_120px_120px_160px] gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  <span>Goal</span>
                  <span>Cron</span>
                  <span>Status</span>
                  <span>Last Run</span>
                  <span>Next Run</span>
                  <span>Actions</span>
                </div>

                {schedules.map((s) => (
                  <div
                    key={s.id}
                    className="grid grid-cols-1 md:grid-cols-[1fr_120px_80px_120px_120px_160px] gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 items-center text-sm"
                  >
                    <div className="truncate font-medium text-xs">
                      {s.name || s.goal}
                    </div>
                    <div className="text-xs text-gray-500 font-mono">
                      {s.cron}
                    </div>
                    <div>
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          s.status === "active"
                            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {formatDate(s.lastRun)}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {formatDate(s.nextRun)}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {s.status === "active" ? (
                        <button
                          onClick={() => handlePause(s.id)}
                          disabled={actionLoading === s.id}
                          className="px-2 py-1 text-[10px] border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
                        >
                          Pause
                        </button>
                      ) : (
                        <button
                          onClick={() => handleResume(s.id)}
                          disabled={actionLoading === s.id}
                          className="px-2 py-1 text-[10px] border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
                        >
                          Resume
                        </button>
                      )}
                      <button
                        onClick={() => handleRunNow(s.id)}
                        disabled={actionLoading === s.id}
                        className="px-2 py-1 text-[10px] text-blue-600 border border-blue-200 dark:border-blue-900 rounded hover:bg-blue-50 dark:hover:bg-blue-950 transition disabled:opacity-50"
                      >
                        Run
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={actionLoading === s.id}
                        className="px-2 py-1 text-[10px] text-red-600 border border-red-200 dark:border-red-900 rounded hover:bg-red-50 dark:hover:bg-red-950 transition disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* History tab */}
        {tab === "history" && (
          <>
            {history.length === 0 && (
              <div className="text-center py-16">
                <p className="text-gray-400 text-sm">No execution history</p>
              </div>
            )}

            {history.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <div className="hidden md:grid grid-cols-[1fr_100px_140px_80px] gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  <span>Goal / Schedule</span>
                  <span>Status</span>
                  <span>Started</span>
                  <span>Duration</span>
                </div>

                {history.map((h) => (
                  <div
                    key={h.id}
                    className="grid grid-cols-1 md:grid-cols-[1fr_100px_140px_80px] gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 items-center text-sm"
                  >
                    <div className="truncate text-xs">
                      {h.goal || h.scheduleId}
                    </div>
                    <div>
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          h.status === "success"
                            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                            : h.status === "failed"
                            ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {h.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {formatDate(h.startedAt)}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {h.durationMs != null
                        ? `${(h.durationMs / 1000).toFixed(1)}s`
                        : "--"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create schedule modal */}
      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setCreateError(null);
        }}
        title="New Schedule"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Goal
            </label>
            <textarea
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              rows={3}
              placeholder="Describe what the agent should do..."
              className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Schedule
            </label>
            <select
              value={cronPreset}
              onChange={(e) => {
                setCronPreset(e.target.value);
                if (e.target.value) setNewCron(e.target.value);
              }}
              className="w-full mb-2 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CRON_PRESETS.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                  {p.value ? ` (${p.value})` : ""}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newCron}
              onChange={(e) => {
                setNewCron(e.target.value);
                setCronPreset("");
              }}
              placeholder="Cron expression"
              className="w-full px-3 py-1.5 text-xs font-mono border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Mode
            </label>
            <select
              value={newMode}
              onChange={(e) => setNewMode(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="auto">Auto</option>
              <option value="sequential">Sequential</option>
              <option value="react">ReAct</option>
              <option value="cli">CLI</option>
            </select>
          </div>

          {createError && (
            <div className="p-3 text-xs text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-lg">
              {createError}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={createLoading || !newGoal.trim()}
            className="w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition"
          >
            {createLoading ? "Creating..." : "Create Schedule"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
