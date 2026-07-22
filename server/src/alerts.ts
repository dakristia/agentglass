// Push alerts: fire on notable events (human-in-the-loop waits, errors).
// Delivery channels are opt-in via env:
//   AGENTGLASS_WEBHOOK   — POST {text} to this URL (Slack/Discord-compatible)
//   AGENTGLASS_NOTIFY=1  — run `notify-send` (Linux desktop) if available
import type { WatchEvent } from "../../shared/types.ts";
import { sessionNameOf } from "./db.ts";

const WEBHOOK = process.env.AGENTGLASS_WEBHOOK;
const DESKTOP = process.env.AGENTGLASS_NOTIFY === "1";

// Debounce identical alerts so a burst doesn't spam channels.
const lastSent = new Map<string, number>();
const DEBOUNCE_MS = 30_000;

function shouldSend(key: string): boolean {
  const now = Date.now();
  const prev = lastSent.get(key) ?? 0;
  if (now - prev < DEBOUNCE_MS) return false;
  lastSent.set(key, now);
  return true;
}

async function deliver(title: string, body: string) {
  if (WEBHOOK) {
    try {
      await fetch(WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `*${title}*\n${body}` }),
      });
    } catch (e) {
      console.warn("[alerts] webhook failed:", e);
    }
  }
  if (DESKTOP) {
    try {
      Bun.spawn(["notify-send", "-u", "critical", "--", title, body], { stdout: "ignore" });
    } catch {
      /* notify-send not installed — ignore */
    }
  }
}

/** Build a display label: repo:session_name if available, else repo:session_id(8). */
const agentLabel = (e: { source_app: string; session_id: string }) => {
  const name = sessionNameOf(e.session_id);
  return name ? `${e.source_app}:${name}` : `${e.source_app}:${e.session_id.slice(0, 8)}`;
};

/** A tool call is being held at the control-plane gate — ping the human. */
export function pushGate(agent: string, tool: string, summary: string) {
  if (shouldSend(`gate:${agent}:${summary}`))
    deliver("✋ Approval needed", `${agent} wants to run ${tool}${summary ? `: ${summary.slice(0, 200)}` : ""} — approve or deny in agentglass.`);
}

/** Inspect an event and fire an alert if it warrants one. */
export function maybeAlert(e: WatchEvent) {
  const isRelevant = e.hook_event_type === "PermissionRequest" || e.hook_event_type === "Notification" || e.is_error;
  if (!isRelevant) return;
  const agent = agentLabel(e);

  if (e.hook_event_type === "PermissionRequest") {
    if (shouldSend(`perm:${e.session_id}`))
      deliver("⏳ Approval needed", `${agent} is waiting on a permission request${e.tool_name ? ` (${e.tool_name})` : ""}.`);
    return;
  }
  if (e.hook_event_type === "Notification") {
    const msg = String((e.payload as any)?.message ?? "Agent notification");
    if (shouldSend(`notify:${e.session_id}:${msg}`)) deliver("🔔 " + agent, msg);
    return;
  }
  if (e.is_error) {
    if (shouldSend(`err:${e.session_id}:${e.tool_name}`))
      deliver("❌ Tool error", `${agent} — ${e.tool_name ?? "tool"} failed${e.error_text ? `: ${e.error_text.slice(0, 200)}` : ""}.`);
  }
}
