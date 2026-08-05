import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "cloudflare:workers";
import * as schema from "./schema";

function resolveDatabaseUrl() {
  const fromWorker =
    typeof env === "object" && env && "DATABASE_URL" in env
      ? String((env as { DATABASE_URL?: string }).DATABASE_URL || "")
      : "";
  return fromWorker || process.env.DATABASE_URL || "";
}

export function getDb() {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Neon connection string to .dev.vars (local) and your host secrets (production).",
    );
  }
  return drizzle(neon(url), { schema });
}
