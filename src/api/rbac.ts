import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken, extractBearerToken, type JwtPayload } from "./jwt-auth";

// ---------------------------------------------------------------------------
// Extend Fastify request with user fields
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    userRole?: string;
    userEmail?: string;
    userTenantId?: string;
  }
}

// ---------------------------------------------------------------------------
// Role → permission mapping
// ---------------------------------------------------------------------------

const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  admin: new Set([
    "runs:create",
    "runs:read",
    "runs:cancel",
    "conversations:read",
    "conversations:write",
    "billing:read",
    "billing:write",
    "users:read",
    "users:write",
    "settings:read",
    "settings:write",
  ]),
  user: new Set([
    "runs:create",
    "runs:read",
    "runs:cancel",
    "conversations:read",
    "conversations:write",
    "billing:read",
    "billing:write",
  ]),
  viewer: new Set([
    "runs:read",
    "conversations:read",
    "billing:read",
  ]),
};

/**
 * Check whether a role has a specific permission.
 */
export function roleHasPermission(role: string, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

// ---------------------------------------------------------------------------
// Middleware: requireAuth
// ---------------------------------------------------------------------------

/**
 * Fastify preHandler that validates a JWT Bearer token and populates
 * `request.userId`, `request.userRole`, `request.userEmail`,
 * and `request.userTenantId`.
 */
export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({ error: "Missing or invalid Authorization header. Use: Bearer <token>" });
      return;
    }

    let payload: JwtPayload;
    try {
      payload = verifyToken(token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid token";
      reply.code(401).send({ error: message });
      return;
    }

    request.userId = payload.userId;
    request.userRole = payload.role;
    request.userEmail = payload.email;
    request.userTenantId = payload.tenantId;
    // Also keep tenantId in sync for downstream code that reads request.tenantId
    (request as any).tenantId = payload.tenantId;
  };
}

// ---------------------------------------------------------------------------
// Middleware: requireRole
// ---------------------------------------------------------------------------

/**
 * Fastify preHandler that checks the authenticated user has one of the
 * listed roles. Must be used *after* `requireAuth()`.
 *
 * @example
 * app.get("/admin/users", { preHandler: [requireAuth(), requireRole("admin")] }, handler);
 */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userRole = request.userRole;
    if (!userRole || !roles.includes(userRole)) {
      reply.code(403).send({
        error: "Forbidden",
        message: `Required role: ${roles.join(" | ")}. Your role: ${userRole ?? "none"}`,
      });
      return;
    }
  };
}

// ---------------------------------------------------------------------------
// Middleware: requirePermission
// ---------------------------------------------------------------------------

/**
 * Fastify preHandler that checks the authenticated user's role grants
 * the requested permission. Must be used *after* `requireAuth()`.
 */
export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userRole = request.userRole;
    if (!userRole || !roleHasPermission(userRole, permission)) {
      reply.code(403).send({
        error: "Forbidden",
        message: `Missing permission: ${permission}`,
      });
      return;
    }
  };
}
