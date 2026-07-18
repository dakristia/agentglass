// Desktop-only capabilities.
//
// The same bundle runs in a browser tab and inside the Tauri window, so
// anything that needs the native shell has to be optional: detected at
// runtime, and imported only once we know the shell is there. The dynamic
// import keeps the plugin out of the browser's bundle entirely — Vite splits
// it into a chunk a plain tab never requests.

/** True when running inside the desktop app rather than a browser tab. */
export const IS_DESKTOP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type AutostartApi = {
  isEnabled: () => Promise<boolean>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

let cached: Promise<AutostartApi> | null = null;
function autostart(): Promise<AutostartApi> {
  cached ??= import("@tauri-apps/plugin-autostart");
  return cached;
}

/** Whether the app is set to launch at login. Null when not applicable (a
 *  browser tab) or when the shell refuses to answer — the caller renders
 *  nothing rather than guessing a state it can't verify. */
export async function autostartEnabled(): Promise<boolean | null> {
  if (!IS_DESKTOP) return null;
  try {
    return await (await autostart()).isEnabled();
  } catch {
    return null;
  }
}

/** Turn launch-at-login on or off; resolves to the state actually in effect. */
export async function setAutostart(on: boolean): Promise<boolean | null> {
  if (!IS_DESKTOP) return null;
  try {
    const api = await autostart();
    if (on) await api.enable();
    else await api.disable();
    return await api.isEnabled();
  } catch {
    return null;
  }
}
