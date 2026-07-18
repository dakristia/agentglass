// Live docker adapter — the backend for agentglass's lazydocker-style panel.
// Shells out to the `docker` CLI with arg arrays (never a shell string), reads
// JSON-lines output, and gates every mutating op behind
// AGENTGLASS_DOCKER_WRITE_DISABLED=1. Container ids/names are validated before
// they reach the CLI.

import type {
  DockerContainer, DockerStat, DockerImage, DockerVolume, DockerNetwork,
  DockerOverview, DockerActionResult,
} from "../../shared/types.ts";

export const DOCKER_WRITE_ENABLED = process.env.AGENTGLASS_DOCKER_WRITE_DISABLED !== "1";
// Container id (hex) or name (compose names: letters/digits . _ -).
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

type Res = { code: number; stdout: string; stderr: string };
function docker(args: string[], timeoutMs = 8000): Res {
  try {
    const proc = Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    return { code: proc.exitCode ?? 1, stdout: proc.stdout?.toString() ?? "", stderr: proc.stderr?.toString() ?? "" };
  } catch (e) {
    return { code: 1, stdout: "", stderr: String(e) };
  }
}

/** Awaited variant, so independent queries can run at once. Each `docker`
 *  invocation pays the CLI's own startup before it talks to the daemon, and
 *  the overview needs five of them — serially that cost is paid five times
 *  over, on a poll. */
async function dockerAsync(args: string[], timeoutMs = 8000): Promise<Res> {
  try {
    const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code: code ?? 1, stdout, stderr };
  } catch (e) {
    return { code: 1, stdout: "", stderr: String(e) };
  }
}

function jsonLines(out: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return rows;
}

let cachedVersion: string | null = null;
let versionCheckedAt = 0;
const VERSION_RETRY_MS = 15_000;
/** The daemon version doesn't change while we run, so a success is cached for
 *  good. A *failure* is cached too, briefly: re-probing on every poll meant a
 *  stopped daemon cost a blocking spawn — up to the 4s timeout — several times
 *  a minute, freezing the single-threaded server each time. */
export async function dockerVersion(): Promise<string | null> {
  if (cachedVersion) return cachedVersion;
  if (versionCheckedAt && Date.now() - versionCheckedAt < VERSION_RETRY_MS) return null;
  versionCheckedAt = Date.now();
  const r = await dockerAsync(["version", "--format", "{{.Server.Version}}"], 4000);
  cachedVersion = r.code === 0 ? r.stdout.trim() || null : null;
  return cachedVersion;
}

