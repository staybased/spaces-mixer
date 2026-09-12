// Per-app audio tap daemon. Build: swiftc -O widget/spaces-tap.swift -o bin/spaces-tap
// Creates a CoreAudio process tap on every process belonging to the target app (by bundle id, including
// XPC children via the "responsible pid") and exposes it as a public aggregate INPUT device that OBS can
// capture. The tapped app keeps playing to its own output (muteBehavior .unmuted).
//   spaces-tap serve            → reads commands on stdin:  tap <bundleId> | untap | status
//                                  prints one JSON line per state change
import AppKit
import CoreAudio
import Foundation

let sys = AudioObjectID(kAudioObjectSystemObject)
let AGG_UID = "SpacesMixerTap_UID"
let AGG_NAME = "Spaces Mixer Tap"
/// OBS cannot read audio from a tap-only aggregate (silence), so the tapped audio is copied into this
/// ordinary virtual cable and OBS captures the cable instead.
let BRIDGE_UID = "BlackHole16ch_UID"

func deviceID(uid: String) -> AudioDeviceID? {
  var a = addr(kAudioHardwarePropertyDevices); var sz: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &sz) == noErr else { return nil }
  var ids = [AudioDeviceID](repeating: 0, count: Int(sz) / 4)
  AudioObjectGetPropertyData(sys, &a, 0, nil, &sz, &ids)
  for id in ids {
    var ua = addr(kAudioDevicePropertyDeviceUID); var ref: Unmanaged<CFString>? = nil; var us = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    if AudioObjectGetPropertyData(id, &ua, 0, nil, &us, &ref) == noErr, (ref?.takeUnretainedValue() as String?) == uid { return id }
  }
  return nil
}

func addr(_ s: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: s, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}
func json(_ obj: [String: Any]) -> String {
  let d = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]); return String(decoding: d, as: UTF8.self)
}
func emit(_ obj: [String: Any]) { print(json(obj)); fflush(stdout) }

// responsibility_get_pid_responsible_for_pid: private but stable; maps XPC children (Safari's GPU process) to their app.
typealias RespFn = @convention(c) (pid_t) -> pid_t
let respFn: RespFn? = {
  guard let h = dlopen(nil, RTLD_NOW), let sym = dlsym(h, "responsibility_get_pid_responsible_for_pid") else { return nil }
  return unsafeBitCast(sym, to: RespFn.self)
}()

struct ProcInfo { let obj: AudioObjectID; let pid: pid_t; let bundle: String }
func processObjects() -> [ProcInfo] {
  var a = addr(kAudioHardwarePropertyProcessObjectList); var sz: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &sz) == noErr else { return [] }
  var objs = [AudioObjectID](repeating: 0, count: Int(sz) / 4)
  AudioObjectGetPropertyData(sys, &a, 0, nil, &sz, &objs)
  return objs.compactMap { o in
    var pid: pid_t = 0; var ps = UInt32(4); var pa = addr(kAudioProcessPropertyPID)
    guard AudioObjectGetPropertyData(o, &pa, 0, nil, &ps, &pid) == noErr else { return nil }
    var ba = addr(kAudioProcessPropertyBundleID); var ref: Unmanaged<CFString>? = nil; var bs = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    let bid = AudioObjectGetPropertyData(o, &ba, 0, nil, &bs, &ref) == noErr ? (ref?.takeUnretainedValue() as String? ?? "") : ""
    return ProcInfo(obj: o, pid: pid, bundle: bid)
  }
}

/** Audio process objects that belong to the app: same bundle id, or responsible pid is one of the app's pids. */
func targets(for bundle: String) -> [ProcInfo] {
  let appPids = Set(NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == bundle }.map { $0.processIdentifier })
  return processObjects().filter { p in
    if p.bundle == bundle || appPids.contains(p.pid) { return true }
    if let f = respFn { let r = f(p.pid); return r != p.pid && appPids.contains(r) }
    return false
  }
}

final class Tapper {
  var bundle: String?
  var tapID = AudioObjectID(0)
  var aggID = AudioObjectID(0)
  var tappedObjs: [AudioObjectID] = []
  var tapUUID: UUID?
  var ioProc: AudioDeviceIOProcID?
  var bridged = false
  let diagnosticLock = NSLock()
  // Diagnostic writes are skipped on contention; the audio copy never waits for the main thread.
  var ioCalls = 0, inBufs = 0, inCh = 0, inBytes = 0, outBufs = 0, outCh = 0, outBytes = 0
  var inPeak: Float = 0, outPeak: Float = 0

