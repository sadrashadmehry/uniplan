import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const virtualEnvironmentPython = process.platform === "win32"
  ? join(process.cwd(), ".venv", "Scripts", "python.exe")
  : join(process.cwd(), ".venv", "bin", "python");

if (!existsSync(virtualEnvironmentPython)) {
  const launcher = process.platform === "win32" ? "py" : "python3";
  const launcherArguments = process.platform === "win32"
    ? ["-3", "-m", "venv", ".venv"]
    : ["-m", "venv", ".venv"];
  run(launcher, launcherArguments, "Could not create the project-local Python environment.");
}

run(
  virtualEnvironmentPython,
  ["-m", "pip", "install", "-r", "services/course_extractor/requirements.txt"],
  "Could not install the course extractor dependencies.",
);

run(
  virtualEnvironmentPython,
  ["-c", "import cryptography, pdfplumber; print('Course extractor dependencies are ready.')"],
  "The course extractor dependency check failed.",
);

function run(command, arguments_, failureMessage) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(`${failureMessage} ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(failureMessage);
    process.exit(result.status || 1);
  }
}
