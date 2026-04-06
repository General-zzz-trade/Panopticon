import { createHmac, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

const JWT_SECRET: string =
  process.env.JWT_SECRET ?? randomBytes(32).toString("hex");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(data: string | Buffer): string {
  const str = typeof data === "string" ? Buffer.from(data) : data;
  return str.toString("base64url");
}

function base64UrlDecode(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf-8");
}

function hmacSign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a JWT signed with HS256.
 * @param payload - Data to encode (userId, email, role, tenantId).
 * @param secret  - Signing secret. Defaults to JWT_SECRET.
 * @param expiresInSec - Token lifetime in seconds (default 24 h).
 */
export function signToken(
  payload: Omit<JwtPayload, "iat" | "exp">,
  secret: string = JWT_SECRET,
  expiresInSec = 86_400,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSec,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = hmacSign(`${headerB64}.${payloadB64}`, secret);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify a JWT and return its decoded payload.
 * Throws on invalid/expired tokens.
 */
export function verifyToken(
  token: string,
  secret: string = JWT_SECRET,
): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const [headerB64, payloadB64, signature] = parts;
  const expectedSig = hmacSign(`${headerB64}.${payloadB64}`, secret);

  if (signature !== expectedSig) throw new Error("Invalid token signature");

  const payload: JwtPayload = JSON.parse(base64UrlDecode(payloadB64));

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("Token expired");

  return payload;
}

/**
 * Extract Bearer token from an Authorization header value.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

export { JWT_SECRET };
