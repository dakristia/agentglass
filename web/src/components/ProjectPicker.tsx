// Project picker — "which folder is this cockpit about?"
//
// Shown on first open (when the instance isn't scoped yet) and reachable from
// the header afterwards. Picking a project hands the server its directory: the
// dashboard, git panel and terminal then work on exactly that folder — its
// Makefile commands, its repos, its sessions — instead of everything on the
// machine. The choice is persisted server-side (config.json), so the next
// launch opens straight into the same project.
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { GitRepoRef } from "../../../shared/types.ts";
import { Portal } from "./Portal.tsx";
import { api, IS_DEMO } from "../lib/api.ts";
import { SCROLLBAR_CSS } from "./ChangesModal.tsx";

/** Set once the user has answered the startup question (either way), so an
 *  unscoped instance doesn't re-ask on every reload. */
export const PICKER_ANSWERED_KEY = "agentglass.projectChosen";
const markAnswered = () => { try { localStorage.setItem(PICKER_ANSWERED_KEY, "1"); } catch { /* ignore */ } };

export function ProjectPicker({ open, workspace, onClose }: { open: boolean; workspace: string | null; onClose: () => void }) {
  const [repos, setRepos] = useState<GitRepoRef[] | null>(null);
  const [query, setQuery] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setRepos(null);
    api.gitReposAll().then(({ repos }) => setRepos(repos)).catch(() => setRepos([]));
  }, [open]);

  const choose = (root: string | null) => {
    if (busy) return;
    markAnswered();
    if (root === workspace) { onClose(); return; } // already there — nothing to change
    setBusy(true);
    setError("");
    api.setWorkspace(root)
      .then((res) => {
        if (!res.ok) { setBusy(false); setError(res.error || "could not switch project"); return; }
        // A failed persist or an env override only affects the *next* launch —
        // the switch itself worked — so say so without blocking the reload.
        if (res.note) console.warn(`[agentglass] ${res.note}`);
        else if (!res.persisted) console.warn("[agentglass] project choice applied but could not be saved — it won't survive a server restart");
        // Everything on screen — events, repos, sessions — belongs to the old
        // scope. A clean reload is the honest way to rescope all of it.
        location.reload();
      })
      .catch((e) => { setBusy(false); setError(String(e)); });
  };

  // No closing mid-switch: the reload lands when the server answers, and a
  // dismissed modal reappearing as a surprise page reload is worse than a
  // short wait watching the "switching…" note.
  const close = () => { if (busy) return; markAnswered(); onClose(); };

  const q = query.trim().toLowerCase();
  const shown = (repos ?? []).filter((r) => !q || (r.name + " " + r.root + " " + r.branch).toLowerCase().includes(q));

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0" style={{ zIndex: 10000, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }} onClick={close} />
            <div className="fixed inset-0 flex items-center justify-center p-3 pointer-events-none" style={{ zIndex: 10001 }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ type: "spring", stiffness: 330, damping: 30 }}
                className="w-[560px] max-w-[95vw] max-h-[85vh] rounded-2xl flex flex-col pointer-events-auto overflow-hidden"
                style={{ background: "var(--bg2)", border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)", boxShadow: "0 30px 80px -20px rgba(0,0,0,0.8)" }}>
                <style>{SCROLLBAR_CSS}</style>

                <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0" style={{ borderColor: "color-mix(in srgb, var(--border) 40%, transparent)" }}>
                  <span className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>⌂ Open a project</span>
                  <span className="text-[11px] t-dim2">a project — or a folder your projects live in</span>
                  <button onClick={close} className="ml-auto text-[18px] leading-none px-2 t-dim2 hover:opacity-70">✕</button>
                </div>

                <div className="px-4 pt-3 shrink-0">
                  <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter projects…"
                    className="w-full px-3 py-2 rounded-lg text-[12px] outline-none"
                    style={{ background: "color-mix(in srgb, var(--bg3) 50%, transparent)", border: "1px solid color-mix(in srgb, var(--border) 40%, transparent)", color: "var(--text)" }} />
                </div>

                <div className="agx-scroll overflow-y-auto flex-1 px-2 py-2" style={{ minHeight: 160 }}>
                  {/* machine-wide is a real choice, not just the absence of one */}
                  <button onClick={() => choose(null)} disabled={busy}
                    className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5"
                    style={{ background: !workspace ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }}>
                    <span className="text-[13px]">🖥</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium" style={{ color: "var(--text)" }}>Whole machine</span>
                      <span className="block text-[10px] t-dim2">every project at once — no scope</span>
                    </span>
                    {!workspace && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ color: "var(--primary-hover)", background: "color-mix(in srgb, var(--primary) 15%, transparent)" }}>current</span>}
                  </button>

                  {repos === null && <div className="px-3 py-3 text-[11px] t-dim2">looking for repos…</div>}
                  {repos !== null && !shown.length && <div className="px-3 py-3 text-[11px] t-dim2">no repos found{q ? " for that filter" : ""}</div>}
                  {shown.map((r) => (
                    <button key={r.root} onClick={() => choose(r.root)} disabled={busy}
                      className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                      style={{ background: r.root === workspace ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }}>
                      <span className="text-[13px]">📁</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium truncate" style={{ color: "var(--text)" }}>
                          {r.name}
                          {r.dirty > 0 && <span className="t-dim2 font-normal"> · {r.dirty} change{r.dirty === 1 ? "" : "s"}</span>}
                        </span>
                        <span className="block text-[10px] t-dim2 truncate" title={r.root}>{r.root}</span>
                      </span>
                      <span className="shrink-0 text-[9.5px] t-dim2 truncate" style={{ maxWidth: 120 }}>{r.branch}</span>
                      {r.root === workspace && <span className="shrink-0 text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ color: "var(--primary-hover)", background: "color-mix(in srgb, var(--primary) 15%, transparent)" }}>current</span>}
                    </button>
                  ))}
                </div>

                {/* a project that lives somewhere the sweep doesn't reach */}
                <div className="px-4 py-3 border-t shrink-0 flex items-center gap-2" style={{ borderColor: "color-mix(in srgb, var(--border) 40%, transparent)" }}>
                  <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="…or type a folder: ~/code/my-project, or ~/code for everything in it"
                    onKeyDown={(e) => { if (e.key === "Enter" && path.trim()) choose(path.trim()); }}
                    className="flex-1 px-3 py-1.5 rounded-lg text-[11px] outline-none"
                    style={{ background: "color-mix(in srgb, var(--bg3) 50%, transparent)", border: "1px solid color-mix(in srgb, var(--border) 40%, transparent)", color: "var(--text)" }} />
                  <button onClick={() => path.trim() && choose(path.trim())} disabled={busy || !path.trim()}
                    className="text-[11px] px-3 py-1.5 rounded-lg font-medium"
                    style={{ color: "var(--primary-hover)", background: "color-mix(in srgb, var(--primary) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)", opacity: path.trim() ? 1 : 0.5 }}>
                    open
                  </button>
                </div>
                {(error || busy || IS_DEMO) && (
                  <div className="px-4 pb-3 text-[10.5px] shrink-0" style={{ color: error ? "var(--error)" : "var(--text2)" }}>
                    {IS_DEMO ? "the demo is never scoped — run agentglass locally to open a project" : error || "switching project…"}
                  </div>
                )}
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </Portal>
  );
}