  func teardown() {
    if aggID != 0 {
      if let p = ioProc { AudioDeviceStop(aggID, p); AudioDeviceDestroyIOProcID(aggID, p); ioProc = nil }
      AudioHardwareDestroyAggregateDevice(aggID); aggID = 0
    }
    if tapID != 0 { AudioHardwareDestroyProcessTap(tapID); tapID = 0 }
    tappedObjs = []; bridged = false
  }

  func status() -> [String: Any] {
    diagnosticLock.lock()
    defer { diagnosticLock.unlock() }
    return ["bundle": bundle ?? NSNull(), "processes": tappedObjs.count,
     "device": aggID != 0 ? (bridged ? BRIDGE_UID : AGG_UID) : NSNull(), "tapping": tapID != 0, "bridged": bridged,
     "io": ["calls": ioCalls, "in": [inBufs, inCh, inBytes], "out": [outBufs, outCh, outBytes],
            "inPeakDb": inPeak > 0 ? Double(20 * log10(inPeak)) : -120, "outPeakDb": outPeak > 0 ? Double(20 * log10(outPeak)) : -120]]
  }

  /** (Re)build the tap for the current bundle. Called on set and whenever the process list changes. */
  func rebuild(force: Bool = false) {
    guard let b = bundle else { return }
    let objs = targets(for: b).map { $0.obj }.sorted()
    if !force && objs == tappedObjs && aggID != 0 { return }
    teardown()
    guard !objs.isEmpty else { emit(status().merging(["note": "app has no audio processes yet"]) { $1 }); return }
    let desc = CATapDescription(stereoMixdownOfProcesses: objs)
    desc.name = "Spaces Mixer tap: \(b)"
    desc.isPrivate = false
    desc.muteBehavior = .unmuted
    var t = AudioObjectID(0)
    let st = AudioHardwareCreateProcessTap(desc, &t)
    guard st == noErr else { emit(["error": "create tap failed (\(st)). Allow system audio recording for this helper in Privacy & Security."]); return }
    tapID = t; tapUUID = desc.uuid
    let bridge = deviceID(uid: BRIDGE_UID)
    // Aggregate = the tap (input side) + the bridge cable (output side), clocked by the cable. One IO proc copies in → out.
    let subDevices: [[String: Any]] = bridge != nil ? [[kAudioSubDeviceUIDKey: BRIDGE_UID]] : []
    let tapList: [[String: Any]] = [[kAudioSubTapUIDKey: desc.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]]
    var aggDesc: [String: Any] = [:]
    aggDesc[kAudioAggregateDeviceNameKey] = AGG_NAME
    aggDesc[kAudioAggregateDeviceUIDKey] = AGG_UID
    aggDesc[kAudioAggregateDeviceIsPrivateKey] = bridge != nil
    aggDesc[kAudioAggregateDeviceIsStackedKey] = false
    aggDesc[kAudioAggregateDeviceTapAutoStartKey] = true
    aggDesc[kAudioAggregateDeviceSubDeviceListKey] = subDevices
    aggDesc[kAudioAggregateDeviceTapListKey] = tapList
    if bridge != nil { aggDesc[kAudioAggregateDeviceMainSubDeviceKey] = BRIDGE_UID }
    var agg = AudioObjectID(0)
    let st2 = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &agg)
    guard st2 == noErr else { emit(["error": "create aggregate failed (\(st2))"]); AudioHardwareDestroyProcessTap(tapID); tapID = 0; return }
    aggID = agg
    if bridge != nil {
      var pid: AudioDeviceIOProcID?
      let block: AudioDeviceIOBlock = { [unowned self] _, inData, _, outData, _ in
        let ins = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
        let outs = UnsafeMutableAudioBufferListPointer(outData)
        let diagnostics = self.diagnosticLock.try()
        defer { if diagnostics { self.diagnosticLock.unlock() } }
        if diagnostics { self.ioCalls += 1; self.inBufs = ins.count; self.outBufs = outs.count }
        // The aggregate's input side carries BOTH the bridge cable's own (silent) input stream and the tap.
        // The tap is the stereo mixdown; the cable is 16ch. Pick the tap buffer explicitly.
        let tapBuf: AudioBuffer? = ins.first(where: { $0.mNumberChannels == 2 }) ?? (ins.count > 1 ? ins[ins.count - 1] : ins.first)
        if diagnostics, let f = tapBuf { self.inCh = Int(f.mNumberChannels); self.inBytes = Int(f.mDataByteSize)
          if let p = f.mData?.assumingMemoryBound(to: Float.self) { let n = Int(f.mDataByteSize) / 4; var m: Float = 0; for i in 0..<n { m = max(m, abs(p[i])) }; self.inPeak = max(self.inPeak * 0.999, m) } }
        if diagnostics, let f = outs.first { self.outCh = Int(f.mNumberChannels); self.outBytes = Int(f.mDataByteSize) }
        defer { if diagnostics, let f = outs.first, let p = f.mData?.assumingMemoryBound(to: Float.self) { let n = Int(f.mDataByteSize) / 4; var m: Float = 0; for i in 0..<n { m = max(m, abs(p[i])) }; self.outPeak = max(self.outPeak * 0.999, m) } }
        // zero the cable first, then copy tap channels 0..1 into cable channels 0..1 (buffers may be interleaved or not)
        for o in outs { if let d = o.mData { memset(d, 0, Int(o.mDataByteSize)) } }
        guard let i0 = tapBuf, let src = i0.mData?.assumingMemoryBound(to: Float.self), let o0 = outs.first, let dst = o0.mData?.assumingMemoryBound(to: Float.self) else { return }
        let inCh = Int(i0.mNumberChannels), outCh = Int(o0.mNumberChannels)
        let frames = min(Int(i0.mDataByteSize) / 4 / max(inCh, 1), Int(o0.mDataByteSize) / 4 / max(outCh, 1))
        if inCh >= 2 && outCh >= 2 {
          for f in 0..<frames { dst[f * outCh] = src[f * inCh]; dst[f * outCh + 1] = src[f * inCh + 1] }
        } else if inCh == 1 && outCh >= 2 {
          for f in 0..<frames { dst[f * outCh] = src[f]; dst[f * outCh + 1] = src[f] }
        } else {
          memcpy(dst, src, min(Int(i0.mDataByteSize), Int(o0.mDataByteSize)))
        }
      }
      let st3 = AudioDeviceCreateIOProcIDWithBlock(&pid, aggID, nil, block)
      if st3 == noErr, let p = pid, AudioDeviceStart(aggID, p) == noErr { ioProc = p; bridged = true }
      else {
        if let p = pid { AudioDeviceDestroyIOProcID(aggID, p) }
        emit(["error": "bridge IO proc failed (\(st3)); music sharing unavailable"])
      }
    } else {
      emit(["note": "BlackHole 16ch not found; exposing the raw tap device (OBS may read silence from it)"])
    }
    tappedObjs = objs
    emit(status())
  }
}

