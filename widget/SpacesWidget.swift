// Floating always-on-top widget window that hosts the Spaces Mixer dashboard.
// Build: swiftc -O widget/SpacesWidget.swift -o bin/spaces-widget
import Cocoa
import WebKit

let url = CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:4780"
let size = NSSize(width: 372, height: 500)

final class Delegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var panel: NSPanel!
    var web: WKWebView!
    var target: URL!
    var stopped = false

    func applicationDidFinishLaunching(_ note: Notification) {
        let rect = NSRect(origin: .zero, size: size)
        panel = NSPanel(
            contentRect: rect,
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel, .utilityWindow, .resizable],
            backing: .buffered, defer: false)
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.backgroundColor = NSColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.minSize = NSSize(width: 340, height: 440)
        panel.maxSize = NSSize(width: 480, height: 720)
        panel.setFrameAutosaveName("SpacesMixerWidget")
        panel.delegate = self
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "mixerStopped")
        web = WKWebView(frame: rect, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        panel.contentView = web
        let sep = url.contains("?") ? "&" : "?"
        guard let t = URL(string: url + sep + "native=1"),
              t.scheme == "http", ["127.0.0.1", "localhost"].contains(t.host ?? ""),
              let port = t.port, (1024...65535).contains(port), t.user == nil, t.password == nil,
              t.path.isEmpty || t.path == "/" else {
            fputs("bad url: \(url)\n", stderr)
            exit(2)
        }
        target = t
        web.load(URLRequest(url: target))

        if panel.frame.origin == .zero { panel.center() }
        panel.makeKeyAndOrderFront(nil)
    }

    private func local(_ candidate: URL?) -> Bool {
        guard let candidate, let target else { return false }
        return candidate.scheme == target.scheme && candidate.host == target.host && candidate.port == target.port && candidate.user == nil && candidate.password == nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(local(navigationAction.request.url) || navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
    }
    private func requestStop() {
        web.evaluateJavaScript("document.getElementById('btn-quit').click()") { _, error in
            if error != nil {
                let alert = NSAlert()
                alert.messageText = "Sharing stop could not be confirmed"
                alert.informativeText = "Mute the Space or OBS directly. Keep this window open and retry when the controller reconnects."
                alert.runModal()
            }
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { requestStop(); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if stopped { return .terminateNow }
        requestStop()
        return .terminateCancel
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == target.scheme,
              origin.host == target.host, origin.port == target.port,
              message.name == "mixerStopped", message.body as? String == "stopped" else { return }
        stopped = true
        NSApp.terminate(nil)
    }

    // Server not up yet, or restarted: retry instead of leaving a blank panel.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retry() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retry() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { retry() }
    private func retry() {
        let html = "<body style='margin:0;background:#17181b;color:#8a8d94;font:12px -apple-system;display:grid;place-items:center;height:100vh'>waiting for controller…</body>"
        web.loadHTMLString(html, baseURL: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self else { return }
            self.web.load(URLRequest(url: self.target))
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Delegate()
app.delegate = delegate
app.run()
