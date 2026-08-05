import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "cloudflare:workers";
import * as schema from "./schema";

type DbEnv = {
  DATABASE_URL?: string;
  NEON_DATABASE_URL?: string;
};

/** Normalize Coolify/dashboard values: trim, unwrap quotes, drop placeholders. */
export function normalizeDatabaseUrl(
  value: string | undefined | null,
): string {
  if (typeof value !== "string") return "";
  let trimmed = value.trim();
  // Unwrap nested quotes Coolify sometimes stores as part of the value.
  while (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (
    !trimmed ||
    trimmed === "DATABASE_URL=" ||
    trimmed.endsWith("DATABASE_URL=")
  ) {
    return "";
  }
  if (
    !trimmed.startsWith("postgres://") &&
    !trimmed.startsWith("postgresql://")
  ) {
    return "";
  }
  return trimmed;
}

function resolveDatabaseUrl() {
  // Read Worker bindings directly (no `in` check — Cloudflare `env` is a Proxy
  // and `in` is unreliable for secrets on some hosts / vite preview).
  const workerEnv = env as DbEnv;
  for (const candidate of [
    workerEnv.DATABASE_URL,
    workerEnv.NEON_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.NEON_DATABASE_URL,
  ]) {
    const url = normalizeDatabaseUrl(candidate);
    if (url) return url;
  }
  return "";
}

export function getDb() {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. In Coolify, add a runtime env var named DATABASE_URL (Neon connection string starting with postgresql://), then redeploy. Locally put it in .dev.vars.",
    );
  }
  return drizzle(neon(url), { schema });
}
