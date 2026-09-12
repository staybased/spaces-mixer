const DB_FLOOR = -60;
const DB_CEIL = 6;
const SEND_EVERY_MS = 40;
const STALE_AFTER_SEND_MS = 400;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const positionToDb = (p) => (p <= 0 ? null : DB_FLOOR + clamp(p, 0, 1) * (DB_CEIL - DB_FLOOR));
const dbToPosition = (db) => (db === null || db <= DB_FLOOR ? 0 : clamp((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR), 0, 1));
const formatDb = (db) => {
  if (db === null || db <= DB_FLOOR) return "-inf";
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}`;
};

const $ = (s, root = document) => root.querySelector(s);
if (new URLSearchParams(location.search).has("native")) document.body.classList.add("native");
const logEl = $("#log");
const log = (line, cls = "") => {
  const span = document.createElement("span");
  span.textContent = line + "\n";
  if (cls) span.className = cls;
  logEl.append(span);
  while (logEl.childElementCount > 100) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
  if (cls === "err") {
    $("#notice-text").textContent = line;
    $("#notice").hidden = false;
  }
};

const api = async (path, body) => {
  try {
    const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: "controller unreachable" } };
  }
};

/** Throttled sender with a guaranteed final flush: the last drag sample always lands. */
const makeSender = (send) => {
  let last, pending = false, timer = null, lastSentAt = 0, inFlight = false;
  const flush = () => {
    timer = null;
    if (!pending || inFlight) return;
    const v = last;
    pending = false;
    lastSentAt = Date.now();
    const result = send(v);
    if (result && typeof result.then === "function") {
      inFlight = true;
      const finished = () => { inFlight = false; if (pending && !timer) flush(); };
      result.then(finished, finished);
    }
  };
  return {
    push(v) { last = v; pending = true; if (!timer) timer = setTimeout(flush, SEND_EVERY_MS); },
    flush() { if (timer) clearTimeout(timer); flush(); },
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = false; },
    recentlySent: () => inFlight || pending || Date.now() - lastSentAt < STALE_AFTER_SEND_MS,
  };
};

const setAvailable = (el, available) => {
  el.classList.toggle("offline", !available);
  const fader = $(".fader", el);
  fader.setAttribute("aria-disabled", String(!available));
  fader.tabIndex = available ? 0 : -1;
  $(".mute", el).disabled = !available || el.dataset.mutePending === "true";
  if (!available) fader.classList.remove("dragging");
};

// ---- channel strips (dB) -------------------------------------------------------

const strips = {};
for (const el of document.querySelectorAll(".strip:not(.master)")) {
  const key = el.dataset.input;
  const fader = $(".fader", el), cap = $(".cap", fader), readout = $(".readout", el), mute = $(".mute", el);
  const bars = [...el.querySelectorAll(".meter .bar")];
  const strip = { available: false, el, fader, cap, readout, mute, bars, db: null, muted: false };
  strips[key] = strip;

  const render = () => {
    cap.style.setProperty("--pos", dbToPosition(strip.db));
    readout.innerHTML = strip.available ? `${formatDb(strip.db)}<small>dB</small>` : "—";
    fader.setAttribute("aria-valuenow", strip.db === null ? DB_FLOOR : Math.round(strip.db));
    fader.setAttribute("aria-valuetext", !strip.available ? "Unavailable" : strip.db === null ? "Silence" : `${formatDb(strip.db)} decibels`);
    mute.setAttribute("aria-pressed", String(strip.muted));
    mute.setAttribute("aria-label", `Mute ${key} to Space`);
    $("span", mute).textContent = strip.muted ? "Muted" : "Mute";
    el.classList.toggle("muted", strip.muted);
  };
  strip.render = render;
  strip.sender = makeSender(async (db) => {
    const r = await api("/api/volume", { input: key, db });
    if (!r.ok) log(`${key}: ${r.data.error ?? "volume not set"}`, "err");
  });
  const set = (db) => { if (!strip.available) return; strip.db = db; render(); strip.sender.push(db); };

  const dbFromPointer = (ev) => { const r = fader.getBoundingClientRect(); return positionToDb(1 - (ev.clientY - r.top) / r.height); };
  fader.addEventListener("pointerdown", (ev) => { if (!strip.available || ev.button !== 0) return; fader.setPointerCapture(ev.pointerId); fader.classList.add("dragging"); set(dbFromPointer(ev)); });
  fader.addEventListener("pointermove", (ev) => { if (fader.classList.contains("dragging")) set(dbFromPointer(ev)); });
  const stop = () => { if (!fader.classList.contains("dragging")) return; fader.classList.remove("dragging"); strip.sender.flush(); };
  fader.addEventListener("pointerup", stop);
  fader.addEventListener("pointercancel", stop);
  fader.addEventListener("lostpointercapture", stop);
  fader.addEventListener("keydown", (ev) => {
    if (!strip.available) return;
    const step = ev.shiftKey ? 5 : 1;
    const cur = strip.db ?? DB_FLOOR;
    if (ev.key === "ArrowUp") set(clamp(cur + step, DB_FLOOR, DB_CEIL));
    else if (ev.key === "ArrowDown") set(cur - step <= DB_FLOOR ? null : cur - step);
    else if (ev.key === "Home") set(0);
    else if (ev.key === "End") set(null);
    else return;
    ev.preventDefault();
    strip.sender.flush();
  });

  mute.addEventListener("click", async () => {
    if (!strip.available || el.dataset.mutePending === "true") return;
    const want = !strip.muted;
    el.dataset.mutePending = "true";
    mute.disabled = true;
    const r = await api("/api/mute", { input: key, muted: want });
    el.dataset.mutePending = "false";
    mute.disabled = !strip.available;
    if (!r.ok) { log(`${key}: mute failed — ${r.data.error ?? "no reply"}`, "err"); render(); return; }
    strip.muted = Boolean(r.data.muted);
    render();
  });
  render();
}

const applyState = (inputs) => {
  for (const key of Object.keys(strips)) {
    const strip = strips[key];
    const s = inputs?.[key] ?? { exists: false, volumeDb: null, muted: false };
    strip.available = Boolean(s.exists);
    setAvailable(strip.el, strip.available);
    if (!strip.available) strip.sender.cancel();
    if (strip.available && (strip.fader.classList.contains("dragging") || strip.sender.recentlySent())) continue;
    strip.db = s.volumeDb === null || s.volumeDb <= DB_FLOOR ? null : s.volumeDb;
    strip.muted = s.muted;
    strip.render();
  }
  const built = Object.values(strips).every((_, i) => inputs?.[Object.keys(strips)[i]]?.exists);
  setPill("#pill-sources", built);
  setStep("#step-sources", built);
};

const applyMeters = (levels) => {
  for (const [key, chans] of Object.entries(levels)) {
    const strip = strips[key];
    if (!strip) continue;
    strip.bars.forEach((bar, i) => bar.style.setProperty("--lvl", dbToPosition(chans[i] ?? chans[0] ?? DB_FLOOR).toFixed(3)));
  }
};

// ---- master (system output volume, mirrors the keyboard volume keys) -------------

let deviceBusy = false;
let deviceData = null;
let deviceRefreshBusy = false;
const masterEl = $(".strip.master");
const master = { available: false, fader: $(".fader", masterEl), cap: $(".cap", masterEl), readout: $(".readout", masterEl), mute: $(".mute", masterEl), vol: 0.5, muted: false, uid: null, muteAvailable: false };
const renderMaster = () => {
  master.cap.style.setProperty("--pos", clamp(master.vol, 0, 1));
  master.readout.innerHTML = master.available ? `${Math.round(master.vol * 100)}<small>%</small>` : "—";
  master.fader.setAttribute("aria-valuenow", Math.round(master.vol * 100));
  master.fader.setAttribute("aria-valuetext", master.available ? `${Math.round(master.vol * 100)} percent, local output` : "Unavailable");
  master.mute.setAttribute("aria-pressed", String(master.muted));
  master.mute.setAttribute("aria-label", "Mute local output only");
  $("span", master.mute).textContent = master.muted ? "Muted" : "Mute";
  masterEl.classList.toggle("muted", master.muted);
};
master.sender = makeSender(async ({ volume, deviceUid }) => {
  const r = await api("/api/master", { volume, deviceUid });
  if (!r.ok) log(`master: ${r.data.error ?? "not set"}`, "err");
});
const setMaster = (vol) => { if (!master.available) return; master.vol = clamp(vol, 0, 1); renderMaster(); master.sender.push({ volume: master.vol, deviceUid: master.uid }); };
const masterFromPointer = (ev) => { const r = master.fader.getBoundingClientRect(); return 1 - (ev.clientY - r.top) / r.height; };
master.fader.addEventListener("pointerdown", (ev) => { if (!master.available || ev.button !== 0) return; master.fader.setPointerCapture(ev.pointerId); master.fader.classList.add("dragging"); setMaster(masterFromPointer(ev)); });
master.fader.addEventListener("pointermove", (ev) => { if (master.fader.classList.contains("dragging")) setMaster(masterFromPointer(ev)); });
const stopMaster = () => { if (!master.fader.classList.contains("dragging")) return; master.fader.classList.remove("dragging"); master.sender.flush(); };
master.fader.addEventListener("pointerup", stopMaster);
master.fader.addEventListener("pointercancel", stopMaster);
master.fader.addEventListener("lostpointercapture", stopMaster);
master.fader.addEventListener("keydown", (ev) => {
  if (!master.available) return;
  const step = ev.shiftKey ? 0.1 : 1 / 16; // 1/16 = one press of the Mac volume key
  if (ev.key === "ArrowUp") setMaster(master.vol + step);
  else if (ev.key === "ArrowDown") setMaster(master.vol - step);
  else if (ev.key === "Home") setMaster(1);
  else if (ev.key === "End") setMaster(0);
  else return;
  ev.preventDefault();
  master.sender.flush();
});
master.mute.addEventListener("click", async () => {
  if (!master.muteAvailable || masterEl.dataset.mutePending === "true") return;
  const want = !master.muted;
  masterEl.dataset.mutePending = "true";
  master.mute.disabled = true;
  const deviceUid = master.uid;
  const r = await api("/api/master", { muted: want, deviceUid });
  masterEl.dataset.mutePending = "false";
  master.mute.disabled = !master.muteAvailable;
  if (master.uid !== deviceUid) return;
  if (!r.ok) { log(`master: mute failed — ${r.data.error ?? "no reply"}`, "err"); return; }
  master.muted = Boolean(r.data.master?.muted);
  renderMaster();
});
const applyMaster = (s) => {
  const changed = master.uid !== (s?.uid ?? null);
  if (changed) {
    master.sender.cancel();
    master.fader.classList.remove("dragging");
  }
  master.uid = s?.uid ?? null;
  if (deviceData && s?.uid) {
    deviceData = { ...deviceData, currentOutput: s };
    renderDeviceChoices();
  }
  const offline = !s || typeof s.volume !== "number" || !master.uid || deviceBusy;
  master.available = !offline;
  master.muteAvailable = Boolean(master.uid && typeof s?.muted === "boolean" && !deviceBusy);
  setAvailable(masterEl, !offline);
  master.mute.disabled = !master.muteAvailable || masterEl.dataset.mutePending === "true";
  if (offline) master.sender.cancel();
  $("#master-device").textContent = s?.device ? (offline ? "Use device volume" : "Local listening only") : "No output device";
  $("#master-device").title = s?.error ?? (s?.device ? `Mac output: ${s.device}. This changes the Mac's default listening device, not OBS's BlackHole output.` : "Connect speakers or headphones");
  if (!changed && !offline && (master.fader.classList.contains("dragging") || master.sender.recentlySent())) return;
  master.vol = typeof s?.volume === "number" ? s.volume : 0;
  master.muted = Boolean(s?.muted);
  renderMaster();
};
renderMaster();

// ---- status / chain panel -----------------------------------------------------------

const setPill = (sel, ok, warn = false) => {
  const el = $(sel);
  el.classList.toggle("ok", ok && !warn);
  el.classList.toggle("warn", Boolean(warn));
  el.classList.toggle("bad", !ok && !warn);
  el.setAttribute("aria-label", `${el.textContent.trim()}: ${warn ? "needs attention" : ok ? "ready" : "unavailable"}`);
};
const setStep = (sel, done, bad = false) => {
  const el = $(sel);
  el.classList.toggle("done", done);
  el.classList.toggle("bad", bad && !done);
};

let drawerAutoOpened = false;
let lastStatus = null;
async function refreshStatus() {
  const { ok, data } = await api("/api/status");
  if (!ok) { controllerOffline(); return; }
  lastStatus = data;
  renderSession(data.session);
  const cfgOk = data.config && !data.config.error && data.config.wsEnabled && data.config.monitoringConfigured;
  $("#lamp").classList.toggle("on", data.obsConnected);
  setPill("#pill-obs", data.obsConnected);
  $("#pill-obs").title = data.obsConnected ? "OBS connected" : (data.obsError || (data.obsRunning ? "OBS running, not connected" : "OBS not running"));
  setPill("#pill-monitor", data.outOk);
  $("#pill-monitor").title = data.outOk ? `OBS monitor output → ${data.monitorDevice.name}` : (data.blackholePresent ? `OBS monitor is ${data.config?.monitoring?.name ?? "?"} — click Prepare OBS` : "BlackHole 2ch is not installed");
  setStep("#step-obs", data.obsConnected && cfgOk && data.blackholePresent, (data.obsRunning && !cfgOk) || !data.blackholePresent);
  $("#btn-prepare").hidden = Boolean(cfgOk && data.obsRunning);
  $("#btn-setup").disabled = !data.obsConnected || busySetup || busyPrepare;
  applyState(data.obsConnected ? data.inputs : null);
  liveSource = data.live?.musicApp ?? liveSource;
  renderTrim(data.trim);
  applyMaster(data.master ?? (data.masterError ? { volume: null, error: data.masterError } : null));
  fillBrowsers(data.browsers);
  renderDeviceChoices();

  // live problems that leave the pills green but the Space silent
  const notes = [];
  if (!data.obsConnected) notes.push(data.obsError || "OBS disconnected — open Setup");
  if (data.live && !data.live.onOurScene) notes.push(`OBS is on "${data.live.collection} / ${data.live.scene}", not the Spaces mix — click Build mix`);
  if (data.live?.musicApp && data.live.musicAppRunning === false) notes.push("the music app is not running");
  else if (data.session?.state === "sharing" && data.tap && data.tap.helper && !data.tap.tapping) notes.push(data.tap.error ? `music tap: ${data.tap.error}` : "waiting for the music app to start playing");
  else if (data.tap && !data.tap.helper) notes.push("music tap helper missing — run ./start.sh");
  else if (data.live && data.live.musicDeviceOk === false) notes.push("music source is not on the tap device — click Build mix");
  if (data.live?.micPresent === false) notes.push("the selected mic is unplugged");
  if (data.obsConnected && data.singleBrowserRisk) notes.push("one browser open: put the Space in a different browser than the music");
  $("#chain-note").textContent = notes[0] ?? "";
  setPill("#pill-sources", Boolean(data.inputs?.music?.exists && data.inputs?.mic?.exists), notes.length > 0 && data.inputs?.music?.exists);

  if (!drawerAutoOpened && !data.obsConnected) { drawerAutoOpened = true; if (drawer.hidden) gear.click(); }
}

// Both pickers (strip + drawer) show the same list; the strip one shows the LIVE capture target.
let liveSource = null;
let setupSource = null;
let setupMic = null;
const GROUPS = { browser: "Browsers", player: "Players", other: "Other running apps" };
function fillSelect(sel, list, chosen, { shortNames = false } = {}) {
  const groups = {};
  for (const b of list) (groups[b.group ?? "other"] ??= []).push(b);
  const signature = JSON.stringify([list, shortNames]);
  if (sel.dataset.options !== signature) {
    sel.dataset.options = signature;
    sel.replaceChildren();
    for (const g of ["browser", "player", "other"]) {
      if (!groups[g]?.length) continue;
      const og = document.createElement("optgroup");
      og.label = GROUPS[g];
      for (const b of groups[g]) {
        const label = shortNames ? b.name.replace(/ Browser$/, "").replace(/^Google /, "") : b.name;
        og.append(new Option(label + (b.running ? "" : " (not running)"), b.bundleId));
      }
      sel.append(og);
    }
  }
  if (chosen && [...sel.options].some((o) => o.value === chosen)) sel.value = chosen;
}
function fillBrowsers(list) {
  if (!list) return;
  const drawerSel = $("#sel-app");
  if (document.activeElement !== drawerSel) fillSelect(drawerSel, list, setupSource || liveSource || safeGet("browser"));
  const stripSel = $("#sel-source");
  if (document.activeElement !== stripSel) fillSelect(stripSel, list, liveSource || stripSel.value, { shortNames: true });
  const live = list.find((b) => b.bundleId === liveSource);
  const tapping = Boolean(lastStatus?.tap?.tapping);
  strips.music.el.classList.toggle("source-stopped", Boolean(live && (!live.running || !tapping)));
  stripSel.title = live ? (!live.running ? `${live.name} is not running` : tapping ? `Tapping ${live.name} (${lastStatus.tap.processes} process${lastStatus.tap.processes === 1 ? "" : "es"})` : `${live.name} has no audio yet`) : "Pick the app that plays the music";
}
// the native dropdown can't be rebuilt while it is open; refresh its labels as soon as it closes
$("#sel-source").addEventListener("blur", () => { if (lastStatus) fillBrowsers(lastStatus.browsers); });
$("#sel-source").addEventListener("change", async (e) => {
  const bundleId = e.target.value;
  const r = await api("/api/source", { bundleId });
  if (!r.ok) { log(`source: ${r.data.error ?? "not switched"}`, "err"); await refreshStatus(); return; }
  liveSource = bundleId;
  safeSet("browser", bundleId);
  log(`music source → ${e.target.selectedOptions[0]?.textContent ?? bundleId}${r.data.running ? "" : " (not running)"}`, r.data.running ? "" : "warn");
  await refreshStatus();
});
// Preserve an unplugged selection instead of silently showing the first available device.
function fillDeviceSelect(sel, items, chosen, placeholder, force = false) {
  if (!force && document.activeElement === sel) return;
  const signature = JSON.stringify([items, chosen]);
  if (sel.dataset.options !== signature) {
    sel.dataset.options = signature;
    const options = items.map((d) => new Option(d.name, d.uid));
    if (!chosen || !items.some((d) => d.uid === chosen)) {
      const missing = new Option(chosen ? "Unavailable device" : placeholder, chosen || "");
      missing.disabled = true;
      options.unshift(missing);
    }
    sel.replaceChildren(...options);
  }
  sel.value = chosen || "";
}
function renderDeviceChoices(force = false) {
  if (!deviceData) return;
  const mics = (deviceData.mics ?? []).filter((d) => d.itemEnabled !== false).map((d) => ({ name: d.itemName, uid: d.itemValue }));
  const outputs = deviceData.outputs ?? [];
  const mic = $("#sel-mic-source"), output = $("#sel-output");
  if (!deviceBusy) {
    fillDeviceSelect(mic, mics, deviceData.currentMic, "Choose mic", force);
    fillDeviceSelect(output, outputs, deviceData.currentOutput?.uid, "Choose output", force);
    fillDeviceSelect($("#sel-mic"), mics, setupMic || deviceData.currentMic || safeGet("mic"), "Choose mic");
  }
  mic.disabled = deviceBusy || !lastStatus?.obsConnected || lastStatus?.session?.state !== "stopped" || !mics.length;
  output.disabled = deviceBusy || !outputs.length;
  const micName = mics.find((d) => d.uid === deviceData.currentMic)?.name ?? "Selected mic unavailable";
  mic.title = `${micName}. Stop sharing to change the mic; the new mic stays muted.`;
  output.title = `Mac output: ${deviceData.currentOutput?.device || "none"}. Choose speakers or headphones. Uses this device's existing volume.`;
  strips.mic.el.classList.toggle("source-stopped", Boolean(deviceData.currentMic && !mics.some((d) => d.uid === deviceData.currentMic)));
}
async function refreshDevices(force = false) {
  if (deviceRefreshBusy) return;
  deviceRefreshBusy = true;
  try {
    const { ok, data } = await api("/api/devices");
    if (!ok) {
      $("#sel-mic-source").disabled = true;
      $("#sel-output").disabled = true;
      return;
    }
    deviceData = data;
    renderDeviceChoices(force);
    fillBrowsers(data.apps);
  } finally { deviceRefreshBusy = false; }
}
async function changeDevice(kind, deviceUid) {
  if (deviceBusy) return;
  deviceBusy = true;
  master.sender.cancel();
  master.fader.classList.remove("dragging");
  renderDeviceChoices();
  if (kind === "output") applyMaster(deviceData?.currentOutput);
  try {
    const r = await api("/api/device", { kind, deviceUid });
    if (!r.ok) log(`${kind}: ${r.data.error ?? "device not changed"}`, "err");
    else {
      if (kind === "mic") { setupMic = deviceUid; safeSet("mic", deviceUid); }
      log(kind === "mic" ? "Microphone changed · sharing stopped, mic muted" : "Mac output changed · device's existing volume retained");
    }
  } finally {
    deviceBusy = false;
    await refreshDevices(true);
    await refreshStatus();
  }
}
$("#sel-mic-source").addEventListener("change", (e) => changeDevice("mic", e.target.value));
$("#sel-output").addEventListener("change", (e) => changeDevice("output", e.target.value));
for (const id of ["#sel-mic-source", "#sel-output"]) $(id).addEventListener("blur", () => renderDeviceChoices());
const safeGet = (k) => { try { return localStorage.getItem(`sm:${k}`); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(`sm:${k}`, v); } catch {} };
$("#sel-app").addEventListener("change", (e) => { setupSource = e.target.value; safeSet("browser", setupSource); });
$("#sel-mic").addEventListener("change", (e) => { setupMic = e.target.value; safeSet("mic", setupMic); });

