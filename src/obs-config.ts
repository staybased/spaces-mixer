import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const OBS_DIR = join(homedir(), "Library", "Application Support", "obs-studio");
export const OBS_PROFILE = "Spaces Mixer";
export const PROFILE_DIRECTORY = "Spaces_Mixer";
export const MONITOR_DEVICE = { id: "BlackHole2ch_UID", name: "BlackHole 2ch" } as const;

export type WsConfig = {
  server_enabled: boolean;
  server_port: number;
  server_password: string;
  auth_required: boolean;
  [k: string]: unknown;
};

export const paths = {
  wsConfig: join(OBS_DIR, "plugin_config", "obs-websocket", "config.json"),
  userIni: join(OBS_DIR, "user.ini"),
  globalIni: join(OBS_DIR, "global.ini"),
  profilesDir: join(OBS_DIR, "basic", "profiles"),
};

// ---- pure helpers -------------------------------------------------------

export function iniGet(text: string, section: string, key: string): string | undefined {
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^\[(.+)\]\s*$/);
    if (head) {
      inSection = head[1] === section;
      continue;
    }
    if (!inSection) continue;
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv && kv[1].trim() === key) return kv[2];
  }
  return undefined;
}

export function iniSet(text: string, section: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start === -1) {
    const trimmed = text.replace(/\s+$/, "");
    return `${trimmed}${trimmed ? "\n\n" : ""}[${section}]\n${key}=${value}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\[.+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end);
  const idx = body.findIndex((l) => l.split("=")[0].trim() === key);
  const newBody = idx === -1 ? [...body, `${key}=${value}`] : body.map((l, i) => (i === idx ? `${key}=${value}` : l));
  return [...lines.slice(0, start + 1), ...newBody, ...lines.slice(end)].join("\n");
}

export function readMonitoring(iniText: string): { id: string; name: string } {
  return {
    id: iniGet(iniText, "Audio", "MonitoringDeviceId") ?? "default",
    name: iniGet(iniText, "Audio", "MonitoringDeviceName") ?? "Default",
  };
}

export function patchMonitoring(iniText: string, id: string, name: string): string {
  return iniSet(iniSet(iniText, "Audio", "MonitoringDeviceId", id), "Audio", "MonitoringDeviceName", name);
}

export const generatePassword = (): string => randomBytes(12).toString("base64url");

/** Enable the server AND make sure it is password-protected; OBS's listener is reachable from the LAN. */
export function enableWsConfig(cfg: WsConfig, newPassword: () => string = generatePassword): WsConfig {
  const password = cfg.server_password && cfg.server_password.length >= 8 ? cfg.server_password : newPassword();
  return { ...cfg, server_enabled: true, auth_required: true, server_password: password };
}

export function wsConfigNeedsPatch(cfg: WsConfig): boolean {
  return !cfg.server_enabled || !cfg.auth_required || !cfg.server_password || cfg.server_password.length < 8;
}

export function activeProfileDir(userIniText: string, globalIniText = ""): string {
  return iniGet(userIniText, "Basic", "ProfileDir") ?? iniGet(globalIniText, "Basic", "ProfileDir") ?? "Untitled";
}

// ---- filesystem wrappers ------------------------------------------------

const readText = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");

function ownedRegularFile(path: string): ReturnType<typeof lstatSync> | undefined {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error(`Refusing unsafe config file: ${path}`);
  }
  return stat;
}

/** Private backups and atomic replacement. Existing shared/writable directories are refused, not changed. */
export function writeAtomic(path: string, text: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = lstatSync(parent);
  if (!directory.isDirectory() || (process.getuid && (directory.uid !== process.getuid() || (directory.mode & 0o022) !== 0))) {
    throw new Error(`Refusing unsafe config directory: ${parent}`);
  }
  const backup = `${path}.spaces-mixer.bak`;
  const original = ownedRegularFile(path);
  ownedRegularFile(backup);
  // Same filesystem for atomic renames; mkdtemp creates an unpredictable, private directory.
  const staging = mkdtempSync(join(parent, ".spaces-mixer-"));
  try {
    // macOS ACLs can grant read access even when POSIX mode is 0600. Strip inherited entries from
    // our empty staging directory before writing secrets; leave existing OBS directories untouched.
    if (process.platform === "darwin") execFileSync("/bin/chmod", ["-N", staging], { stdio: "pipe" });
    if (original) {
      const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fstatSync(fd);
        if (opened.ino !== original.ino || opened.dev !== original.dev || opened.nlink !== 1) {
          throw new Error(`Config changed while preparing backup: ${path}`);
        }
        writeFileSync(join(staging, "backup"), readFileSync(fd), { flag: "wx", mode: 0o600 });
      } finally {
        closeSync(fd);
      }
    }
    writeFileSync(join(staging, "next"), text, { flag: "wx", mode: 0o600 });
    ownedRegularFile(path);
    ownedRegularFile(backup);
    if (original) renameSync(join(staging, "backup"), backup);
    renameSync(join(staging, "next"), path);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function readWsConfig(): WsConfig {
  const raw = readText(paths.wsConfig);
  if (!raw) throw new Error(`obs-websocket config not found at ${paths.wsConfig}. Launch OBS once first.`);
  return JSON.parse(raw) as WsConfig;
}

export function profileIniPath(): string {
  const dir = activeProfileDir(readText(paths.userIni), readText(paths.globalIni));
  if (!/^[A-Za-z0-9 _.-]+$/.test(dir) || dir === "." || dir === "..") throw new Error("Unsafe OBS profile directory");
  return join(paths.profilesDir, dir, "basic.ini");
}

export type ConfigStatus = {
  wsEnabled: boolean;
  wsAuth: boolean;
  wsPort: number;
  monitoring: { id: string; name: string };
  /** Config file points at BlackHole 2ch. Whether the device exists is checked separately. */
  monitoringConfigured: boolean;
};

export function readConfigStatus(): ConfigStatus {
  const ws = readWsConfig();
  const monitoring = readMonitoring(readText(profileIniPath()));
  return {
    wsEnabled: ws.server_enabled === true,
    wsAuth: ws.auth_required === true && Boolean(ws.server_password),
    wsPort: ws.server_port,
    monitoring,
    monitoringConfigured: monitoring.id === MONITOR_DEVICE.id,
  };
}

/** Patch both files on disk. Only call while OBS is NOT running, or OBS overwrites them on quit. */
export function applyConfigPatches(): { changed: string[] } {
  const changed: string[] = [];
  // Prepare owns only this dedicated profile. Never patch whichever unrelated profile is active.
  const iniPath = join(paths.profilesDir, PROFILE_DIRECTORY, "basic.ini");
  const ini = readText(iniPath);
  if (ini && iniGet(ini, "General", "Name") !== OBS_PROFILE) throw new Error("Reserved mixer profile directory belongs to another profile");
  const nextIni = patchMonitoring(iniSet(iniSet(ini, "General", "Name", OBS_PROFILE), "Audio", "SampleRate", "48000"), MONITOR_DEVICE.id, MONITOR_DEVICE.name);
  writeAtomic(iniPath, nextIni);
  changed.push("dedicated Spaces Mixer profile prepared");
  const collectionPath = join(OBS_DIR, "basic", "scenes", "Spaces_Mixer.json");
  const collection = readText(collectionPath);
  if (collection && JSON.parse(collection).name !== OBS_PROFILE) throw new Error("Reserved mixer collection file belongs to another collection");
  if (!collection) {
    writeAtomic(collectionPath, JSON.stringify({ name: OBS_PROFILE, sources: [], scene_order: [], current_scene: "", current_program_scene: "" }, null, 2));
    changed.push("empty dedicated Spaces Mixer collection created");
  }
  const ws = readWsConfig();
  // Explicit Prepare rotates credentials because a previous installation may have exposed its file.
  const next = { ...enableWsConfig(ws), server_password: generatePassword() };
  writeAtomic(paths.wsConfig, JSON.stringify(next, null, 4));
  // Keep the containing directory private too: OBS rewrites its file at launch with its own modes.
  // This is only called with OBS closed; never change another profile/collection.
  chmodSync(dirname(paths.wsConfig), 0o700);
  if (process.platform === "darwin") execFileSync("/bin/chmod", ["-N", dirname(paths.wsConfig)], { stdio: "pipe" });
  changed.push("WebSocket authentication rotated; credentials and backups restricted to this user");
  return { changed };
}
