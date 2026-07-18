import type { WatchEvent } from "../../../shared/types.ts";
import { agentKey } from "./format.ts";

export type AgentStatus = "working" | "waiting" | "errored" | "idle";

export interface AgentCard {
  key: string;
  source_app: string;
  session_id: string;
  model_name: string | null;
  status: AgentStatus;
  lastAction: string;
  lastType: string;
  events: number;
  tools: number;
  errors: number;
  cost: number;
  tokens: number;
  lastSeen: number;
  lastErrorTs: number;
  spark: number[]; // events per recent bucket
  /** Distinct subagents this session spawned (by agent_id). */
  subagents: number;
  /** Subagent type → count, most common first (e.g. Explore, workflow-subagent). */
  subagentTypes: [string, number][];
}

const STALL_MS = 20_000;
const IDLE_MS = 5 * 60_000;

/** Roll the live event buffer up into per-agent cards. */
export function deriveAgents(events: WatchEvent[]): AgentCard[] {
  const now = Date.now();
  const map = new Map<string, AgentCard>();
  // Subagents fold into their parent session_id but carry agent_id/agent_type,
  // so track the distinct subagents (and their kinds) seen per session.
  const subs = new Map<string, Map<string, string>>(); // key → (agent_id → agent_type)

  for (const e of events) {
    const key = agentKey(e);
    let a = map.get(key);
    if (!a) {
      a = {
        key,
        source_app: e.source_app,
        session_id: e.session_id,
        model_name: e.model_name,
        status: "idle",
        lastAction: "",
        lastType: "",
        events: 0,
        tools: 0,
        errors: 0,
        cost: 0,
        tokens: 0,
        lastSeen: 0,
        lastErrorTs: 0,
        spark: new Array(20).fill(0),
        subagents: 0,
        subagentTypes: [],
      };
      map.set(key, a);
    }
    if (e.agent_id) {
      let m = subs.get(key);
      if (!m) subs.set(key, (m = new Map()));
      // Don't let a later type-less event downgrade a known subagent type
      // (inner tool events don't re-carry it) back to the generic fallback.
      const prev = m.get(e.agent_id);
      if (e.agent_type || !prev) m.set(e.agent_id, e.agent_type || prev || "subagent");
    }
    a.events++;
    if (e.hook_event_type === "PostToolUse" || e.hook_event_type === "PostToolUseFailure") a.tools++;
    if (e.is_error) { a.errors++; if (e.timestamp >= a.lastErrorTs) a.lastErrorTs = e.timestamp; }
    a.cost += e.cost_usd;
    a.tokens += e.input_tokens + e.output_tokens;
    if (e.timestamp >= a.lastSeen) {
      a.lastSeen = e.timestamp;
      a.lastType = e.hook_event_type;
      if (e.model_name) a.model_name = e.model_name; // latest, not last-in-array
      a.lastAction = e.tool_name
        ? `${e.hook_event_type} · ${e.tool_name}`
        : e.hook_event_type;
    }
  }

  // Spark buckets over the last 20 * 3s = 60s window.
  const bucketMs = 3000;
  for (const e of events) {
    const a = map.get(agentKey(e))!;
    const idx = 19 - Math.floor((now - e.timestamp) / bucketMs);
    if (idx >= 0 && idx < 20) a.spark[idx]++;
  }

  for (const a of map.values()) {
    const since = now - a.lastSeen;
    // Anything idle long enough is idle, regardless of what it was doing —
    // otherwise an abandoned "waiting"/"errored" agent stays lit forever and
    // keeps re-triggering its alert.
    if (since >= IDLE_MS || a.lastType === "Stop" || a.lastType === "SessionEnd") a.status = "idle";
    else if (a.lastType === "PermissionRequest" || a.lastType === "Notification") a.status = "waiting";
    // Errored only on a RECENT error, not a lifetime count — one transient
    // failure early shouldn't paint a now-healthy agent red for its whole run.
    else if (now - a.lastErrorTs < STALL_MS) a.status = "errored";
    else if (since < STALL_MS) a.status = "working";
    else a.status = "idle";

    const m = subs.get(a.key);
    if (m) {
      a.subagents = m.size;
      const byType = new Map<string, number>();
      for (const type of m.values()) byType.set(type, (byType.get(type) ?? 0) + 1);
      a.subagentTypes = [...byType.entries()].sort((x, y) => y[1] - x[1]);
    }
  }

  return [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export interface Alert {
  id: string;
  level: "warn" | "error" | "info";
  agent: string;
  text: string;
  ts: number;
}

export function deriveAlerts(agents: AgentCard[]): Alert[] {
  const out: Alert[] = [];
  for (const a of agents) {
    if (a.status === "waiting")
      out.push({ id: "wait:" + a.key, level: "warn", agent: a.key, text: "waiting for approval / input", ts: a.lastSeen });
    if (a.status === "errored")
      out.push({ id: "err:" + a.key, level: "error", agent: a.key, text: `${a.errors} error(s) — last action ${a.lastAction}`, ts: a.lastSeen });
    const rate = a.tools > 3 ? a.errors / a.tools : 0;
    if (rate > 0.25)
      out.push({ id: "rate:" + a.key, level: "error", agent: a.key, text: `high failure rate ${(rate * 100).toFixed(0)}%`, ts: a.lastSeen });
  }
  return out.sort((x, y) => y.ts - x.ts);
}
