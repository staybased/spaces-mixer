import type { RunningApp } from "./running-apps";

export type CaptureSource = { name: string; bundleId: string; running: boolean; group: "browser" | "player" | "other" };

export const KNOWN_BROWSERS: ReadonlyArray<{ name: string; bundleId: string }> = [
  { name: "Brave Browser", bundleId: "com.brave.Browser" },
  { name: "Google Chrome", bundleId: "com.google.Chrome" },
  { name: "Safari", bundleId: "com.apple.Safari" },
  { name: "Firefox", bundleId: "org.mozilla.firefox" },
  { name: "Arc", bundleId: "company.thebrowser.Browser" },
  { name: "Microsoft Edge", bundleId: "com.microsoft.edgemac" },
];

export const KNOWN_PLAYERS: ReadonlyArray<{ name: string; bundleId: string }> = [
  { name: "Spotify", bundleId: "com.spotify.client" },
  { name: "Music", bundleId: "com.apple.Music" },
  { name: "QuickTime Player", bundleId: "com.apple.QuickTimePlayerX" },
  { name: "VLC", bundleId: "org.videolan.vlc" },
  { name: "IINA", bundleId: "com.colliderli.iina" },
  { name: "TIDAL", bundleId: "com.tidal.desktop" },
  { name: "SoundCloud", bundleId: "com.soundcloud.desktop" },
];

const BROWSER_RE = /brave|chrome|safari|firefox|thebrowser|edgemac|opera|vivaldi|zen/i;
/** Background agents, helpers and system apps that can't sensibly be a music source. */
const HIDE_RE = /helper|renderer|plugin|\.app\.|^com\.apple\.(?!Safari$|Music$|QuickTimePlayerX$)|xpc|agent|daemon|updater|crashpad|loginwindow|dock|systemuiserver|controlcenter|notificationcenter|spotlight|finder|terminal|iterm|codex|claude|cursor|vscode|com\.microsoft\.VSCode|obsproject|spaces-widget/i;

/**
 * Everything the user could plausibly capture music from: known browsers and players (running or not,
 * so the list is stable), plus any other running app with a bundle id, grouped and deduped.
 */
export function captureCandidates(running: RunningApp[]): CaptureSource[] {
  const isRunning = (id: string) => running.some((a) => a.bundleId === id);
  const known = new Set<string>();
  const out: CaptureSource[] = [];
  for (const b of KNOWN_BROWSERS) {
    known.add(b.bundleId);
    out.push({ ...b, running: isRunning(b.bundleId), group: "browser" });
  }
  for (const p of KNOWN_PLAYERS) {
    known.add(p.bundleId);
    out.push({ ...p, running: isRunning(p.bundleId), group: "player" });
  }
  const seen = new Set<string>();
  for (const a of running) {
    if (known.has(a.bundleId) || seen.has(a.bundleId) || HIDE_RE.test(a.bundleId) || HIDE_RE.test(a.name)) continue;
    seen.add(a.bundleId);
    out.push({ name: a.name, bundleId: a.bundleId, running: true, group: BROWSER_RE.test(a.bundleId) ? "browser" : "other" });
  }
  return out;
}

export const runningBrowserCount = (sources: CaptureSource[]): number => sources.filter((s) => s.group === "browser" && s.running).length;
