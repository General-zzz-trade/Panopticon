/**
 * OSINT Shared Utilities — cache, retry, rate limiting, error handling
 */

// ── Result Cache (TTL-based, shared across modules) ─────

const _cache = new Map<string, { data: any; expiry: number }>();

export function cacheGet<T>(key: string): T | null {
  const entry = _cache.get(key);
  if (!entry || Date.now() > entry.expiry) { _cache.delete(key); return null; }
  return entry.data;
}

export function cacheSet(key: string, data: any, ttlMs = 300000): void {
  _cache.set(key, { data, expiry: Date.now() + ttlMs });
  if (_cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _cache) { if (now > v.expiry) _cache.delete(k); }
  }
}

export function cacheStats(): { size: number; keys: string[] } {
  return { size: _cache.size, keys: Array.from(_cache.keys()) };
}

export function cacheClear(): void {
  _cache.clear();
}

// ── Fetch with Retry + Timeout ──────────────────────────

export async function fetchRetry(
  url: string,
  options: { timeoutMs?: number; retries?: number; method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<Response | null> {
  const { retries = 2, timeoutMs = 15000, method = "GET", body, headers } = options;

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": "Panopticon/1.0", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response;
      // Don't retry 4xx (except 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return response;
    } catch {}
    if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

// ── Rate Limiter (per-host) ─────────────────────────────

const _rateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(host: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = _rateLimits.get(host);

  if (!entry || now > entry.resetAt) {
    _rateLimits.set(host, { count: 1, resetAt: now + 60000 });
    return true; // OK
  }

  if (entry.count >= maxPerMinute) return false; // Rate limited
  entry.count++;
  return true;
}

export async function waitForRateLimit(host: string, maxPerMinute: number): Promise<void> {
  while (!checkRateLimit(host, maxPerMinute)) {
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ── Safe Module Execution (catches + logs) ──────────────

export async function safeExec<T>(
  moduleName: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<{ data: T; error?: string; durationMs: number }> {
  const start = Date.now();
  try {
    const data = await fn();
    return { data, durationMs: Date.now() - start };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { data: fallback, error, durationMs: Date.now() - start };
  }
}

// ── Input Sanitization ──────────────────────────────────

export function sanitizeDomain(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9.\-]/g, "").toLowerCase();
}

export function sanitizeIp(ip: string): string {
  return ip.replace(/[^a-fA-F0-9.:]/g, "");
}

export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.href;
  } catch {
    return "";
  }
}

// ── Port Range Parser ───────────────────────────────────

export function parsePortRange(input: string): number[] {
  const ports: number[] = [];
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map(Number);
      if (start && end && start <= end && end <= 65535) {
        for (let p = start; p <= end; p++) ports.push(p);
      }
    } else {
      const p = parseInt(trimmed, 10);
      if (p > 0 && p <= 65535) ports.push(p);
    }
  }
  return [...new Set(ports)].sort((a, b) => a - b);
}
