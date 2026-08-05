import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "cloudflare:workers";
import * as schema from "./schema";

type DbEnv = {
  DATABASE_URL?: string;
  NEON_DATABASE_URL?: string;
};

function firstNonEmpty(...values: Array<string | undefined | null>) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      // Ignore quoted-empty or placeholder values from dashboards.
      if (
        trimmed &&
        trimmed !== '""' &&
        trimmed !== "''" &&
        !trimmed.endsWith("DATABASE_URL=")
      ) {
        return trimmed.replace(/^["']|["']$/g, "");
      }
    }
  }
  return "";
}

function resolveDatabaseUrl() {
  // Match auth.ts: read Worker bindings directly (no `in` check — Cloudflare
  // env is a Proxy and `in` is unreliable for secrets on some hosts).
  const workerEnv = env as DbEnv;
  return firstNonEmpty(
    workerEnv.DATABASE_URL,
    workerEnv.NEON_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.NEON_DATABASE_URL,
  );
}

export function getDb() {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set on this server. In APICloud/hosting, add a Worker secret named exactly DATABASE_URL (Neon connection string), then redeploy. Locally use .dev.vars.",
    );
  }
  return drizzle(neon(url), { schema });
}
