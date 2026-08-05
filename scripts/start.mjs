import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const port = String(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

/** Secrets the Worker reads via `cloudflare:workers` `env` (not Node process.env). */
const WORKER_SECRET_KEYS = [
  "DATABASE_URL",
  "LABELTRIX_ADMIN_PASSWORD",
  "LABELTRIX_VIEWER_PASSWORD",
  "LABELTRIX_AUTH_SECRET",
];

/**
 * `vite preview` (Docker / `npm start`) loads Worker secrets from `.dev.vars`
 * in the project root and the build output dirs — not from container env alone.
 * Materialize those files from the host/container environment at boot.
 */
function quoteDevVar(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function writeDevVarsFile(dir) {
  const lines = WORKER_SECRET_KEYS.flatMap((key) => {
    const value = process.env[key];
    if (!value) return [];
    return [`${key}=${quoteDevVar(value)}`];
  });
  if (!lines.length) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".dev.vars"), `${lines.join("\n")}\n`, "utf8");
  return true;
}

const cwd = process.cwd();
const written = writeDevVarsFile(cwd);

// Cloudflare Vite preview also reads `.dev.vars` next to the built worker output.
for (const rel of ["dist", "dist/client", "dist/server", ".wrangler/deploy", "build"]) {
  const dir = join(cwd, rel);
  if (existsSync(dir)) writeDevVarsFile(dir);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "[labeltrix] DATABASE_URL is not set. Products/packaging APIs will return 500.\n" +
      "  Set DATABASE_URL (Neon connection string) as a container/host secret, then restart.",
  );
} else if (written) {
  console.log("[labeltrix] Wrote Worker secrets to .dev.vars for vite preview.");
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
      // Fallback if a host has no .dev.vars: expose process.env to the Worker.
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
