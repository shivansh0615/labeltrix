import { spawn } from "node:child_process";
import process from "node:process";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const environment = {
  ...process.env,
  WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
};

const pdfService = spawn(process.execPath, ["scripts/pdf-server.mjs"], {
  env: environment,
  stdio: "inherit",
  cwd: process.cwd(),
});
const webApp = spawn(command, ["vinext", "dev"], {
  env: environment,
  stdio: "inherit",
  cwd: process.cwd(),
  shell: process.platform === "win32",
});

let shuttingDown = false;

function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  pdfService.kill();
  webApp.kill();
  process.exitCode = exitCode;
}

pdfService.on("exit", (code) => {
  if (!shuttingDown) stop(code ?? 1);
});
webApp.on("exit", (code) => {
  if (!shuttingDown) stop(code ?? 1);
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
