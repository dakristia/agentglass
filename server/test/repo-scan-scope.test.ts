// The repo sweep must never treat a filesystem root, the home directory, or the
// users container as a "code folder" to walk.
//
// The bug this guards (Windows): the old guard was a POSIX-only list, so `C:\`,
// `C:\Users` and `~` all slipped through. One Claude session run in `~` made the
// home dir a known project; its parent `C:\Users` then became a sweep base and
// `reposUnder` walked every user and descended into OneDrive — whose
// Files-On-Demand hydrates (downloads) placeholders the moment they're read.
//
// isTooBroadBase decides this structurally rather than by name, so the test is
// written against the real machine's home dir and works on any platform.
import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { dirname, parse, join } from "node:path";
import { isTooBroadBase } from "../src/gitwork.ts";

test("a filesystem / drive root is too broad", () => {
  expect(isTooBroadBase(parse(homedir()).root)).toBe(true); // C:\ on Windows, / elsewhere
});

test("the home directory itself is too broad", () => {
  // It holds OneDrive, AppData and caches — none of them projects.
  expect(isTooBroadBase(homedir())).toBe(true);
});

test("the users container is too broad", () => {
  // C:\Users, /home, /Users — the parent that holds every user's home.
  expect(isTooBroadBase(dirname(homedir()))).toBe(true);
});

test("classic unix system roots are too broad", () => {
  // These absolute paths only exist on POSIX; on Windows `resolve("/home")`
  // becomes `C:\home`, so the named-list check is meaningless there.
  if (process.platform === "win32") return;
  for (const p of ["/", "/home", "/mnt", "/usr", "/var", "/etc"]) {
    expect(isTooBroadBase(p)).toBe(true);
  }
});

test("a real code folder is not too broad", () => {
  expect(isTooBroadBase(join(homedir(), "source", "repos"))).toBe(false);
});

test("Windows drive roots are case-insensitive", () => {
  if (process.platform !== "win32") return;
  const root = parse(homedir()).root; // e.g. "C:\\"
  expect(isTooBroadBase(root.toLowerCase())).toBe(true);
  expect(isTooBroadBase(root.toUpperCase())).toBe(true);
});
