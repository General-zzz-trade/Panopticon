import type { FastifyInstance } from "fastify";
import {
  initUsersTable,
  createUser,
  findUserByEmail,
  findUserById,
  hashPassword,
  updateLastLogin,
  getUserUsage,
} from "../../db/users";
import { signToken } from "../jwt-auth";
import { requireAuth } from "../rbac";

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Ensure users table exists on registration
  initUsersTable();

  // -----------------------------------------------------------------------
  // POST /auth/register
  // -----------------------------------------------------------------------
  app.post<{
    Body: { email: string; password: string; name?: string };
  }>("/auth/register", {
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", maxLength: 255 },
          password: { type: "string", minLength: 8, maxLength: 128 },
          name: { type: "string", maxLength: 255 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, name = "" } = request.body;

    // Check for existing user
    const existing = findUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: "A user with this email already exists" });
    }

    const user = createUser(email, password, name);
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    });

    return reply.code(201).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenant_id,
        plan: user.plan,
        createdAt: user.created_at,
      },
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/login
  // -----------------------------------------------------------------------
  app.post<{
    Body: { email: string; password: string };
  }>("/auth/login", {
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", maxLength: 255 },
          password: { type: "string", maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;

    const user = findUserByEmail(email);
    if (!user) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    if (user.password_hash !== hashPassword(password)) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    updateLastLogin(user.id);

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    });

    return reply.code(200).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenant_id,
        plan: user.plan,
        lastLoginAt: user.last_login_at,
      },
    });
  });

  // -----------------------------------------------------------------------
  // GET /auth/me — requires JWT
  // -----------------------------------------------------------------------
  app.get("/auth/me", {
    preHandler: [requireAuth()],
  }, async (request, reply) => {
    const user = findUserById(request.userId!);
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const usage = getUserUsage(user.id);

    return reply.code(200).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenant_id,
        plan: user.plan,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },
      usage: usage
        ? {
            tokens: usage.usage_tokens,
            runs: usage.usage_runs,
            limitTokens: usage.usage_limit_tokens,
            limitRuns: usage.usage_limit_runs,
          }
        : null,
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/refresh — issue a new token from a valid (non-expired) token
  // -----------------------------------------------------------------------
  app.post("/auth/refresh", {
    preHandler: [requireAuth()],
  }, async (request, reply) => {
    const user = findUserById(request.userId!);
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    });

    return reply.code(200).send({ token });
  });
}
