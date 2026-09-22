import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const childEnvironment = loadLocalEnvironment();
const virtualEnvironmentPython = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const python = childEnvironment.COURSE_EXTRACTOR_PYTHON
  || (existsSync(virtualEnvironmentPython) ? virtualEnvironmentPython : process.platform === "win32" ? "python" : "python3");
const dependencyCheck = spawnSync(python, ["-c", "import cryptography, pdfplumber"], {
  env: childEnvironment,
  shell: false,
  stdio: "ignore",
  windowsHide: true,
});
if (dependencyCheck.status !== 0) {
  console.error("The local course extractor is not prepared yet.");
  console.error("Run `npm run setup:extractor` once, then run `npm run dev` again.");
  process.exit(1);
}
const extractor = spawn(python, ["services/course_extractor/server.py"], {
  env: childEnvironment,
  shell: false,
  stdio: "inherit",
  windowsHide: true,
});
const site = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)], {
  env: childEnvironment,
  shell: false,
  stdio: "inherit",
  windowsHide: true,
});

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (!extractor.killed) extractor.kill();
  if (!site.killed) site.kill();
  process.exitCode = exitCode;
}

extractor.on("error", (error) => {
  console.error(`Could not start the local Python extractor: ${error.message}`);
  console.error("Create the Python environment described in services/course_extractor/README.md, then try again.");
  stop(1);
});
site.on("error", (error) => {
  console.error(`Could not start the website: ${error.message}`);
  stop(1);
});
extractor.on("exit", (code) => {
  if (!stopping) {
    console.error("The local course extractor stopped unexpectedly.");
    stop(code || 1);
  }
});
site.on("exit", (code) => stop(code || 0));

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

function loadLocalEnvironment() {
  const environment = { ...process.env };
  const shellKeys = new Set(Object.keys(process.env));
  for (const filename of [".env", ".env.local"]) {
    if (!existsSync(filename)) continue;
    for (const rawLine of readFileSync(filename, "utf8").split(/\r?\n/)) {
      const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || shellKeys.has(match[1])) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      environment[match[1]] = value;
    }
  }
  return environment;
}