let tapper = Tapper()
// Re-evaluate when audio processes come and go (app launched, quit, new helper spawned).
var pl = addr(kAudioHardwarePropertyProcessObjectList)
AudioObjectAddPropertyListenerBlock(sys, &pl, .main) { _, _ in tapper.rebuild() }
// Polling backstop: the process-list notification is not delivered for every change.
Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
  tapper.rebuild()
  if tapper.tapID != 0 { emit(tapper.status()) } // keeps io counters/levels fresh for the dashboard
}

// CoreAudio teardown is not async-signal-safe. Dispatch it on the main queue.
let shutdownSignals = [SIGTERM, SIGINT, SIGHUP].map { number -> DispatchSourceSignal in
  signal(number, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
  source.setEventHandler { tapper.teardown(); exit(0) }
  source.resume()
  return source
}

let stdinThread = Thread {
  while let line = readLine() {
    let parts = line.trimmingCharacters(in: .whitespaces).split(separator: " ", maxSplits: 1).map(String.init)
    DispatchQueue.main.async {
      switch parts.first ?? "" {
      case "tap":
        guard parts.count == 2, !parts[1].isEmpty else { emit(["error": "usage: tap <bundleId>"]); return }
        tapper.bundle = parts[1]; tapper.rebuild(force: true)
      case "untap": tapper.bundle = nil; tapper.teardown(); emit(tapper.status())
      case "status": emit(tapper.status())
      default: emit(["error": "unknown command"])
      }
    }
  }
  DispatchQueue.main.async { tapper.teardown(); exit(0) } // parent closed the pipe
}
stdinThread.start()
emit(["ready": true, "device": AGG_UID])
RunLoop.main.run()
