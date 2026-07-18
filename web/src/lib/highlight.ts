// Shiki syntax highlighting for the diff. One shared highlighter; themes and
// languages are loaded on demand (both are lazy dynamic imports so shiki's core
// + wasm + grammars + theme JSON stay out of the main dashboard bundle and only
// load when a diff is opened / a theme is picked).
//
// "nvim-style bold": most Neovim setups bold keywords / functions / types via
// treesitter. Shiki is TextMate-based and few themes bold those scopes, so when
// `bold` is on we clone the chosen theme and append a rule that bolds them —
// giving the same look on ANY theme. Themes' own italic/bold are always honored.
import type { Highlighter, ThemeRegistrationRaw } from "shiki";

// Lazy handle to the shiki module — imported once, shared by every helper, so
// the whole library is a single on-demand chunk.
let modP: Promise<typeof import("shiki")> | null = null;
const shiki = () => (modP ??= import("shiki"));

let hp: Promise<Highlighter> | null = null;
export function getHighlighter(): Promise<Highlighter> {
  if (!hp) hp = shiki().then((m) => m.createHighlighter({ themes: [], langs: [] }));
  return hp;
}

// --- theme catalog (Shiki bundled ids), mirroring the user's Neovim themes ----
export type ThemeChoice = { id: string; label: string; dark: boolean };
export const THEMES: ThemeChoice[] = [
  { id: "github-dark", label: "GitHub Dark", dark: true },
  { id: "catppuccin-macchiato", label: "Catppuccin Macchiato", dark: true },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", dark: true },
  { id: "catppuccin-frappe", label: "Catppuccin Frappé", dark: true },
  { id: "tokyo-night", label: "Tokyo Night", dark: true },
  { id: "kanagawa-wave", label: "Kanagawa Wave", dark: true },
  { id: "kanagawa-dragon", label: "Kanagawa Dragon", dark: true },
  { id: "rose-pine", label: "Rosé Pine", dark: true },
  { id: "rose-pine-moon", label: "Rosé Pine Moon", dark: true },
  { id: "everforest-dark", label: "Everforest Dark", dark: true },
  { id: "gruvbox-dark-medium", label: "Gruvbox Dark", dark: true },
  { id: "nord", label: "Nord", dark: true },
  { id: "dracula", label: "Dracula", dark: true },
  { id: "monokai", label: "Monokai", dark: true },
  { id: "one-dark-pro", label: "One Dark Pro", dark: true },
  { id: "vesper", label: "Vesper", dark: true },
  { id: "github-light", label: "GitHub Light", dark: false },
  { id: "catppuccin-latte", label: "Catppuccin Latte", dark: false },
  { id: "kanagawa-lotus", label: "Kanagawa Lotus", dark: false },
  { id: "rose-pine-dawn", label: "Rosé Pine Dawn", dark: false },
  { id: "everforest-light", label: "Everforest Light", dark: false },
  { id: "gruvbox-light-medium", label: "Gruvbox Light", dark: false },
];

// Scopes bolded when "bold" is on — keywords, function defs/calls, types/classes.
const BOLD_SCOPES = [
  "keyword", "keyword.control", "keyword.operator.new", "keyword.operator.expression",
  "storage.type", "storage.modifier",
  "entity.name.function", "entity.name.method", "support.function", "meta.function-call", "variable.function",
  "entity.name.type", "entity.name.class", "entity.other.inherited-class", "support.class", "support.type",
];

/** Clone a theme with a rule that bolds keyword/function/type scopes.
 *  Shiki reads `tokenColors` in preference to the legacy `settings` array, so
 *  we set tokenColors (seeded from whichever the theme provides) + our bold rule. */
function boldify(theme: ThemeRegistrationRaw, id: string): ThemeRegistrationRaw {
  const rules = theme.tokenColors ?? theme.settings ?? [];
  return {
    ...theme,
    name: `${id}-bold`,
    tokenColors: [...rules, { scope: BOLD_SCOPES, settings: { fontStyle: "bold" } }],
  };
}

const loadedThemes = new Set<string>();
/**
 * Ensure a theme is registered on the highlighter and return the theme *name*
 * to pass to codeToTokens. When `bold`, a boldified variant is registered under
 * `${id}-bold`. Idempotent; safe to call on every render.
 */
export async function ensureTheme(hl: Highlighter, id: string, bold: boolean): Promise<string> {
  const name = bold ? `${id}-bold` : id;
  if (loadedThemes.has(name)) return name;
  try {
    if (!bold) {
      await hl.loadTheme(id as never); // shiki resolves the bundled id string
    } else {
      const m = await shiki();
      const loader = (m.bundledThemes as Record<string, () => Promise<{ default: ThemeRegistrationRaw }>>)[id];
      const mod = loader ? await loader() : null;
      await hl.loadTheme((mod ? boldify(mod.default, id) : (id as never)) as never);
    }
    loadedThemes.add(name);
    return name;
  } catch {
    // Load failed — reuse any theme already registered so highlighting survives.
    return loadedThemes.size ? [...loadedThemes][0] : name;
  }
}

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "jsonc",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  kt: "kotlin", kts: "kotlin", swift: "swift", scala: "scala", dart: "dart",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", cs: "csharp",
  php: "php", css: "css", scss: "scss", sass: "sass", less: "less",
  html: "html", htm: "html", xml: "xml", svg: "xml", vue: "vue", svelte: "svelte", astro: "astro",
  md: "markdown", mdx: "mdx", markdown: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "fish",
  yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "proto",
  lua: "lua", r: "r", ex: "elixir", exs: "elixir", clj: "clojure",
  hs: "haskell", elm: "elm", ml: "ocaml", nim: "nim", zig: "zig",
};
export function langFromPath(path?: string): string | null {
  if (!path) return null;
  const base = (path.split("/").pop() || "").toLowerCase();
  if (base === "dockerfile") return "docker";
  if (base === "makefile") return "make";
  const dot = base.lastIndexOf(".");
  return (dot >= 0 ? EXT[base.slice(dot + 1)] : null) || null;
}

/** Resolve the "auto" theme from the app's current --bg luminance. */
export function shikiTheme(): "github-dark" | "github-light" {
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    const m = bg.match(/#?([0-9a-fA-F]{6})/);
    if (!m) return "github-dark";
    const n = parseInt(m[1], 16);
    const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return lum > 140 ? "github-light" : "github-dark";
  } catch {
    return "github-dark";
  }
}
