import { useMemo, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { AgentCard } from "../lib/derive.ts";
import { Panel } from "./Panel.tsx";
import { fmtUsd, fmtTokens, fmtAgo, modelLabelOf, agentLabel } from "../lib/format.ts";

const ago = (ts: number) => {
  const s = fmtAgo(ts);
  return s === "now" ? "now" : `${s} ago`;
};

const STATUS: Record<string, { color: string; label: string }> = {
  working: { color: "var(--success)", label: "working" },
  waiting: { color: "var(--warning)", label: "waiting" },
  errored: { color: "var(--error)", label: "errored" },
  idle: { color: "var(--text4)", label: "idle" },
};
const RANK: Record<string, number> = { working: 0, errored: 1, waiting: 2, idle: 3 };
const shortType = (t: string) =>
  t.replace(/^workflow-subagent$/, "workflow").replace(/^general-purpose$/, "general");

function Spark({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-[1.5px] h-6">
      {data.map((v, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-sm origin-bottom"
          initial={false}
          animate={{ height: `${Math.max(6, (v / max) * 100)}%` }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          style={{ background: v ? color : "color-mix(in srgb, var(--border) 50%, transparent)" }}
        />
      ))}
    </div>
  );
}

function SubagentRow({ a, expanded, onToggle, onSelect }: { a: AgentCard; expanded: boolean; onToggle: () => void; onSelect?: (a: AgentCard) => void }) {
  const st = STATUS[a.status];
  const types = a.subagentTypes.filter(([t]) => t !== "subagent");
  const label = types.length ? types.map(([t]) => shortType(t)).join(" · ") : "subagent";
  return (
    <div
      className="flex items-center gap-2 pl-5 pr-2 py-1 rounded-lg cursor-pointer group"
      style={{ background: "color-mix(in srgb, var(--info) 6%, transparent)" }}
      onClick={() => onSelect?.(a)}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {a.status === "working" && (
          <span className="absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: st.color, animation: "ping-ring 1.6s ease-out infinite" }} />
        )}
        <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: st.color }} />
      </span>
      <span className="text-[11px] font-medium truncate" style={{ color: "var(--info)" }}>{label}</span>
      <span className="text-[10px] t-dim2 truncate">{a.lastAction || st.label}</span>
      <span className="ml-auto flex items-center gap-2 text-[9.5px] t-dim2 tabular-nums shrink-0">
        <span>{a.tools}t</span>
        {a.errors > 0 && <span style={{ color: "var(--error)" }}>{a.errors}err</span>}
        <span style={{ color: "var(--success)" }}>{fmtUsd(a.cost)}</span>
        <span>{ago(a.lastSeen)}</span>
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="shrink-0 text-[9px] px-1 py-0.5 rounded t-dim2 hover:t-dim transition-colors opacity-0 group-hover:opacity-100"
        style={{ background: "color-mix(in srgb, var(--text) 8%, transparent)" }}
        title={expanded ? "Collapse to compact row" : "Expand to full card"}
      >
        {expanded ? "▾" : "▸"}
      </button>
    </div>
  );
}