function parseLabels(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of (s || "").split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

// Every field is named explicitly instead of using `{{json .}}`, which looks
// equivalent but silently includes `Size` — and asking for a container's size
// makes the daemon walk its filesystem layers. That one field took this call
// from 19ms to 4.9s here, on a poll, blocking every other request behind it.
// The panel doesn't show per-container size, so it isn't requested.
const PS_FIELDS = ["ID", "Names", "Image", "State", "Status", "Ports", "Labels", "RunningFor"] as const;
// Tab-separated, not hand-built JSON. Interpolating values straight into a JSON
// template looked equivalent but isn't: a container whose name, image or labels
// contain a quote or a backslash produces invalid JSON, and jsonLines() drops
// the row silently — the container vanishes from the panel with no error. Real
// labels do this (a cloudflared image here embeds a JSON blob in one).
const PS_FORMAT = PS_FIELDS.map((f) => `{{.${f}}}`).join("\t");

async function containers(): Promise<DockerContainer[]> {
  const r = await dockerAsync(["ps", "--all", "--no-trunc", "--format", PS_FORMAT]);
  if (r.code !== 0) return [];
  const rows: Record<string, string>[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const row: Record<string, string> = {};
    PS_FIELDS.forEach((f, i) => { row[f] = parts[i] ?? ""; });
    rows.push(row);
  }
  return rows.map((c) => {
    const labels = parseLabels(c.Labels || "");
    return {
      id: (c.ID || "").slice(0, 12),
      name: c.Names || "",
      image: c.Image || "",
      state: (c.State || "").toLowerCase(),
      status: c.Status || "",
      ports: c.Ports || "",
      project: labels["com.docker.compose.project"] || null,
      service: labels["com.docker.compose.service"] || null,
      runningFor: c.RunningFor || "",
      size: c.Size || "",
    };
  });
}

async function images(): Promise<DockerImage[]> {
  const r = await dockerAsync(["images", "--format", "{{json .}}"]);
  if (r.code !== 0) return [];
  return jsonLines(r.stdout).map((i) => ({
    id: i.ID || "",
    repository: i.Repository || "",
    tag: i.Tag || "",
    size: i.Size || "",
    created: i.CreatedSince || "",
    containers: i.Containers || "",
    dangling: (i.Repository || "") === "<none>",
  }));
}

async function volumes(): Promise<DockerVolume[]> {
  const r = await dockerAsync(["volume", "ls", "--format", "{{json .}}"]);
  if (r.code !== 0) return [];
  return jsonLines(r.stdout).map((v) => ({ name: v.Name || "", driver: v.Driver || "" }));
}

async function networks(): Promise<DockerNetwork[]> {
  const r = await dockerAsync(["network", "ls", "--format", "{{json .}}"]);
  if (r.code !== 0) return [];
  return jsonLines(r.stdout).map((n) => ({ id: (n.ID || "").slice(0, 12), name: n.Name || "", driver: n.Driver || "", scope: n.Scope || "" }));
}

// The panel polls the overview every few seconds. Four CLI round-trips run
// back to back cost more than the interval on a busy daemon, so the poll was
// never idle — it just queued. They're independent, so they go together, and
// the result is held long enough to absorb a second viewer or a panel reopen.
const OVERVIEW_CACHE_MS = 2_000;
let overviewCache: { at: number; data: DockerOverview } | null = null;

export async function overview(): Promise<DockerOverview> {
  if (overviewCache && Date.now() - overviewCache.at < OVERVIEW_CACHE_MS) return overviewCache.data;
  const version = await dockerVersion();
  if (!version) {
    const down: DockerOverview = { available: false, writeEnabled: DOCKER_WRITE_ENABLED, version: null, containers: [], images: [], volumes: [], networks: [], error: "docker not available (is the daemon running?)" };
    overviewCache = { at: Date.now(), data: down };
    return down;
  }
  const [c, i, v, n] = await Promise.all([containers(), images(), volumes(), networks()]);
  const data: DockerOverview = { available: true, writeEnabled: DOCKER_WRITE_ENABLED, version, containers: c, images: i, volumes: v, networks: n };
  overviewCache = { at: Date.now(), data };
  return data;
}

const pct = (s?: string) => { const n = parseFloat((s || "").replace("%", "")); return Number.isFinite(n) ? n : 0; };

/** Live-ish resource stats (a single --no-stream sample). Can take ~1-2s. */
export function stats(): DockerStat[] {
  const r = docker(["stats", "--no-stream", "--no-trunc", "--format", "{{json .}}"], 12000);
  if (r.code !== 0) return [];
  return jsonLines(r.stdout).map((s) => ({
    id: (s.ID || "").slice(0, 12),
    cpu: pct(s.CPUPerc),
    mem: pct(s.MemPerc),
    memUsage: s.MemUsage || "",
    netIO: s.NetIO || "",
    blockIO: s.BlockIO || "",
    pids: parseInt(s.PIDs || "0", 10) || 0,
  }));
}

/** Last `tail` log lines for a container (bounded). Docker writes logs to stderr. */
export function logs(id: string, tail = 400): { ok: boolean; text: string; error?: string } {
  if (!ID_RE.test(id)) return { ok: false, text: "", error: "invalid container id" };
  const n = Math.max(1, Math.min(5000, tail | 0));
  const r = docker(["logs", "--tail", String(n), "--timestamps", id], 10000);
  // A container writes its own logs to stderr with exit 0; a non-zero exit is a
  // real failure (e.g. "No such container") — surface it as an error, not logs.
  if (r.code !== 0) return { ok: false, text: "", error: r.stderr.trim() || "docker logs failed" };
  // Interleave: docker sends stdout+stderr separately; concatenate both.
  return { ok: true, text: (r.stdout + r.stderr) };
}

function guard(id: string): DockerActionResult | null {
  if (!DOCKER_WRITE_ENABLED) return { ok: false, error: "docker write is disabled (AGENTGLASS_DOCKER_WRITE_DISABLED=1)" };
  if (!ID_RE.test(id)) return { ok: false, error: "invalid container id" };
  return null;
}
function action(verb: string, id: string, extra: string[] = []): DockerActionResult {
  const g = guard(id); if (g) return g;
  const r = docker([verb, ...extra, id], 20000);
  // The panel refetches right after acting; without dropping the cache it gets
  // the pre-action snapshot back and the container looks unchanged, as though
  // the button did nothing.
  overviewCache = null;
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || r.stdout.trim() || `docker ${verb} failed` };
  return { ok: true, output: r.stdout.trim() || `${verb} ${id.slice(0, 12)}` };
}

export const startContainer = (id: string) => action("start", id);
export const stopContainer = (id: string) => action("stop", id);
export const restartContainer = (id: string) => action("restart", id);
export const removeContainer = (id: string) => action("rm", id); // non-force: fails if running (stop first)
