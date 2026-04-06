import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api/client';

/* ── Types ────────────────────────────────────────────────── */

interface WorkflowStep {
  id: string;
  type: 'task' | 'condition' | 'loop' | 'parallel' | 'wait';
  task?: { type: string; payload: Record<string, unknown> };
  condition?: { expression: string; thenSteps: string[]; elseSteps: string[] };
  loop?: { times: number; steps: string[] };
  parallel?: { steps: string[][] };
  next?: string;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  variables: Record<string, unknown>;
}

type Panel = 'list' | 'create' | 'detail';

const TASK_TYPES = [
  'click', 'type', 'open_page', 'http_request', 'run_code',
  'assert_text', 'scroll', 'select_option', 'hover', 'wait_for',
  'screenshot', 'file_read', 'file_write', 'shell',
];

const STEP_TYPES: WorkflowStep['type'][] = ['task', 'condition', 'loop', 'parallel', 'wait'];

/* ── Helpers ──────────────────────────────────────────────── */

function uid(): string {
  return 'step_' + Math.random().toString(36).slice(2, 10);
}

function emptyStep(type: WorkflowStep['type']): WorkflowStep {
  const id = uid();
  switch (type) {
    case 'task':
      return { id, type, task: { type: 'click', payload: {} } };
    case 'condition':
      return { id, type, condition: { expression: '', thenSteps: [], elseSteps: [] } };
    case 'loop':
      return { id, type, loop: { times: 1, steps: [] } };
    case 'parallel':
      return { id, type, parallel: { steps: [[]] } };
    case 'wait':
      return { id, type };
  }
}

/* ── Step Editor Card ─────────────────────────────────────── */

