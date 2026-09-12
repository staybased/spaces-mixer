// System audio helper. Build: swiftc -O widget/sysvol.swift -o bin/sysvol
//   sysvol get            → {"volume":0.62,"muted":false,"device":"..."}
//   sysvol set 0.62       → sets default output volume (0..1)
//   sysvol mute 1|0       → sets default output mute
//   sysvol watch          → streams a JSON line on every volume/mute/default-device change
//   sysvol devices        → [{"name":..,"uid":..,"input":true,"output":false}, ...]
//   sysvol output <uid>   → select the Mac's physical default output, verified by readback
import CoreAudio
import Foundation

let sys = AudioObjectID(kAudioObjectSystemObject)
let VIRTUAL_MAIN_VOLUME = AudioObjectPropertySelector(0x766d_7663) // 'vmvc'

func addr(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func defaultOutput() -> AudioDeviceID {
  var id = AudioDeviceID(0); var sz = UInt32(MemoryLayout<AudioDeviceID>.size); var a = addr(kAudioHardwarePropertyDefaultOutputDevice)
  AudioObjectGetPropertyData(sys, &a, 0, nil, &sz, &id); return id
}
func str(_ dev: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String {
  var a = addr(sel); var ref: Unmanaged<CFString>? = nil; var sz = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(dev, &a, 0, nil, &sz, &ref) == noErr, let r = ref else { return "" }
  return r.takeUnretainedValue() as String
}
func hasStreams(_ dev: AudioDeviceID, _ scope: AudioObjectPropertyScope) -> Bool {
  var a = addr(kAudioDevicePropertyStreams, scope); var sz: UInt32 = 0
  return AudioObjectGetPropertyDataSize(dev, &a, 0, nil, &sz) == noErr && sz > 0
}
func allDevices() -> [AudioDeviceID] {
  var a = addr(kAudioHardwarePropertyDevices); var sz: UInt32 = 0
  AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &sz)
  var ids = [AudioDeviceID](repeating: 0, count: Int(sz) / MemoryLayout<AudioDeviceID>.size)
  AudioObjectGetPropertyData(sys, &a, 0, nil, &sz, &ids); return ids
}
func virtualDevice(_ dev: AudioDeviceID) -> Bool {
  var a = addr(kAudioDevicePropertyTransportType); var transport: UInt32 = 0; var sz = UInt32(4)
  guard AudioObjectGetPropertyData(dev, &a, 0, nil, &sz, &transport) == noErr else { return true }
  return transport == kAudioDeviceTransportTypeVirtual || transport == kAudioDeviceTransportTypeAggregate
}
func physicalOutput(_ dev: AudioDeviceID) -> Bool {
  let label = str(dev, kAudioObjectPropertyName) + " " + str(dev, kAudioDevicePropertyDeviceUID)
  return hasStreams(dev, kAudioDevicePropertyScopeOutput) && !virtualDevice(dev)
    && label.range(of: "blackhole|loopback|soundflower|spaces.?mixer.?tap", options: [.regularExpression, .caseInsensitive]) == nil
}
func setOutput(_ uid: String) -> Bool {
  guard var dev = allDevices().first(where: { str($0, kAudioDevicePropertyDeviceUID) == uid && physicalOutput($0) }) else { return false }
  var a = addr(kAudioHardwarePropertyDefaultOutputDevice)
  guard AudioObjectSetPropertyData(sys, &a, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &dev) == noErr else { return false }
  for _ in 0..<20 {
    if defaultOutput() == dev { return true }
    Thread.sleep(forTimeInterval: 0.025)
  }
  return false
}
func json(_ obj: Any) -> String {
  let d = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]); return String(decoding: d, as: UTF8.self)
}
func state() -> String {
  let dev = defaultOutput()
  var v: Float32 = 0; var vs = UInt32(4); var va = addr(VIRTUAL_MAIN_VOLUME, kAudioDevicePropertyScopeOutput)
  let okV = AudioObjectGetPropertyData(dev, &va, 0, nil, &vs, &v) == noErr
  var m: UInt32 = 0; var ms = UInt32(4); var ma = addr(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput)
  let okM = AudioObjectGetPropertyData(dev, &ma, 0, nil, &ms, &m) == noErr
  return json(["volume": okV ? (Double((v * 1000).rounded()) / 1000) as Any : NSNull(), "muted": okM ? (m != 0) as Any : NSNull(), "device": str(dev, kAudioObjectPropertyName), "uid": str(dev, kAudioDevicePropertyDeviceUID)])
}
func setVolume(_ x: Float32, _ uid: String) -> Bool {
  let dev = defaultOutput()
  guard str(dev, kAudioDevicePropertyDeviceUID) == uid, physicalOutput(dev) else { return false }
  var v = max(0, min(1, x)); var a = addr(VIRTUAL_MAIN_VOLUME, kAudioDevicePropertyScopeOutput)
  return AudioObjectSetPropertyData(dev, &a, 0, nil, 4, &v) == noErr
}
func setMute(_ on: Bool, _ uid: String) -> Bool {
  let dev = defaultOutput()
  guard str(dev, kAudioDevicePropertyDeviceUID) == uid, physicalOutput(dev) else { return false }
  var m: UInt32 = on ? 1 : 0; var a = addr(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput)
  return AudioObjectSetPropertyData(dev, &a, 0, nil, 4, &m) == noErr
}

