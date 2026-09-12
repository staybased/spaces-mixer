#!/usr/bin/env bash
# Build atomically, then open the local controller. Never continue with stale helpers after a failed build.
set -euo pipefail
umask 077
cd "$(dirname "$0")"
PORT="${PORT:-4780}"
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || { echo "PORT must be 1024..65535" >&2; exit 1; }
URL="http://127.0.0.1:$PORT"
mkdir -p bin
build_dir="$(mktemp -d bin/.build.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT
for name in sysvol spaces-tap SpacesWidget; do
  output="$name"
  [ "$name" != SpacesWidget ] || output=spaces-widget
  if [ ! -x "bin/$output" ] || [ "widget/$name.swift" -nt "bin/$output" ]; then
    echo "compiling ${output}..."
    swiftc -O "widget/$name.swift" -o "$build_dir/$output"
    mv "$build_dir/$output" "bin/$output"
  fi
done
if ! curl -sf --max-time 1 "$URL/api/status" >/dev/null 2>&1; then
  log_dir="$(mktemp -d "${TMPDIR:-/tmp}/spaces-mixer.XXXXXX")"
  # A separate session survives the launching terminal/process group closing.
  # nohup alone is insufficient for launchers that clean up their child group.
  server_pid="$(bun -e '
    const { spawn } = require("node:child_process");
    const { openSync, closeSync } = require("node:fs");
    const log = openSync(process.argv[1], "a", 0o600);
    const child = spawn(process.execPath, ["run", "src/server.ts"], { detached: true, stdio: ["ignore", log, log] });
    child.once("error", error => { console.error(error.message); process.exitCode = 1; });
    child.unref();
    closeSync(log);
    console.log(child.pid);
  ' "$log_dir/controller.log")"
  up=0
  for _ in $(seq 1 40); do
    kill -0 "$server_pid" 2>/dev/null || break
    if curl -sf --max-time 1 "$URL/api/status" >/dev/null 2>&1; then up=1; break; fi
    sleep 0.25
  done
  if [ "$up" = 0 ]; then
    echo "Controller did not start. Log: $log_dir/controller.log" >&2
    exit 1
  fi
fi
# A legacy controller must be stopped explicitly; never open a new UI onto an unsafe old process.
if ! curl -sf --max-time 2 "$URL/api/status" | bun -e 'const s=await new Response(Bun.stdin.stream()).json(); if(!s.session) process.exit(1);'; then
  echo "An older controller is running. Stop it while off-air, then run ./start.sh again." >&2
  exit 1
fi
app_dir="$PWD/bin/Spaces Mixer.app"
if [ ! -x "$app_dir/Contents/MacOS/spaces-widget" ] || [ bin/spaces-widget -nt "$app_dir/Contents/MacOS/spaces-widget" ] || [ widget/Info.plist -nt "$app_dir/Contents/Info.plist" ]; then
  mkdir -p "$app_dir/Contents/MacOS"
  cp bin/spaces-widget "$app_dir/Contents/MacOS/spaces-widget"
  cp widget/Info.plist "$app_dir/Contents/Info.plist"
fi
open -a "$app_dir" --args "$URL"
echo "Widget ready → $URL · sharing starts only when you choose Start sharing"
