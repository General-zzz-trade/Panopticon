import type { FastifyInstance } from "fastify";
import { findUserById, getUserUsage, updateUserUsage } from "../../db/users";
import { requireAuth } from "../rbac";
import { getDb } from "../../db/client";

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

interface PlanDef {
  id: string;
  name: string;
  price: number;          // USD / month
  limitTokens: number;
  limitRuns: number;
  features: string[];
}

const PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    limitTokens: 100_000,
    limitRuns: 50,
    features: ["Basic planning", "5 concurrent runs", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 29,
    limitTokens: 1_000_000,
    limitRuns: 500,
    features: [
      "LLM-powered planning",
      "20 concurrent runs",
      "Priority support",
      "Advanced recovery",
      "Custom handlers",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 199,
    limitTokens: 10_000_000,
    limitRuns: 5_000,
    features: [
      "Unlimited planners",
      "Unlimited concurrent runs",
      "Dedicated support",
      "SSO / SAML",
      "Custom SLA",
      "On-prem deployment",
    ],
  },
];

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // GET /billing/usage — current usage for the authenticated user
  // -----------------------------------------------------------------------
  app.get("/billing/usage", {
    preHandler: [requireAuth()],
  }, async (request, reply) => {
    const usage = getUserUsage(request.userId!);
    if (!usage) {
      return reply.code(404).send({ error: "User not found" });
    }

    const tokenPct =
      usage.usage_limit_tokens > 0
        ? Math.round((usage.usage_tokens / usage.usage_limit_tokens) * 100)
        : 0;
    const runsPct =
      usage.usage_limit_runs > 0
        ? Math.round((usage.usage_runs / usage.usage_limit_runs) * 100)
        : 0;

    return reply.code(200).send({
      plan: usage.plan,
      tokens: {
        used: usage.usage_tokens,
        limit: usage.usage_limit_tokens,
        percentUsed: tokenPct,
      },
      runs: {
        used: usage.usage_runs,
        limit: usage.usage_limit_runs,
        percentUsed: runsPct,
      },
    });
  });

  // -----------------------------------------------------------------------
  // GET /billing/plans — list available plans with limits
  // -----------------------------------------------------------------------
  app.get("/billing/plans", async (_request, reply) => {
    return reply.code(200).send({ plans: PLANS });
  });

  // -----------------------------------------------------------------------
  // POST /billing/upgrade — upgrade plan (placeholder Stripe integration)
  // -----------------------------------------------------------------------
  app.post<{
    Body: { plan: string };
  }>("/billing/upgrade", {
    preHandler: [requireAuth()],
    schema: {
      body: {
        type: "object",
        required: ["plan"],
        properties: {
          plan: { type: "string", enum: ["pro", "enterprise"] },
        },
      },
    },
  }, async (request, reply) => {
    const { plan } = request.body;
    const user = findUserById(request.userId!);
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (user.plan === plan) {
      return reply.code(400).send({ error: `Already on the ${plan} plan` });
    }

    const targetPlan = PLANS.find((p) => p.id === plan);
    if (!targetPlan) {
      return reply.code(400).send({ error: "Unknown plan" });
    }

    // Stripe checkout or mock
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    let checkoutUrl: string;

    if (stripeKey) {
      // Real Stripe: create checkout session
      try {
        const priceMap: Record<string, string> = { pro: process.env.STRIPE_PRICE_PRO || 'price_pro', enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise' };
        const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            'line_items[0][price]': priceMap[plan] || plan,
            'line_items[0][quantity]': '1',
            'mode': 'subscription',
            'success_url': `${request.headers.origin || 'http://localhost:3000'}/api/v1/billing/success?plan=${plan}&user=${user.id}`,
            'cancel_url': `${request.headers.origin || 'http://localhost:3000'}/`,
            'client_reference_id': user.id,
            'metadata[plan]': plan,
          }).toString()
        });
        const session = await res.json() as { url?: string };
        checkoutUrl = session.url || `/api/v1/billing/mock-success?plan=${plan}`;
      } catch {
        checkoutUrl = `/api/v1/billing/mock-success?plan=${plan}`;
      }
    } else {
      checkoutUrl = `/api/v1/billing/mock-success?plan=${plan}`;
    }

    return reply.code(200).send({
      message: `Upgrade to ${targetPlan.name} initiated`,
      checkoutUrl,
      plan: { id: targetPlan.id, name: targetPlan.name, price: targetPlan.price },
    });
  });

  // Mock success — for development without Stripe
  app.get<{ Querystring: { plan?: string } }>("/billing/mock-success", async (request, reply) => {
    const plan = request.query.plan;
    if (!plan) return reply.code(400).send({ error: "Missing plan param" });
    // In dev, upgrade the first user found (or use JWT)
    const userId = (request as any).userId;
    if (userId) {
      const db = getDb();
      const limits: Record<string, { tokens: number; runs: number }> = { pro: { tokens: 500000, runs: 500 }, enterprise: { tokens: 5000000, runs: 5000 } };
      const l = limits[plan] || limits.pro;
      db.prepare("UPDATE users SET plan = ?, usage_limit_tokens = ?, usage_limit_runs = ? WHERE id = ?").run(plan, l.tokens, l.runs, userId);
    }
    return reply.redirect('/');
  });

  // -----------------------------------------------------------------------
  // POST /billing/record-usage — internal endpoint to track usage after a run
  // -----------------------------------------------------------------------
  app.post<{
    Body: { userId: string; tokens: number; runs: number };
  }>("/billing/record-usage", {
    preHandler: [requireAuth()],
    schema: {
      body: {
        type: "object",
        required: ["userId", "tokens", "runs"],
        properties: {
          userId: { type: "string" },
          tokens: { type: "integer", minimum: 0 },
          runs: { type: "integer", minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { userId, tokens, runs } = request.body;

    // Only allow users to record their own usage, or admins to record any
    if (request.userRole !== "admin" && request.userId !== userId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const user = findUserById(userId);
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    // Check limits before recording
    if (user.usage_tokens + tokens > user.usage_limit_tokens) {
      return reply.code(429).send({
        error: "Token usage limit exceeded",
        current: user.usage_tokens,
        limit: user.usage_limit_tokens,
        requested: tokens,
      });
    }
    if (user.usage_runs + runs > user.usage_limit_runs) {
      return reply.code(429).send({
        error: "Run usage limit exceeded",
        current: user.usage_runs,
        limit: user.usage_limit_runs,
        requested: runs,
      });
    }

    updateUserUsage(userId, tokens, runs);

    return reply.code(200).send({ ok: true });
  });
}
