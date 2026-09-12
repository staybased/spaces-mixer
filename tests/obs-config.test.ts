import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { activeProfileDir, enableWsConfig, iniGet, iniSet, patchMonitoring, readMonitoring, writeAtomic, wsConfigNeedsPatch } from "../src/obs-config";

const temporaryDirectories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "spaces-config-test-"));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, "config.json") };
}
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("atomic config content", () => {
  test("backs up the last complete value on repeated writes", () => {
    const { directory, path } = fixture();
    writeAtomic(path, "first");
    expect(existsSync(`${path}.spaces-mixer.bak`)).toBe(false);
    writeAtomic(path, "second");
    writeAtomic(path, "third");
    expect(readFileSync(path, "utf8")).toBe("third");
    expect(readFileSync(`${path}.spaces-mixer.bak`, "utf8")).toBe("second");
    expect(readdirSync(directory).sort()).toEqual(["config.json", "config.json.spaces-mixer.bak"]);
  });
  test("failed staging preserves both original and backup and cleans temporary files", () => {
    const { directory, path } = fixture();
    writeAtomic(path, "first");
    writeAtomic(path, "second");
    expect(() => writeAtomic(path, null as unknown as string)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("second");
    expect(readFileSync(`${path}.spaces-mixer.bak`, "utf8")).toBe("first");
    expect(readdirSync(directory).sort()).toEqual(["config.json", "config.json.spaces-mixer.bak"]);
  });
});

test.skipIf(process.platform !== "darwin")("atomic config drops inherited macOS ACL access from config and backup", () => {
  const { directory, path } = fixture();
  execFileSync("/bin/chmod", ["+a", "everyone allow read,execute,file_inherit,directory_inherit", directory]);
  writeFileSync(path, "private", { mode: 0o600 });
  expect(execFileSync("/bin/ls", ["-le", path], { encoding: "utf8" })).toContain("everyone inherited allow");
  writeAtomic(path, "updated");
  const listing = execFileSync("/bin/ls", ["-le", path, `${path}.spaces-mixer.bak`], { encoding: "utf8" });
  expect(listing).not.toMatch(/^\s*\d+: /m);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(statSync(`${path}.spaces-mixer.bak`).mode & 0o777).toBe(0o600);
  expect(readFileSync(`${path}.spaces-mixer.bak`, "utf8")).toBe("private");
  // The shared parent ACL is the user's policy; only our staging directory has its ACL stripped.
  expect(execFileSync("/bin/ls", ["-lde", directory], { encoding: "utf8" })).toContain("everyone allow");
});

// Windows ACL guarantees need a Windows implementation; POSIX modes/symlinks are tested on Mac/Linux.
describe.skipIf(process.platform === "win32")("atomic config filesystem safety", () => {
  test("config and pre-existing backup become 0600 under a permissive umask", () => {
    const { directory, path } = fixture();
    writeFileSync(path, "private", { mode: 0o600 });
    writeFileSync(`${path}.spaces-mixer.bak`, "old", { mode: 0o644 });
    chmodSync(`${path}.spaces-mixer.bak`, 0o644);
    const mask = process.umask(0);
    try { writeAtomic(path, "updated"); } finally { process.umask(mask); }
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(`${path}.spaces-mixer.bak`).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  });
  test("new directories and files are private", () => {
    const { directory } = fixture();
    const parent = join(directory, "nested");
    const mask = process.umask(0);
    try { writeAtomic(join(parent, "new.json"), "value"); } finally { process.umask(mask); }
    expect(statSync(parent).mode & 0o777).toBe(0o700);
    expect(statSync(join(parent, "new.json")).mode & 0o777).toBe(0o600);
  });
  for (const target of ["config", "backup"]) {
    for (const dangling of [false, true]) {
      test(`rejects ${dangling ? "dangling " : ""}${target} symlink without following it`, () => {
        const { path } = fixture();
        const victim = `${path}.victim`;
        if (!dangling) writeFileSync(victim, "untouched");
        if (target === "backup") writeFileSync(path, "original");
        const link = target === "config" ? path : `${path}.spaces-mixer.bak`;
        symlinkSync(victim, link);
        expect(() => writeAtomic(path, "new")).toThrow("unsafe config file");
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        if (!dangling) expect(readFileSync(victim, "utf8")).toBe("untouched");
        else expect(existsSync(victim)).toBe(false);
        if (target === "backup") expect(readFileSync(path, "utf8")).toBe("original");
      });
    }
    test(`rejects a hard-linked ${target}`, () => {
      const { path } = fixture();
      const victim = `${path}.victim`;
      writeFileSync(victim, "untouched");
      if (target === "backup") writeFileSync(path, "original");
      linkSync(victim, target === "config" ? path : `${path}.spaces-mixer.bak`);
      expect(() => writeAtomic(path, "new")).toThrow("unsafe config file");
      expect(readFileSync(victim, "utf8")).toBe("untouched");
    });
  }
  test("rejects a symlinked parent and group-writable parent", () => {
    const { directory } = fixture();
    const parent = join(directory, "actual");
    const link = join(directory, "alias");
    mkdirSync(parent, { mode: 0o700 });
    symlinkSync(parent, link);
    expect(() => writeAtomic(join(link, "config"), "new")).toThrow("unsafe config directory");
    chmodSync(parent, 0o770);
    expect(() => writeAtomic(join(parent, "config"), "new")).toThrow("unsafe config directory");
    expect(readdirSync(parent)).toEqual([]);
  });
});

const INI = `[General]
Name=Untitled

[Audio]
MonitoringDeviceId=default
MonitoringDeviceName=Default
SampleRate=48000

[Video]
BaseCX=1920
`;

describe("ini helpers", () => {
  test("iniGet reads only inside its section", () => {
    expect(iniGet(INI, "Audio", "SampleRate")).toBe("48000");
    expect(iniGet(INI, "Video", "SampleRate")).toBeUndefined();
    expect(iniGet(INI, "Nope", "x")).toBeUndefined();
  });
  test("iniSet replaces in place without touching other sections", () => {
    const out = iniSet(INI, "Audio", "SampleRate", "44100");
    expect(iniGet(out, "Audio", "SampleRate")).toBe("44100");
    expect(iniGet(out, "Video", "BaseCX")).toBe("1920");
    expect(out.split("[Audio]").length).toBe(2);
  });
  test("iniSet appends key and section when missing", () => {
    expect(iniGet(iniSet(INI, "Video", "BaseCY", "1080"), "Video", "BaseCY")).toBe("1080");
    expect(iniGet(iniSet("[General]\nA=1\n", "Audio", "X", "y"), "Audio", "X")).toBe("y");
    expect(iniGet(iniSet("", "Audio", "X", "y"), "Audio", "X")).toBe("y");
  });
});

describe("monitoring", () => {
  test("read + patch", () => {
    expect(readMonitoring(INI)).toEqual({ id: "default", name: "Default" });
    expect(readMonitoring(patchMonitoring(INI, "BlackHole2ch_UID", "BlackHole 2ch"))).toEqual({ id: "BlackHole2ch_UID", name: "BlackHole 2ch" });
    expect(readMonitoring("")).toEqual({ id: "default", name: "Default" });
  });
});

describe("websocket config", () => {
  const base = { server_enabled: false, server_port: 4455, server_password: "test-password-only", auth_required: true };
  test("enable keeps a good existing password, returns a new object", () => {
    const out = enableWsConfig(base);
    expect(out).toMatchObject({ server_enabled: true, auth_required: true, server_password: base.server_password });
    expect(base.server_enabled).toBe(false);
  });
  test("enable forces auth and generates a password when missing or weak", () => {
    const out = enableWsConfig({ ...base, auth_required: false, server_password: "" }, () => "generated-pw-123");
    expect(out.auth_required).toBe(true);
    expect(out.server_password).toBe("generated-pw-123");
    expect(enableWsConfig({ ...base, server_password: "short" }, () => "gen").server_password).toBe("gen");
  });
  test("needsPatch", () => {
    expect(wsConfigNeedsPatch(base)).toBe(true);
    expect(wsConfigNeedsPatch({ ...base, server_enabled: true })).toBe(false);
    expect(wsConfigNeedsPatch({ ...base, server_enabled: true, auth_required: false })).toBe(true);
  });
  test("activeProfileDir prefers user.ini then global.ini then Untitled", () => {
    expect(activeProfileDir("[Basic]\nProfileDir=Studio\n", "[Basic]\nProfileDir=Old\n")).toBe("Studio");
    expect(activeProfileDir("", "[Basic]\nProfileDir=Old\n")).toBe("Old");
    expect(activeProfileDir("", "")).toBe("Untitled");
  });
});