function SessionCard({ a, selected, onSelect, subChildren, subExpanded, onToggleSubs, expandedSubs, onToggleExpandedSub }: {
  a: AgentCard;
  selected: boolean;
  onSelect?: (a: AgentCard) => void;
  subChildren: AgentCard[];
  subExpanded: boolean;
  onToggleSubs: () => void;
  expandedSubs: Set<string>;
  onToggleExpandedSub: (key: string) => void;
}) {
  const st = STATUS[a.status];
  const model = modelLabelOf(a.model_name);
  const [copied, setCopied] = useState(false);
  const copyId = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(a.session_id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [a.session_id]);
  const label = agentLabel(a);
  const named = a.subagentTypes.filter(([t]) => t !== "subagent");
  return (
    <>
      <motion.div
        onClick={() => onSelect?.(a)}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        whileHover={{
          backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--primary) 45%, transparent)",
        }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="relative rounded-xl p-2.5 pl-4 cursor-pointer"
        style={{
          background: selected ? "color-mix(in srgb, var(--primary) 16%, transparent)" : "color-mix(in srgb, var(--bg3) 40%, transparent)",
          border: `1px solid color-mix(in srgb, var(--primary) ${selected ? 55 : 10}%, transparent)`,
          boxShadow: selected ? "inset 0 0 0 1px color-mix(in srgb, var(--primary) 45%, transparent)" : "none",
        }}
      >
        <span className="absolute left-[3px] top-2.5 bottom-2.5 w-[3px] rounded-full" style={{ background: st.color, boxShadow: `0 0 6px ${st.color}` }} />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {a.status === "working" && (
                <span className="absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: st.color, animation: "ping-ring 1.6s ease-out infinite" }} />
              )}
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: st.color }} />
            </span>
            <span className="truncate text-[13px]" style={{ color: "var(--text)" }}>{label}</span>
            <button
              onClick={copyId}
              className="shrink-0 text-[9px] px-1 py-0.5 rounded t-dim2 hover:t-dim transition-colors"
              style={{ background: "color-mix(in srgb, var(--text) 8%, transparent)" }}
              title={`Copy session ID: ${a.session_id}`}
            >
              {copied ? "✓" : "⧉"}
            </button>
          </div>
          <span className="chip shrink-0" style={{ color: "var(--primary)", background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}>{model}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] t-dim2 truncate">{a.lastAction || st.label}</span>
          <Spark data={a.spark} color={st.color} />
        </div>
        {(a.subagents > 0 || subChildren.length > 0) && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSubs(); }}
            className="mt-1.5 flex items-center gap-1.5 text-[10px] cursor-pointer w-full text-left"
            style={{ color: "var(--info)" }}
          >
            <span className="text-[8px] transition-transform" style={{ transform: subExpanded ? "none" : "rotate(-90deg)" }}>▾</span>
            <span aria-hidden>⑃</span>
            <span className="tabular-nums font-medium">{Math.max(a.subagents, subChildren.length)} subagent{Math.max(a.subagents, subChildren.length) > 1 ? "s" : ""}</span>
            {named.length > 0 && (
              <span className="t-dim2 truncate">
                {named.slice(0, 3).map(([type, n]) => `${shortType(type)}${n > 1 ? ` ×${n}` : ""}`).join(" · ")}
              </span>
            )}
          </button>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[10px] t-dim2 tabular-nums">
          <span>{a.tools} tools</span>
          {a.errors > 0 && <span style={{ color: "var(--error)" }}>{a.errors} err</span>}
          <span className="t-dim">{fmtTokens(a.tokens)} tok</span>
          <span style={{ color: "var(--success)" }}>{fmtUsd(a.cost)}</span>
          <span className="ml-auto">{ago(a.lastSeen)}</span>
        </div>
      </motion.div>
      <AnimatePresence initial={false}>
        {subExpanded && subChildren.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden ml-3 space-y-1 border-l"
            style={{ borderColor: "color-mix(in srgb, var(--info) 20%, transparent)" }}
          >
            {subChildren.map((child) =>
              expandedSubs.has(child.key) ? (
                <SessionCard
                  key={child.key}
                  a={child}
                  selected={selected}
                  onSelect={onSelect}
                  subChildren={[]}
                  subExpanded={false}
                  onToggleSubs={() => {}}
                  expandedSubs={expandedSubs}
                  onToggleExpandedSub={onToggleExpandedSub}
                />
              ) : (
                <SubagentRow
                  key={child.key}
                  a={child}
                  expanded={expandedSubs.has(child.key)}
                  onToggle={() => onToggleExpandedSub(child.key)}
                  onSelect={onSelect}
                />
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function Fleet({ agents, activeApp, onSelect }: { agents: AgentCard[]; activeApp?: string; onSelect?: (a: AgentCard) => void }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const everLive = useRef(new Set<string>());
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const toggleExpandedSub = useCallback((key: string) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const { parents, childrenByParent } = useMemo(() => {
    const parents: AgentCard[] = [];
    const childrenByParent = new Map<string, AgentCard[]>();
    for (const a of agents) {
      if (a.parentKey) {
        const s = childrenByParent.get(a.parentKey) ?? [];
        s.push(a);
        childrenByParent.set(a.parentKey, s);
      } else {
        parents.push(a);
      }
    }
    for (const list of childrenByParent.values()) {
      list.sort((a, b) => RANK[a.status] - RANK[b.status] || b.lastSeen - a.lastSeen);
    }
    return { parents, childrenByParent };
  }, [agents]);

  const groups = useMemo(() => {
    const by = new Map<string, AgentCard[]>();
    for (const a of parents) {
      const g = by.get(a.source_app) ?? [];
      g.push(a);
      by.set(a.source_app, g);
    }
    return [...by.entries()]
      .map(([app, list]) => {
        list.sort((x, y) => (RANK[x.status] - RANK[y.status]) || y.lastSeen - x.lastSeen);
        const live = list.filter((a) => a.status !== "idle").length;
        const allChildren = list.flatMap((a) => childrenByParent.get(a.key) ?? []);
        const liveChildren = allChildren.filter((a) => a.status !== "idle").length;
        const subs = list.reduce((s, a) => s + a.subagents, 0) + allChildren.length;
        return { app, list, live: live + liveChildren, subs, lastSeen: Math.max(...list.map((a) => a.lastSeen), ...allChildren.map((a) => a.lastSeen), 0) };
      })
      .sort((a, b) => b.live - a.live || b.lastSeen - a.lastSeen);
  }, [parents, childrenByParent]);

  for (const { app, live } of groups) {
    if (live > 0) everLive.current.add(app);
  }
  const isCollapsed = (app: string, live: number, size: number) => {
    if (overrides[app] !== undefined) return overrides[app];
    if (everLive.current.has(app)) return false;
    return live === 0 && size > 2;
  };
  const toggle = (app: string, def: boolean) => setOverrides((o) => ({ ...o, [app]: !(o[app] ?? def) }));

  const parentCount = parents.length;
  const childCount = agents.length - parentCount;

  return (
    <Panel
      eyebrow="Sessions"
      title="Every agent session"
      right={
        activeApp ? (
          <span className="chip" style={{ color: "var(--primary-hover)", background: "color-mix(in srgb, var(--primary) 20%, transparent)", borderColor: "color-mix(in srgb, var(--primary) 55%, transparent)" }}>
            filtering: {activeApp}
          </span>
        ) : (
          <span className="text-[10px] t-dim2">{parentCount} live{childCount > 0 ? ` · ${childCount} sub` : ""} · {groups.length} projects</span>
        )
      }
    >
      <div className="overflow-auto h-full space-y-2.5 pr-1">
        {agents.length === 0 && <div className="t-dim2 text-[12px] text-center py-8 shimmer rounded-lg">waiting for agents…</div>}
        {groups.map(({ app, list, live, subs }) => {
          const collapsed = isCollapsed(app, live, list.length);
          const def = live === 0 && list.length > 2;
          return (
            <div key={app} className="space-y-2">
              <button
                onClick={() => toggle(app, def)}
                className="w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left"
                style={{ color: activeApp === app ? "var(--primary-hover)" : "var(--text2)" }}
              >
                <span className="text-[10px] t-dim2 transition-transform" style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}>▾</span>
                <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ letterSpacing: "0.06em" }}>{app}</span>
                {live > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--success)", boxShadow: "0 0 6px var(--success)" }} />}
                <span className="ml-auto flex items-center gap-2 text-[9.5px] t-dim2 tabular-nums">
                  {subs > 0 && <span style={{ color: "var(--info)" }}>⑃{subs}</span>}
                  <span>{list.length} session{list.length > 1 ? "s" : ""}</span>
                </span>
              </button>
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-2 overflow-hidden">
                    {list.map((a) => (
                      <SessionCard
                        key={a.key}
                        a={a}
                        selected={!!activeApp && a.source_app === activeApp}
                        onSelect={onSelect}
                        subChildren={childrenByParent.get(a.key) ?? []}
                        subExpanded={expandedCards.has(a.key)}
                        onToggleSubs={() => setExpandedCards((s) => { const n = new Set(s); n.has(a.key) ? n.delete(a.key) : n.add(a.key); return n; })}
                        expandedSubs={expandedSubs}
                        onToggleExpandedSub={toggleExpandedSub}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
