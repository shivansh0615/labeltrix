import { spawn } from "node:child_process";
import process from "node:process";

const port = String(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

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
    cwd: process.cwd(),
    env: {
      ...process.env,
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