// ---- actions ----------------------------------------------------------------------------

const dlg = $("#dlg-quit");
let busySetup = false;
let busyPrepare = false;
async function prepare(force = false) {
  const btn = $("#btn-prepare");
  busyPrepare = true;
  btn.disabled = true;
  btn.textContent = "Preparing…";
  $("#btn-setup").disabled = true;
  log(force ? "quitting OBS, patching config, relaunching…" : "patching OBS config and launching…");
  try {
    const { ok, status, data } = await api("/api/obs/prepare", { force });
    if (status === 409 && data.needsQuit) return dlg.showModal();
    if (!ok) return log(data.error ?? "prepare failed", "err");
    for (const c of data.changed ?? []) log(`• ${c}`);
    log(data.launched ? "OBS launched. Waiting for WebSocket…" : "OBS did not start. Open it manually.", data.launched ? "" : "warn");
  } finally {
    busyPrepare = false;
    btn.disabled = false;
    btn.textContent = "Prepare OBS";
    await refreshStatus();
  }
}
$("#btn-prepare").addEventListener("click", () => prepare(false));
$("#dlg-cancel").addEventListener("click", () => dlg.close());
$("#dlg-go").addEventListener("click", () => { dlg.close(); prepare(true); });

$("#btn-setup").addEventListener("click", async () => {
  const btn = $("#btn-setup");
  busySetup = true;
  btn.disabled = true;
  btn.textContent = "Building…";
  $("#btn-prepare").disabled = true;
  log("building the mix in OBS…");
  try {
    const body = { browserBundleId: $("#sel-app").value, micDeviceUid: $("#sel-mic").value || undefined };
    const { ok, data } = await api("/api/setup", body);
    for (const l of data.log ?? []) log(`• ${l}`);
    for (const w of data.warnings ?? []) log(`! ${w}`, "warn");
    if (!ok) log(data.error ?? "setup failed", "err");
  } finally {
    busySetup = false;
    btn.textContent = "Build mix";
    $("#btn-prepare").disabled = false;
    await refreshStatus();
    await refreshDevices();
  }
});

