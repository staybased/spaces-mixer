import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test.skipIf(process.platform === "win32")("failed helper build stops launch and preserves the old binary without using it",()=>{
  const dir=mkdtempSync(join(tmpdir(),"spaces-launch-test-"));
  try {
    for(const name of ["bin","widget","tools"])mkdirSync(join(dir,name));
    cpSync(join(import.meta.dir,"../start.sh"),join(dir,"start.sh"));
    writeFileSync(join(dir,"bin/sysvol"),"old binary",{mode:0o700});utimesSync(join(dir,"bin/sysvol"),0,0);
    writeFileSync(join(dir,"widget/sysvol.swift"),"new source");
    writeFileSync(join(dir,"tools/swiftc"),'#!/bin/sh\nexit 42\n',{mode:0o700});
    writeFileSync(join(dir,"tools/curl"),'#!/bin/sh\ntouch contacted-server\nexit 0\n',{mode:0o700});
    const r=spawnSync("bash",["start.sh"],{cwd:dir,env:{...process.env,PATH:join(dir,"tools")+":"+process.env.PATH},encoding:"utf8"});
    expect(r.status, JSON.stringify({stdout:r.stdout,stderr:r.stderr})).toBe(42);
    expect(readFileSync(join(dir,"bin/sysvol"),"utf8")).toBe("old binary");
    expect(readdirSync(join(dir,"bin"))).toEqual(["sysvol"]);
    expect(readdirSync(dir)).not.toContain("contacted-server");
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test.skipIf(process.platform === "win32")("controller survives launcher exit in its own process group", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spaces-launch-test-"));
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  let pid: number | undefined;
  try {
    for (const name of ["bin", "widget", "tools", "src"]) mkdirSync(join(dir, name));
    cpSync(join(import.meta.dir, "../start.sh"), join(dir, "start.sh"));
    cpSync(join(import.meta.dir, "../widget/Info.plist"), join(dir, "widget/Info.plist"));
    for (const name of ["sysvol", "spaces-tap", "SpacesWidget"]) {
      writeFileSync(join(dir, "widget", name + ".swift"), "unused");
      utimesSync(join(dir, "widget", name + ".swift"), 0, 0);
      writeFileSync(join(dir, "bin", name === "SpacesWidget" ? "spaces-widget" : name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    }
    writeFileSync(join(dir, "tools/open"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    writeFileSync(join(dir, "src/server.ts"), 'Bun.serve({hostname:"127.0.0.1",port:Number(process.env.PORT),fetch:()=>Response.json({session:{state:"stopped"},pid:process.pid})});');
    const result = spawnSync("bash", ["start.sh"], { cwd: dir, env: { ...process.env, PORT: String(port), TMPDIR: dir, PATH: join(dir, "tools") + ":" + process.env.PATH }, encoding: "utf8", timeout: 15000 });
    const state = await fetch(`http://127.0.0.1:${port}/api/status`).then(r => r.json());
    pid = state.pid;
    expect(result.status, result.stderr).toBe(0);
    expect(state.session.state).toBe("stopped");
    expect(Number(spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim())).toBe(pid);
  } finally {
    if (pid) { try { process.kill(pid, "SIGTERM"); } catch {} }
    rmSync(dir, { recursive: true, force: true });
  }
});
