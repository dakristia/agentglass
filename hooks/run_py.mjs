// Cross-platform Python launcher for package.json scripts.
//
// Bun/npm run these scripts through a shell that has no `python3` on Windows
// (most installs expose `py` or `python`). Resolve an interpreter the same way
// install_hooks.py does — `py`/`python` on Windows, `python3` elsewhere — then
// exec the target script with any extra args passed straight through.
//
//   node hooks/run_py.mjs install_hooks.py --uninstall
import { spawnSync } from "node:child_process";

const isWin = process.platform === "win32";
const candidates = isWin ? ["py", "python", "python3"] : ["python3", "python"];

function resolveInterpreter() {
  for (const name of candidates) {
    // `<name> --version` succeeds only if the interpreter actually runs.
    const probe = spawnSync(name, ["--version"], { stdio: "ignore", shell: false });
    if (!probe.error && probe.status === 0) return name;
  }
  return null;
}

const python = resolveInterpreter();
if (!python) {
  console.error(
    `agentglass: no Python interpreter found (tried ${candidates.join(", ")}). ` +
      "Install Python 3 and re-run.",
  );
  process.exit(1);
}

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error("agentglass: run_py.mjs needs a script path, e.g. install_hooks.py");
  process.exit(1);
}

const result = spawnSync(python, [`hooks/${script}`, ...rest], {
  stdio: "inherit",
  shell: false,
});
process.exit(result.status ?? 1);
