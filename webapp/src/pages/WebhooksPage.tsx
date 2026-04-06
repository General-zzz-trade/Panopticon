import React, { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../api/client";
import { Modal } from "../components/Modal";

interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
}

const EVENT_OPTIONS = [
  { value: "run.complete", label: "Run Complete" },
  { value: "run.failed", label: "Run Failed" },
  { value: "task.done", label: "Task Done" },
  { value: "schedule.triggered", label: "Schedule Triggered" },
];

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 py-3 px-4 animate-pulse">
      <div className="h-3 w-1/3 bg-gray-200 dark:bg-gray-700 rounded" />
      <div className="h-3 w-32 bg-gray-100 dark:bg-gray-800 rounded" />
      <div className="h-3 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
    </div>
  );
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "--";
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});

  // Create form state
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/webhooks");
      const data = await res.json();
      setWebhooks(data.webhooks ?? []);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load webhooks"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const toggleEvent = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCreate = async () => {
    if (!newUrl.trim() || newEvents.length === 0) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> = {
        url: newUrl,
        events: newEvents,
      };
      if (newSecret.trim()) {
        body.secret = newSecret;
      }
      const res = await apiFetch("/webhooks", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.webhook) {
        setWebhooks((prev) => [data.webhook, ...prev]);
      }
      setShowCreate(false);
      setNewUrl("");
      setNewEvents([]);
      setNewSecret("");
    } catch (err: unknown) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create webhook"
      );
    } finally {
      setCreateLoading(false);
    }
  };

  const handleTest = async (id: string) => {
    setActionLoading(id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await apiFetch(`/webhooks/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          success: data.success !== false,
          message: data.message ?? "Test sent successfully",
        },
      }));
    } catch (err: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          success: false,
          message: err instanceof Error ? err.message : "Test failed",
        },
      }));
    }
    setActionLoading(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this webhook?")) return;
    setActionLoading(id);
    try {
      await apiFetch(`/webhooks/${id}`, { method: "DELETE" });
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {}
    setActionLoading(null);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">Webhooks</h1>
            <p className="text-sm text-gray-500">
              Get notified when events happen in your runs
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            Add Webhook
          </button>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-lg">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && webhooks.length === 0 && !error && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No webhooks configured</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              Add your first webhook
            </button>
          </div>
        )}

        {/* Webhook list */}
        {!loading && webhooks.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[1fr_200px_80px_100px_140px] gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
              <span>URL</span>
              <span>Events</span>
              <span>Status</span>
              <span>Created</span>
              <span>Actions</span>
            </div>

            {webhooks.map((w) => (
              <div key={w.id}>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_80px_100px_140px] gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 items-center text-sm">
                  <div
                    className="truncate text-xs font-mono text-gray-700 dark:text-gray-300"
                    title={w.url}
                  >
                    {w.url}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {w.events.map((ev) => (
                      <span
                        key={ev}
                        className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                  <div>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        w.enabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {w.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {formatDate(w.createdAt)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleTest(w.id)}
                      disabled={actionLoading === w.id}
                      className="px-2 py-1 text-[10px] text-blue-600 border border-blue-200 dark:border-blue-900 rounded hover:bg-blue-50 dark:hover:bg-blue-950 transition disabled:opacity-50"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => handleDelete(w.id)}
                      disabled={actionLoading === w.id}
                      className="px-2 py-1 text-[10px] text-red-600 border border-red-200 dark:border-red-900 rounded hover:bg-red-50 dark:hover:bg-red-950 transition disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Inline test result */}
                {testResults[w.id] && (
                  <div
                    className={`mx-4 mb-2 p-2 text-xs rounded ${
                      testResults[w.id].success
                        ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
                        : "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                    }`}
                  >
                    {testResults[w.id].success ? "Pass" : "Fail"}:{" "}
                    {testResults[w.id].message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create webhook modal */}
      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setCreateError(null);
        }}
        title="Add Webhook"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              URL
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
              Events
            </label>
            <div className="space-y-2">
              {EVENT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={newEvents.includes(opt.value)}
                    onChange={() => toggleEvent(opt.value)}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    {opt.label}
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono">
                    {opt.value}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Secret{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              placeholder="HMAC signing secret"
              className="w-full px-3 py-2 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Used to sign webhook payloads for verification
            </p>
          </div>

          {createError && (
            <div className="p-3 text-xs text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-lg">
              {createError}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={createLoading || !newUrl.trim() || newEvents.length === 0}
            className="w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition"
          >
            {createLoading ? "Creating..." : "Create Webhook"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