let args = CommandLine.arguments.dropFirst()
switch args.first ?? "get" {
case "get": print(state())
case "devices":
  let list: [[String: Any]] = allDevices().map { d in
    ["name": str(d, kAudioObjectPropertyName), "uid": str(d, kAudioDevicePropertyDeviceUID),
     "input": hasStreams(d, kAudioDevicePropertyScopeInput), "output": hasStreams(d, kAudioDevicePropertyScopeOutput), "virtual": virtualDevice(d)]
  }
  print(json(list))
case "set":
  guard let s = args.dropFirst().first, let f = Float32(s), f.isFinite, let uid = args.dropFirst(2).first else { fputs("usage: sysvol set 0..1 <uid>\n", stderr); exit(2) }
  exit(setVolume(f, uid) ? 0 : 1)
case "mute":
  guard let s = args.dropFirst().first, ["0", "1"].contains(s), let uid = args.dropFirst(2).first else { exit(2) }
  exit(setMute(s == "1", uid) ? 0 : 1)
case "output":
  guard let uid = args.dropFirst().first, setOutput(uid) else { fputs("Could not select the physical output device\n", stderr); exit(1) }
  print(state())
case "watch":
  setvbuf(stdout, nil, _IOLBF, 0)
  var listening: AudioDeviceID = 0
  let emit: AudioObjectPropertyListenerBlock = { _, _ in print(state()) }
  func listen(_ dev: AudioDeviceID) {
    var va = addr(VIRTUAL_MAIN_VOLUME, kAudioDevicePropertyScopeOutput); var ma = addr(kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput)
    if listening != 0 {
      AudioObjectRemovePropertyListenerBlock(listening, &va, .main, emit)
      AudioObjectRemovePropertyListenerBlock(listening, &ma, .main, emit)
    }
    AudioObjectAddPropertyListenerBlock(dev, &va, .main, emit)
    AudioObjectAddPropertyListenerBlock(dev, &ma, .main, emit)
    listening = dev
  }
  var da = addr(kAudioHardwarePropertyDefaultOutputDevice)
  AudioObjectAddPropertyListenerBlock(sys, &da, .main) { _, _ in listen(defaultOutput()); print(state()) }
  var la = addr(kAudioHardwarePropertyDevices)
  AudioObjectAddPropertyListenerBlock(sys, &la, .main) { _, _ in print(state()) } // device plugged/unplugged
  listen(defaultOutput())
  print(state())
  RunLoop.main.run()
default: fputs("usage: sysvol get|set <0..1> <uid>|mute <1|0> <uid>|output <uid>|watch|devices\n", stderr); exit(2)
}