// ---- music trim (pre-fader gain, auto by default) ------------------------------------------
const trimBtn = $("#btn-trim");
const renderTrim = (t) => {
  if (!t) return;
  const db = Number(t.db ?? 0);
  trimBtn.innerHTML = `<span>Trim ${db >= 0 ? "+" : ""}${db.toFixed(1)} dB</span><span>${t.auto ? "Auto level" : "Manual level"}</span>`;
  trimBtn.setAttribute("aria-pressed", String(Boolean(t.auto)));
};
trimBtn.addEventListener("click", async () => {
  const auto = trimBtn.getAttribute("aria-pressed") !== "true";
  const r = await api("/api/trim", { auto });
  if (r.ok) renderTrim(r.data.trim); else log(`trim: ${r.data.error ?? "failed"}`, "err");
});

// ---- setup drawer ------------------------------------------------------------------------

const drawer = $("#drawer");
const gear = $("#btn-gear");
const setDrawer = (open) => {
  drawer.hidden = !open;
  gear.setAttribute("aria-expanded", String(open));
  $(".strips").inert = open;
  $(".hint").inert = open;
  if (open) { refreshDevices(); $("#drawer-close").focus(); }
  else gear.focus();
};
gear.addEventListener("click", () => setDrawer(drawer.hidden));
$("#drawer-close").addEventListener("click", () => setDrawer(false));
$("#notice-close").addEventListener("click", () => { $("#notice").hidden = true; gear.focus(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !drawer.hidden) gear.click(); });

