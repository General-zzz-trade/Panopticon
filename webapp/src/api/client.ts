import type { Conversation } from '../types';

export const API = '/api/v1';

// ── Helper ────────────────────────────────────────────────────

interface ApiFetchOptions extends RequestInit {
  token?: string;
  apiKey?: string;
}

function getStoredToken(): string | null {
  try {
    return localStorage.getItem('jwtToken');
  } catch {
    return null;
  }
}

function getStoredApiKey(): string | null {
  try {
    const settings = localStorage.getItem('agentSettings');
    if (!settings) return null;
    return JSON.parse(settings).apiKey || null;
  } catch {
    return null;
  }
}

export async function apiFetch(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<Response> {
  const { token, apiKey, headers: extraHeaders, ...rest } = opts;

  const headers = new Headers(extraHeaders as HeadersInit);

  // Content-Type default for non-GET with body
  if (rest.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Auth: explicit token > stored JWT
  const jwt = token ?? getStoredToken();
  if (jwt) {
    headers.set('Authorization', `Bearer ${jwt}`);
  }

  // API key: explicit > stored
  const key = apiKey ?? getStoredApiKey();
  if (key) {
    headers.set('X-API-Key', key);
  }

  const url = path.startsWith('http') ? path : `${API}${path}`;

  const res = await fetch(url, { ...rest, headers });

  if (!res.ok && res.status !== 202 && res.status !== 201) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res;
}

// ── Chat ──────────────────────────────────────────────────────

export async function sendChat(
  message: string,
  convoId?: string,
  options?: Record<string, unknown>,
): Promise<Response> {
  return apiFetch('/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      conversationId: convoId,
      options,
    }),
  });
}

// ── Conversations ─────────────────────────────────────────────

export async function createConversation(): Promise<{ id: string }> {
  const res = await apiFetch('/conversations', { method: 'POST' });
  return res.json();
}

export async function listConversations(): Promise<{ conversations: Conversation[] }> {
  const res = await apiFetch('/conversations');
  return res.json();
}

export async function getConversation(
  id: string,
): Promise<{ id: string; turns: any[]; summary: string }> {
  const res = await apiFetch(`/conversations/${id}`);
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  await apiFetch(`/conversations/${id}`, { method: 'DELETE' });
}

export async function forkConversation(
  id: string,
  turnIndex: number,
): Promise<{ id: string }> {
  const res = await apiFetch(`/conversations/${id}/fork`, {
    method: 'POST',
    body: JSON.stringify({ fromTurnIndex: turnIndex }),
  });
  return res.json();
}

// ── Runs ──────────────────────────────────────────────────────

export async function getRunStatus(id: string): Promise<{ status: string }> {
  const res = await apiFetch(`/runs/${id}/status`);
  return res.json();
}

export async function getRun(id: string): Promise<any> {
  const res = await apiFetch(`/runs/${id}`);
  return res.json();
}

export async function cancelRun(id: string): Promise<void> {
  await apiFetch(`/runs/${id}/cancel`, { method: 'POST' });
}

export function connectSSE(runId: string, lastSeq?: number): EventSource {
  const params = lastSeq ? `?lastEventId=${lastSeq}` : '';
  return new EventSource(`${API}/runs/${runId}/stream${params}`);
}

// ── Feedback ──────────────────────────────────────────────────

export async function sendFeedback(
  runId: string,
  rating: 'up' | 'down',
): Promise<void> {
  await apiFetch('/feedback', {
    method: 'POST',
    body: JSON.stringify({ runId, messageIndex: 0, rating }),
  });
}

// ── Auth ──────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: any }> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<{ token: string; user: any }> {
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
  return res.json();
}

// ── Templates ─────────────────────────────────────────────────

export async function listTemplates(): Promise<{ templates: any[] }> {
  const res = await apiFetch('/templates');
  return res.json();
}

// ── Auth (additional) ────────────────────────────────────────

export async function getMe(): Promise<{ user: any; usage: any }> {
  const res = await apiFetch('/auth/me');
  return res.json();
}

export async function refreshToken(): Promise<{ token: string }> {
  const res = await apiFetch('/auth/refresh', { method: 'POST' });
  return res.json();
}

// ── Billing (additional) ────────────────────────────────────

export async function getBillingPlans(): Promise<{ plans: any[] }> {
  const res = await apiFetch('/billing/plans');
  return res.json();
}

export async function upgradePlan(plan: string): Promise<{ checkoutUrl: string; message: string }> {
  const res = await apiFetch('/billing/upgrade', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
  return res.json();
}

// ── Feedback (additional) ───────────────────────────────────

export async function getFeedbackStats(): Promise<{ total: number; up: number; down: number; recent: any[] }> {
  const res = await apiFetch('/feedback/stats');
  return res.json();
}

// ── MCP ─────────────────────────────────────────────────────

export async function getMCPTools(): Promise<{ tools: any[] }> {
  const res = await apiFetch('/mcp/tools');
  return res.json();
}

export async function executeMCPTool(toolName: string, params: Record<string, unknown>): Promise<any> {
  const res = await apiFetch('/mcp/execute', {
    method: 'POST',
    body: JSON.stringify({ toolName, params }),
  });
  return res.json();
}

// ── Health ────────────────────────────────────────────────────

export async function checkHealth(): Promise<{
  status: string;
  memoryMB?: { heapUsed: number };
}> {
  const res = await fetch('/health');
  return res.json();
}
