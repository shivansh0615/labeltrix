import { env } from "cloudflare:workers";

export type AuthRole = "admin" | "viewer";

export type AuthSession = {
  role: AuthRole;
  exp: number;
};

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

const COOKIE_NAME = "labeltrix_session";
const SESSION_DAYS = 14;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

type AuthEnv = {
  LABELTRIX_ADMIN_PASSWORD?: string;
  LABELTRIX_VIEWER_PASSWORD?: string;
  LABELTRIX_AUTH_SECRET?: string;
};

/** Normalize host/dashboard secrets: trim, strip wrapping quotes. */
function readSecret(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    let next = value.trim();
    if (
      (next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'"))
    ) {
      next = next.slice(1, -1).trim();
    }
    if (next) return next;
  }
  return "";
}

function authConfig() {
  const workerEnv = env as AuthEnv;
  const adminPassword = readSecret(
    workerEnv.LABELTRIX_ADMIN_PASSWORD,
    process.env.LABELTRIX_ADMIN_PASSWORD,
  );
  const viewerPassword = readSecret(
    workerEnv.LABELTRIX_VIEWER_PASSWORD,
    process.env.LABELTRIX_VIEWER_PASSWORD,
  );
  const secret = readSecret(
    workerEnv.LABELTRIX_AUTH_SECRET,
    process.env.LABELTRIX_AUTH_SECRET,
  );
  if (!adminPassword || !viewerPassword || !secret) {
    throw new AuthError(
      "Auth secrets are not configured. Set LABELTRIX_ADMIN_PASSWORD, LABELTRIX_VIEWER_PASSWORD, and LABELTRIX_AUTH_SECRET in .dev.vars (local) or host secrets (production).",
      500,
    );
  }
  return { adminPassword, viewerPassword, secret };
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return base64UrlEncode(signature);
}

async function hmacVerify(
  message: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expected = await hmacSign(message, secret);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAuthRole(value: unknown): value is AuthRole {
  return value === "admin" || value === "viewer";
}

export function verifyPassword(role: AuthRole, password: string): boolean {
  const config = authConfig();
  const expected =
    role === "admin" ? config.adminPassword : config.viewerPassword;
  if (!password || !expected) return false;
  if (password.length !== expected.length) {
    // Still compare to avoid trivial timing leaks on length-only checks.
  }
  let mismatch = password.length === expected.length ? 0 : 1;
  const max = Math.max(password.length, expected.length);
  for (let i = 0; i < max; i++) {
    mismatch |= (password.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export async function createSessionToken(role: AuthRole): Promise<string> {
  const payload: AuthSession = {
    role,
    exp: Date.now() + SESSION_MS,
  };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSign(body, authConfig().secret);
  return `${body}.${signature}`;
}

export async function parseSessionToken(
  token: string | undefined | null,
): Promise<AuthSession | null> {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const valid = await hmacVerify(body, signature, authConfig().secret);
  if (!valid) return null;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(body));
    const parsed = JSON.parse(json) as AuthSession;
    if (!isAuthRole(parsed.role) || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function readSession(
  request: Request,
): Promise<AuthSession | null> {
  return parseSessionToken(readSessionCookie(request));
}

export async function requireSession(request: Request): Promise<AuthSession> {
  const session = await readSession(request);
  if (!session) throw new AuthError("Sign in required.", 401);
  return session;
}

export async function requireAdmin(request: Request): Promise<AuthSession> {
  const session = await requireSession(request);
  if (session.role !== "admin") {
    throw new AuthError("Admin access required to change data.", 403);
  }
  return session;
}

export function sessionCookieHeader(
  token: string,
  requestUrl: string,
): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  const maxAge = Math.floor(SESSION_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "Authentication failed." }, { status: 401 });
}

export { COOKIE_NAME, SESSION_DAYS };