function StepCard({
  step,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  step: WorkflowStep;
  index: number;
  total: number;
  onChange: (s: WorkflowStep) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [payloadText, setPayloadText] = useState(
    step.task ? JSON.stringify(step.task.payload, null, 2) : '{}',
  );

  const typeColors: Record<string, string> = {
    task: 'border-blue-400 dark:border-blue-600',
    condition: 'border-amber-400 dark:border-amber-600',
    loop: 'border-purple-400 dark:border-purple-600',
    parallel: 'border-green-400 dark:border-green-600',
    wait: 'border-gray-400 dark:border-gray-600',
  };

  return (
    <div className={`border-l-4 ${typeColors[step.type] || ''} bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 space-y-2`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-mono w-6">#{index + 1}</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{step.type}</span>
          <span className="text-[10px] text-gray-400 font-mono">{step.id}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition"
            title="Move up"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg>
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition"
            title="Move down"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/></svg>
          </button>
          <button
            onClick={onRemove}
            className="p-1 text-red-400 hover:text-red-600 transition"
            title="Remove step"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {/* Task fields */}
      {step.type === 'task' && step.task && (
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-gray-500 uppercase">Task Type</label>
            <select
              value={step.task.type}
              onChange={(e) => onChange({ ...step, task: { ...step.task!, type: e.target.value } })}
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase">Payload (JSON)</label>
            <textarea
              value={payloadText}
              onChange={(e) => {
                setPayloadText(e.target.value);
                try {
                  const parsed = JSON.parse(e.target.value);
                  onChange({ ...step, task: { ...step.task!, payload: parsed } });
                } catch { /* wait for valid JSON */ }
              }}
              rows={3}
              className="w-full text-xs font-mono border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
            />
          </div>
        </div>
      )}

      {/* Condition fields */}
      {step.type === 'condition' && step.condition && (
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-gray-500 uppercase">Expression</label>
            <input
              type="text"
              value={step.condition.expression}
              onChange={(e) => onChange({ ...step, condition: { ...step.condition!, expression: e.target.value } })}
              placeholder="e.g. status === 200"
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Then Steps (IDs, comma-sep)</label>
              <input
                type="text"
                value={step.condition.thenSteps.join(', ')}
                onChange={(e) => onChange({ ...step, condition: { ...step.condition!, thenSteps: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
                className="w-full text-xs font-mono border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Else Steps (IDs, comma-sep)</label>
              <input
                type="text"
                value={step.condition.elseSteps.join(', ')}
                onChange={(e) => onChange({ ...step, condition: { ...step.condition!, elseSteps: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
                className="w-full text-xs font-mono border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Loop fields */}
      {step.type === 'loop' && step.loop && (
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-gray-500 uppercase">Iterations</label>
            <input
              type="number"
              min={1}
              value={step.loop.times}
              onChange={(e) => onChange({ ...step, loop: { ...step.loop!, times: Math.max(1, parseInt(e.target.value) || 1) } })}
              className="w-24 text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase">Loop Step IDs (comma-sep)</label>
            <input
              type="text"
              value={step.loop.steps.join(', ')}
              onChange={(e) => onChange({ ...step, loop: { ...step.loop!, steps: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
              className="w-full text-xs font-mono border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      )}

      {/* Parallel fields */}
      {step.type === 'parallel' && step.parallel && (
        <div className="space-y-2">
          <label className="text-[10px] text-gray-500 uppercase">Parallel Groups (one group per line, IDs comma-sep)</label>
          <textarea
            value={step.parallel.steps.map(g => g.join(', ')).join('\n')}
            onChange={(e) => {
              const groups = e.target.value.split('\n').map(line => line.split(',').map(s => s.trim()).filter(Boolean));
              onChange({ ...step, parallel: { steps: groups } });
            }}
            rows={3}
            placeholder="step_a1, step_a2&#10;step_b1, step_b2"
            className="w-full text-xs font-mono border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
          />
        </div>
      )}

      {/* Wait — no extra fields */}
      {step.type === 'wait' && (
        <p className="text-xs text-gray-400 italic">This step pauses execution until the previous step completes.</p>
      )}
    </div>
  );
}

/* ── WorkflowsPage ────────────────────────────────────────── */

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formSteps, setFormSteps] = useState<WorkflowStep[]>([]);
  const [saving, setSaving] = useState(false);

  // Run state
  const [runVars, setRunVars] = useState('{}');
  const [runResult, setRunResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  /* ── Fetch ────────────────────────────────────────────────── */

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/workflows');
      const data = await res.json();
      setWorkflows(data.workflows ?? data ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  /* ── CRUD ─────────────────────────────────────────────────── */

  const handleCreate = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: formName.trim(),
          description: formDesc.trim(),
          steps: formSteps,
          variables: {},
        }),
      });
      setFormName('');
      setFormDesc('');
      setFormSteps([]);
      setPanel('list');
      await fetchWorkflows();
    } catch (e: any) {
      setError(e.message || 'Failed to create workflow');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this workflow?')) return;
    try {
      await apiFetch(`/workflows/${id}`, { method: 'DELETE' });
      if (selectedId === id) {
        setSelectedId(null);
        setPanel('list');
      }
      await fetchWorkflows();
    } catch (e: any) {
      setError(e.message || 'Failed to delete workflow');
    }
  };

  const handleRun = async (id: string) => {
    setRunning(true);
    setRunResult(null);
    try {
      let variables = {};
      try { variables = JSON.parse(runVars); } catch { /* ignore parse errors */ }
      const res = await apiFetch(`/workflows/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ variables }),
      });
      const data = await res.json();
      setRunResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setRunResult(`Error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  /* ── Step management ──────────────────────────────────────── */

  const addStep = (type: WorkflowStep['type']) => {
    setFormSteps((prev) => [...prev, emptyStep(type)]);
  };

  const updateStep = (index: number, step: WorkflowStep) => {
    setFormSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  };

  const removeStep = (index: number) => {
    setFormSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= formSteps.length) return;
    setFormSteps((prev) => {
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  /* ── Selected workflow ────────────────────────────────────── */

  const selected = workflows.find((w) => w.id === selectedId) ?? null;

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Workflows</h1>
            <p className="text-sm text-gray-500 mt-0.5">Build and run multi-step automation workflows</p>
          </div>
          <div className="flex items-center gap-2">
            {panel !== 'list' && (
              <button
                onClick={() => { setPanel('list'); setSelectedId(null); setRunResult(null); }}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Back to list
              </button>
            )}
            {panel === 'list' && (
              <button
                onClick={() => { setPanel('create'); setFormName(''); setFormDesc(''); setFormSteps([]); }}
                className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                + Create Workflow
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ── List panel ────────────────────────────────────── */}
        {panel === 'list' && (
          <>
            {loading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 rounded-lg bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 animate-pulse" />
                ))}
              </div>
            )}

            {!loading && workflows.length === 0 && (
              <div className="text-center py-16">
                <div className="text-4xl mb-3 opacity-30">
                  <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z M3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z M13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z M13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"/></svg>
                </div>
                <p className="text-gray-500 mb-4">No workflows yet</p>
                <button
                  onClick={() => setPanel('create')}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Create your first workflow
                </button>
              </div>
            )}

            {!loading && workflows.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {workflows.map((w) => (
                  <div
                    key={w.id}
                    className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 bg-white dark:bg-gray-900 hover:border-blue-400 dark:hover:border-blue-600 transition cursor-pointer group"
                    onClick={() => { setSelectedId(w.id); setPanel('detail'); setRunResult(null); setRunVars('{}'); }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{w.name}</h3>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{w.description || 'No description'}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(w.id); }}
                        className="p-1 text-gray-300 dark:text-gray-700 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">
                        {w.steps?.length ?? 0} step{(w.steps?.length ?? 0) !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">{w.id.slice(0, 8)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Create panel ──────────────────────────────────── */}
        {panel === 'create' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-4">Create Workflow</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="My Automation"
                    className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="What does this workflow do?"
                    rows={2}
                    className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  />
                </div>
              </div>
            </div>

            {/* Steps builder */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Steps ({formSteps.length})
                </h3>
                <div className="flex items-center gap-1">
                  {STEP_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => addStep(t)}
                      className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition capitalize"
                    >
                      + {t}
                    </button>
                  ))}
                </div>
              </div>

              {formSteps.length === 0 && (
                <div className="border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-lg py-8 text-center text-sm text-gray-400">
                  Add steps using the buttons above
                </div>
              )}

              <div className="space-y-3">
                {formSteps.map((step, i) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    index={i}
                    total={formSteps.length}
                    onChange={(s) => updateStep(i, s)}
                    onRemove={() => removeStep(i)}
                    onMoveUp={() => moveStep(i, -1)}
                    onMoveDown={() => moveStep(i, 1)}
                  />
                ))}
              </div>
            </div>

            {/* Save */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleCreate}
                disabled={saving || !formName.trim()}
                className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {saving ? 'Saving...' : 'Save Workflow'}
              </button>
              <button
                onClick={() => setPanel('list')}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Detail panel ──────────────────────────────────── */}
        {panel === 'detail' && selected && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <p className="text-sm text-gray-500 mt-1">{selected.description || 'No description'}</p>
              <span className="text-[10px] text-gray-400 font-mono">ID: {selected.id}</span>
            </div>

            {/* Steps list (read-only) */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Steps ({selected.steps?.length ?? 0})
              </h3>
              {(!selected.steps || selected.steps.length === 0) ? (
                <p className="text-sm text-gray-400">No steps defined.</p>
              ) : (
                <div className="space-y-2">
                  {selected.steps.map((step, i) => (
                    <div
                      key={step.id}
                      className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 bg-white dark:bg-gray-900"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-mono w-6">#{i + 1}</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{step.type}</span>
                        <span className="text-[10px] text-gray-400 font-mono">{step.id}</span>
                      </div>
                      {step.type === 'task' && step.task && (
                        <div className="mt-1 text-sm">
                          <span className="text-blue-600 dark:text-blue-400 font-mono text-xs">{step.task.type}</span>
                          {Object.keys(step.task.payload).length > 0 && (
                            <pre className="mt-1 text-[11px] text-gray-500 bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-x-auto">
                              {JSON.stringify(step.task.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                      {step.type === 'condition' && step.condition && (
                        <div className="mt-1 text-xs text-gray-500 font-mono">
                          if ({step.condition.expression}) then [{step.condition.thenSteps.join(', ')}] else [{step.condition.elseSteps.join(', ')}]
                        </div>
                      )}
                      {step.type === 'loop' && step.loop && (
                        <div className="mt-1 text-xs text-gray-500 font-mono">
                          repeat {step.loop.times}x: [{step.loop.steps.join(', ')}]
                        </div>
                      )}
                      {step.type === 'parallel' && step.parallel && (
                        <div className="mt-1 text-xs text-gray-500 font-mono">
                          {step.parallel.steps.length} parallel group(s)
                        </div>
                      )}
                      {step.type === 'wait' && (
                        <div className="mt-1 text-xs text-gray-400 italic">Wait step</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Run */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 bg-white dark:bg-gray-900 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Run Workflow</h3>
              <div>
                <label className="text-[10px] text-gray-500 uppercase">Variables (JSON)</label>
                <textarea
                  value={runVars}
                  onChange={(e) => setRunVars(e.target.value)}
                  rows={2}
                  className="w-full text-xs font-mono border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
                />
              </div>
              <button
                onClick={() => handleRun(selected.id)}
                disabled={running}
                className="px-4 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
              >
                {running ? 'Running...' : 'Run'}
              </button>
              {runResult && (
                <pre className="text-xs font-mono bg-gray-50 dark:bg-gray-800 rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
                  {runResult}
                </pre>
              )}
            </div>

            {/* Delete */}
            <div className="pt-2">
              <button
                onClick={() => handleDelete(selected.id)}
                className="px-4 py-1.5 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition"
              >
                Delete Workflow
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkflowsPage;
