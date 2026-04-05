/**
 * Security hardening middleware and utilities.
 *
 * - Rate limiting (per IP, in-memory token bucket)
 * - Dangerous action detection (confirms before destructive ops)
 * - Sensitive data masking in logs/artifacts
 * - Audit log (append-only SQLite)
 */
import { getDb } from "../db/client";
import type { FastifyRequest, FastifyReply } from "fastify";
import { logModuleError } from "../core/module-logger";

// ── Audit log ─────────────────────────────────────────────────────────────────

export const CREATE_AUDIT_TABLE = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    action TEXT NOT NULL,
    resource TEXT,
    ip TEXT,
    status INTEGER,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
`;

export function initAuditTable(): void {
  getDb().exec(CREATE_AUDIT_TABLE);
}

export function auditLog(entry: {
  tenantId: string;
  action: string;
  resource?: string;
  ip?: string;
  status?: number;
  detail?: string;
}): void {
  try {
    getDb().prepare(
      "INSERT INTO audit_log (tenant_id, action, resource, ip, status, detail) VALUES (?,?,?,?,?,?)"
    ).run(
      entry.tenantId,
      entry.action,
      entry.resource ?? null,
      entry.ip ?? null,
      entry.status ?? null,
      entry.detail ? maskSensitive(entry.detail) : null
    );
  } catch (error) { logModuleError("security", "optional", error, "writing audit log entry"); }
}

// ── Sensitive data masking ────────────────────────────────────────────────────

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/("?password"?\s*[:=]\s*)"[^"]*"/gi, '$1"***"'],
  [/("?token"?\s*[:=]\s*)"[^"]*"/gi,    '$1"***"'],
  [/("?secret"?\s*[:=]\s*)"[^"]*"/gi,   '$1"***"'],
  [/("?api_?key"?\s*[:=]\s*)"[^"]*"/gi, '$1"***"'],
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,   "Bearer ***"],
];

export function maskSensitive(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ── Dangerous action detection ────────────────────────────────────────────────

const DANGEROUS_KEYWORDS = /\b(delete|drop|truncate|rm -rf|format|wipe|purge|destroy|payment|checkout|purchase|transfer)\b/i;

export function isDangerousGoal(goal: string): { dangerous: boolean; reason?: string } {
  if (DANGEROUS_KEYWORDS.test(goal)) {
    const match = goal.match(DANGEROUS_KEYWORDS);
    return { dangerous: true, reason: `Goal contains potentially dangerous keyword: "${match?.[0]}"` };
  }
  return { dangerous: false };
}

// ── Rate limiting (token bucket per IP) ──────────────────────────────────────

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
const RATE_LIMIT_RPS = 20;       // max requests per second per IP
const RATE_LIMIT_BURST = 50;     // burst capacity

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_BURST, lastRefill: now };
    buckets.set(ip, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(RATE_LIMIT_BURST, bucket.tokens + elapsed * RATE_LIMIT_RPS);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// Fastify preHandler hook
export async function rateLimitHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ip = request.ip ?? "unknown";
  if (!checkRateLimit(ip)) {
    auditLog({ tenantId: "system", action: "rate_limit_exceeded", ip, status: 429 });
    await reply.code(429).send({ error: "Too many requests. Please slow down." });
  }
}