// ---- sharing lifecycle --------------------------------------------------------------
let sessionBusy = false;
function renderSession(session) {
  if (lastStatus) lastStatus = { ...lastStatus, session };
  renderDeviceChoices();
  const state = session?.state ?? "unverified";
  $("#session-state").textContent = session?.error ?? ({stopped:"Sharing stopped",sharing:"Sharing · unmute sources when ready",starting:"Starting…",stopping:"Stopping…",unverified:"Stop sharing to verify silence"}[state] ?? "Sharing state unconfirmed");
  $("#btn-start").disabled = sessionBusy || state !== "stopped";
  $("#btn-stop").disabled = sessionBusy;
  $("#btn-quit").disabled = sessionBusy;
}
async function sessionAction(action) {
  if (sessionBusy) return false;
  sessionBusy = true;
  renderSession(lastStatus?.session);
  try {
    const r = await api("/api/session", {action});
    if (!r.ok) { log(r.data.error ?? "Sharing action failed; verify destination mute", "err"); return false; }
    if (lastStatus) lastStatus = { ...lastStatus, session: r.data.session };
    renderSession(r.data.session);
    if (action === "quit") {
      $("#session-state").textContent = "Sharing stopped · controller closed";
      if (typeof window !== "undefined") window.webkit?.messageHandlers?.mixerStopped?.postMessage("stopped");
    } else await refreshStatus();
    return true;
  } finally { sessionBusy = false; renderSession(lastStatus?.session); }
}
$("#btn-start").addEventListener("click", () => sessionAction("start"));
$("#btn-stop").addEventListener("click", () => sessionAction("stop"));
$("#btn-quit").addEventListener("click", () => sessionAction("quit"));

