import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const port = String(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

/**
 * Coolify / Docker put secrets on process.env. `vite preview` (workerd) only
 * sees Worker bindings from `.dev.vars` (or CLOUDFLARE_INCLUDE_PROCESS_ENV).
 * Materialize `.dev.vars` at boot so DATABASE_URL reaches /api/products etc.
 */

function unwrapQuotes(value) {
  let trimmed = String(value).trim();
  while (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeDatabaseUrl(value) {
  if (!value) return "";
  const trimmed = unwrapQuotes(value);
  if (
    !trimmed.startsWith("postgres://") &&
    !trimmed.startsWith("postgresql://")
  ) {
    return "";
  }
  return trimmed;
}

function quoteDevVar(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function resolveWorkerSecrets() {
  const databaseUrl = normalizeDatabaseUrl(
    process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  );

  const secrets = {};
  if (databaseUrl) secrets.DATABASE_URL = databaseUrl;

  for (const key of [
    "LABELTRIX_ADMIN_PASSWORD",
    "LABELTRIX_VIEWER_PASSWORD",
    "LABELTRIX_AUTH_SECRET",
  ]) {
    const value = process.env[key] ? unwrapQuotes(process.env[key]) : "";
    if (value) secrets[key] = value;
  }
  return secrets;
}

function writeDevVarsFile(dir, secrets) {
  const entries = Object.entries(secrets);
  if (!entries.length) return false;
  mkdirSync(dir, { recursive: true });
  const body =
    entries.map(([key, value]) => `${key}=${quoteDevVar(value)}`).join("\n") +
    "\n";
  writeFileSync(join(dir, ".dev.vars"), body, "utf8");
  return true;
}

const secrets = resolveWorkerSecrets();
const cwd = process.cwd();
const written = writeDevVarsFile(cwd, secrets);

// Cloudflare Vite preview also reads `.dev.vars` next to built worker output.
for (const rel of [
  "dist",
  "dist/client",
  "dist/server",
  ".wrangler/deploy",
  "build",
]) {
  const dir = join(cwd, rel);
  if (existsSync(dir)) writeDevVarsFile(dir, secrets);
}

if (!secrets.DATABASE_URL) {
  console.error(
    "[labeltrix] DATABASE_URL is not set (or is not a postgres URL).\n" +
      "  In Coolify → Environment Variables, set runtime DATABASE_URL to your Neon\n" +
      "  connection string (postgresql://…?sslmode=require), then restart.",
  );
} else if (written) {
  console.log(
    "[labeltrix] Wrote Worker secrets to .dev.vars for vite preview (Coolify).",
  );
}

const child = spawn(
  process.execPath,
  [
    "./node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    host,
    "--port",
    port,
    "--strictPort",
  ],
  {
    cwd,
    env: {
      ...process.env,
      // Ensure Worker sees DATABASE_URL even if a host skips .dev.vars.
      ...(secrets.DATABASE_URL
        ? { DATABASE_URL: secrets.DATABASE_URL }
        : {}),
      CLOUDFLARE_INCLUDE_PROCESS_ENV:
        process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV ?? "true",
      WRANGLER_SEND_METRICS: process.env.WRANGLER_SEND_METRICS ?? "false",
      WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS ?? "false",
      WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
      MINIFLARE_REGISTRY_PATH:
        process.env.MINIFLARE_REGISTRY_PATH ?? ".wrangler/registry",
    },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
