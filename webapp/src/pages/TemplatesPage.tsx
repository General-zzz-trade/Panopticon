import React, { useEffect, useState, useCallback, useMemo } from "react";
import { apiFetch } from "../api/client";
import { Modal } from "../components/Modal";

interface TemplateVariable {
  name: string;
  description: string;
  default?: string;
}

interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  goal: string;
  variables: TemplateVariable[];
  popularity: number;
}

const CATEGORIES = [
  "All",
  "Scraping",
  "Monitoring",
  "Automation",
  "Research",
  "Testing",
];

const CATEGORY_COLORS: Record<string, string> = {
  Scraping: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  Monitoring:
    "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  Automation:
    "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  Research:
    "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  Testing: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse">
      <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
      <div className="h-3 w-full bg-gray-100 dark:bg-gray-800 rounded mb-2" />
      <div className="h-3 w-3/4 bg-gray-100 dark:bg-gray-800 rounded mb-4" />
      <div className="flex items-center justify-between">
        <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800 rounded-full" />
        <div className="h-3 w-10 bg-gray-100 dark:bg-gray-800 rounded" />
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Template | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [runStatus, setRunStatus] = useState<{
    loading: boolean;
    result: string | null;
    error: string | null;
  }>({ loading: false, result: null, error: null });

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/templates");
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filtered = useMemo(() => {
    let list = templates;
    if (category !== "All") {
      list = list.filter(
        (t) => t.category.toLowerCase() === category.toLowerCase()
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [templates, category, search]);

  const openTemplate = (t: Template) => {
    setSelected(t);
    const defaults: Record<string, string> = {};
    for (const v of t.variables) {
      defaults[v.name] = v.default ?? "";
    }
    setVariables(defaults);
    setRunStatus({ loading: false, result: null, error: null });
  };

  const closeModal = () => {
    setSelected(null);
    setVariables({});
    setRunStatus({ loading: false, result: null, error: null });
  };

  const runTemplate = async () => {
    if (!selected) return;
    setRunStatus({ loading: true, result: null, error: null });
    try {
      const res = await apiFetch(`/templates/${selected.id}/run`, {
        method: "POST",
        body: JSON.stringify({ variables }),
      });
      const data = await res.json();
      setRunStatus({
        loading: false,
        result: data.runId
          ? `Run started: ${data.runId}`
          : JSON.stringify(data),
        error: null,
      });
    } catch (err: unknown) {
      setRunStatus({
        loading: false,
        result: null,
        error: err instanceof Error ? err.message : "Run failed",
      });
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">Templates</h1>
          <p className="text-sm text-gray-500">
            Browse and run pre-built automation templates
          </p>
        </div>

        {/* Search + Category filters */}
        <div className="mb-6 space-y-4">
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition ${
                  category === cat
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="mb-6 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-lg">
            {error}
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No templates found</p>
            {(search || category !== "All") && (
              <button
                onClick={() => {
                  setSearch("");
                  setCategory("All");
                }}
                className="mt-2 text-xs text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Template grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => openTemplate(t)}
                className="text-left rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:border-gray-400 dark:hover:border-gray-600 hover:shadow-md transition group"
              >
                <h3 className="font-semibold text-sm mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                  {t.name}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">
                  {t.description}
                </p>
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      CATEGORY_COLORS[t.category] ??
                      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}
                  >
                    {t.category}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {t.popularity} uses
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Template detail modal */}
      <Modal
        open={!!selected}
        onClose={closeModal}
        title={selected?.name ?? ""}
        maxWidth="max-w-lg"
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <p className="text-gray-600 dark:text-gray-400">
              {selected.description}
            </p>

            <div>
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  CATEGORY_COLORS[selected.category] ??
                  "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                }`}
              >
                {selected.category}
              </span>
              <span className="ml-2 text-xs text-gray-400">
                {selected.popularity} uses
              </span>
            </div>

            {selected.goal && (
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Goal
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 p-2 rounded">
                  {selected.goal}
                </p>
              </div>
            )}

            {selected.variables.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Variables
                </div>
                <div className="space-y-3">
                  {selected.variables.map((v) => (
                    <div key={v.name}>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {v.name}
                        {v.description && (
                          <span className="font-normal text-gray-400 ml-1">
                            — {v.description}
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={variables[v.name] ?? ""}
                        onChange={(e) =>
                          setVariables((prev) => ({
                            ...prev,
                            [v.name]: e.target.value,
                          }))
                        }
                        placeholder={v.default ?? ""}
                        className="w-full px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Run button */}
            <button
              onClick={runTemplate}
              disabled={runStatus.loading}
              className="w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition"
            >
              {runStatus.loading ? "Running..." : "Run Template"}
            </button>

            {/* Run result */}
            {runStatus.result && (
              <div className="p-3 text-xs text-green-700 bg-green-50 dark:bg-green-950 dark:text-green-400 rounded-lg">
                {runStatus.result}
              </div>
            )}
            {runStatus.error && (
              <div className="p-3 text-xs text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-lg">
                {runStatus.error}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