// ---- live socket -------------------------------------------------------------------------------

function controllerOffline() {
  renderSession({state:"error",error:"Controller disconnected · verify destination mute"});
  deviceData = null;
  $("#sel-mic-source").disabled = true;
  $("#sel-output").disabled = true;
  applyState(null);
  applyMaster(null);
  applyMeters({ music: [-60, -60], mic: [-60, -60] });
  $("#lamp").classList.remove("on");
  for (const pill of ["#pill-obs", "#pill-monitor", "#pill-sources"]) setPill(pill, false);
  $("#chain-note").textContent = "Controller disconnected · reconnecting…";
  $("#btn-setup").disabled = true;
}

function connectSocket() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (m) => {
    let msg;
    try {
      if (typeof m.data !== "string" || m.data.length > 1024 * 1024) throw new Error("invalid frame");
      msg = JSON.parse(m.data);
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") throw new Error("invalid frame");
    } catch { ws.close(); controllerOffline(); return; }
    try {
    if (msg.type === "session") renderSession(msg);
    else if (msg.type === "meters") applyMeters(msg.levels);
    else if (msg.type === "state") applyState(msg.inputs);
    else if (msg.type === "master") applyMaster(msg);
    else if (msg.type === "source") { liveSource = msg.bundleId; refreshStatus(); }
    else if (msg.type === "trim") renderTrim(msg);
    else if (msg.type === "tap") { if (lastStatus) { lastStatus = { ...lastStatus, tap: { ...(lastStatus.tap ?? {}), ...msg } }; fillBrowsers(lastStatus.browsers); } }
    else if (msg.type === "obs") { if (msg.error) log(msg.error, "warn"); refreshStatus(); if (msg.connected) refreshDevices(); }
    } catch { ws.close(); controllerOffline(); }
  };
  ws.onclose = () => { controllerOffline(); setTimeout(connectSocket, 1500); };
}
connectSocket();
refreshStatus();
refreshDevices();
setInterval(() => { refreshStatus(); refreshDevices(); }, 5000);
