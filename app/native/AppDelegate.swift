import Cocoa
import WebKit
import UserNotifications
import CoreLocation
import CoreWLAN
import EventKit

/// 界面语言跟系统走 / UI language follows the system
let diemIsChinese = (Locale.preferredLanguages.first ?? "en").hasPrefix("zh")
func L(_ zh: String, _ en: String) -> String { diemIsChinese ? zh : en }

/// 顶部这条透明视图专门用来拖窗口（做法同 Paper MD）。
/// WKWebView 会吃掉所有鼠标事件，`-webkit-app-region: drag` 在这里没用，
/// 所以在原生层盖一条视图，按下就 performDrag。页面顶部这 40pt 只放文字，不放按钮。
private final class WindowDragStrip: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
    override func mouseDown(with event: NSEvent) {
        guard let window = window else { return }
        if event.clickCount == 2 { window.performZoom(nil); return }
        window.performDrag(with: event)
    }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .arrow) }
}

private enum BridgeError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let t) = self { return t }; return nil }
}

/// 所有读写都限定在工作目录里。页面只能传相对路径。
private struct Workspace {
    let root: URL

    func resolve(_ relative: String) throws -> URL {
        guard !relative.isEmpty, !relative.hasPrefix("/"), !relative.contains("\\"),
              !relative.split(separator: "/").contains("..") else {
            throw BridgeError.message(L("路径必须在工作目录里：", "Path must stay inside the Diem folder: ") + relative)
        }
        return root.appendingPathComponent(relative)
    }

    func mtime(_ url: URL) -> Double? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let date = attrs[.modificationDate] as? Date else { return nil }
        return date.timeIntervalSince1970
    }

    /// 页面轮询用：列出工作目录里所有 .json / .md 的修改时间（跳过版本和隐藏目录）
    func stat() -> [String: Double] {
        var out: [String: Double] = [:]
        let keys: [URLResourceKey] = [.contentModificationDateKey, .isDirectoryKey]
        guard let e = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys,
                                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return out }
        let base = root.standardizedFileURL.path + "/"
        for case let url as URL in e {
            let path = url.standardizedFileURL.path
            guard path.hasPrefix(base) else { continue }
            let rel = String(path.dropFirst(base.count))
            if rel.hasPrefix("bin") || rel.hasPrefix("node_modules") { e.skipDescendants(); continue }
            guard ["json", "md", "jsonl", "html"].contains(url.pathExtension) else { continue }
            if let v = try? url.resourceValues(forKeys: Set(keys)), let d = v.contentModificationDate {
                out[rel] = d.timeIntervalSince1970
            }
        }
        return out
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate, UNUserNotificationCenterDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    /// 和 style.css 里的 --titlebar-h 必须一致
    fileprivate static let dragStripHeight: CGFloat = 40
    private let workspaceKey = "diem.workspace"

    private var workspace: Workspace { Workspace(root: workspaceURL) }

    /// 工作目录：选过就用选的；没选过就是 ~/Documents/Diem（第一次打开时拷一份示例进去）
    /// The Diem folder: the one you picked, or ~/Documents/Diem (seeded with an example on first launch)
    private var workspaceURL: URL {
        if let saved = UserDefaults.standard.string(forKey: workspaceKey) { return URL(fileURLWithPath: saved) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/Diem")
    }

    private let events = EKEventStore()
    /// 地点判断用：macOS 只在有定位权限时才给 Wi-Fi 名字
    private let location = CLLocationManager()

    func applicationDidFinishLaunching(_ notification: Notification) {
        prepareWorkspace(workspaceURL)
        buildMainMenu()
        UNUserNotificationCenter.current().delegate = self
        let contentController = WKUserContentController()
        contentController.addScriptMessageHandler(self, contentWorld: .page, name: "diem")
        contentController.addUserScript(WKUserScript(source: "window.DIEM_LANG = '\(diemIsChinese ? "zh" : "en")';",
                                                     injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = L("这一天", "Diem")
        window.minSize = NSSize(width: 980, height: 620)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(calibratedRed: 0.894, green: 0.902, blue: 0.863, alpha: 1)
        window.setFrameAutosaveName("DiemMain")

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900))
        container.autoresizingMask = [.width, .height]
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
        let strip = WindowDragStrip(frame: NSRect(x: 0, y: container.bounds.height - Self.dragStripHeight,
                                                  width: container.bounds.width, height: Self.dragStripHeight))
        strip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(strip, positioned: .above, relativeTo: webView)

        window.contentView = container
        if !window.setFrameUsingName("DiemMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        window.delegate = self
        NSApp.activate(ignoringOtherApps: true)

        guard let indexURL = Bundle.main.url(forResource: "index", withExtension: "html") else { return }
        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }

    /// diem://focus?paper=…&block=…：从别的 app（比如知新 Anew）跳回纸上那一块
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "diem" && url.host == "focus" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let paper = items.first { $0.name == "paper" }?.value ?? ""
            let block = items.first { $0.name == "block" }?.value ?? ""
            guard paper.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
                  block.range(of: "^[A-Za-z0-9_-]*$", options: .regularExpression) != nil else { continue }
            window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            focusWhenReady(paper, block, tries: 40)
        }
    }

    /// 刚被叫起来时页面还没开好：每 0.25 秒试一次，最多 10 秒
    private func focusWhenReady(_ paper: String, _ block: String, tries: Int) {
        guard tries > 0, let webView else { return }
        webView.evaluateJavaScript("window.__diem && window.__diem.focus ? (window.__diem.focus('\(paper)', '\(block)'), true) : false") { [weak self] result, _ in
            if (result as? Bool) != true {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self?.focusWhenReady(paper, block, tries: tries - 1) }
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    /// 关窗口前让页面把没写完的改动写掉
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        webView.evaluateJavaScript("window.__diem && window.__diem.flush()") { _, _ in
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // ────────── 页面 ↔ 文件 ──────────

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "bad message"); return
        }
        do {
            switch op {
            case "chooseWorkspace":
                chooseWorkspace(replyHandler)
                return
            case "calendarAccess":
                calendarAccess(replyHandler)
                return
            case "importPhoto":
                importPhoto(body["data"] as? String, replyHandler)
                return
            default:
                replyHandler(try handle(op, body), nil)
            }
        } catch {
            replyHandler(nil, error.localizedDescription)
        }
    }

    private func handle(_ op: String, _ body: [String: Any]) throws -> Any {
        let ws = workspace
        let fm = FileManager.default
        let path = body["path"] as? String ?? ""
        switch op {
        case "info":
            try fm.createDirectory(at: ws.root, withIntermediateDirectories: true)
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
            return ["workspace": ws.root.path, "version": version, "native": true]
        case "read":
            let url = try ws.resolve(path)
            guard let data = fm.contents(atPath: url.path) else { return NSNull() }
            return ["text": String(decoding: data, as: UTF8.self), "mtime": ws.mtime(url) ?? 0]
        case "write":
            let url = try ws.resolve(path)
            let text = body["text"] as? String ?? ""
            // expect：页面上次看到的修改时间。对不上说明外面（Claude Code / jot）改过，交给页面处理
            if let expect = body["expect"] as? Double {
                let now = ws.mtime(url)
                if expect < 0 ? now != nil : (now == nil || abs(now! - expect) > 0.0005) {
                    return ["ok": false, "conflict": true, "mtime": now ?? 0]
                }
            }
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: .atomic)
            return ["ok": true, "mtime": ws.mtime(url) ?? 0]
        case "data":
            // 笔记里的图：读成 data: 网址给页面显示
            let url = try ws.resolve(path)
            guard let data = fm.contents(atPath: url.path) else { return NSNull() }
            let types = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif", "heic": "image/heic", "svg": "image/svg+xml"]
            let mime = types[url.pathExtension.lowercased()] ?? "application/octet-stream"
            return "data:\(mime);base64,\(data.base64EncodedString())"
        case "append":
            let url = try ws.resolve(path)
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = Data((body["text"] as? String ?? "").utf8)
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                try data.write(to: url)
            }
            return ["ok": true, "mtime": ws.mtime(url) ?? 0]
        case "list":
            let url = try ws.resolve(path)
            let names = (try? fm.contentsOfDirectory(atPath: url.path)) ?? []
            return names.filter { !$0.hasPrefix(".") }.sorted().map { name -> [String: Any] in
                let child = url.appendingPathComponent(name)
                var isDir: ObjCBool = false
                fm.fileExists(atPath: child.path, isDirectory: &isDir)
                return ["name": name, "dir": isDir.boolValue, "mtime": ws.mtime(child) ?? 0]
            }
        case "stat":
            return ws.stat()
        case "reveal":
            let url = path.isEmpty ? ws.root : try ws.resolve(path)
            NSWorkspace.shared.activateFileViewerSelecting([url])
            return true
        case "trash":
            // 扔掉的纸：挪进系统废纸篓，还能从废纸篓里捡回来
            let url = try ws.resolve(path)
            guard fm.fileExists(atPath: url.path) else { return false }
            try fm.trashItem(at: url, resultingItemURL: nil)
            return true
        case "openPath":
            let url = try ws.resolve(path)
            // 笔记（.md）：装了知新 Anew 就在 Anew 里打开，没装用默认的编辑器
            if url.pathExtension.lowercased() == "md",
               let anew = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.anew.app") {
                NSWorkspace.shared.open([url], withApplicationAt: anew, configuration: NSWorkspace.OpenConfiguration())
            } else {
                NSWorkspace.shared.open(url)
            }
            return true
        case "copy":
            // 复制到系统剪贴板（给别的大模型窗口粘贴用）
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(body["text"] as? String ?? "", forType: .string)
            return true
        case "notify":
            // 喳喳的提醒：发一条 Mac 通知。第一次会问要不要允许
            let title = body["title"] as? String ?? "Diem"
            let text = body["text"] as? String ?? ""
            let id = body["id"] as? String ?? UUID().uuidString
            let center = UNUserNotificationCenter.current()
            center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                guard granted else { return }
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = text
                content.sound = .default
                center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
            }
            return true
        case "wifi":
            // 当前 Wi-Fi 名字。没有定位权限时先申请，这次返回 null
            let status = location.authorizationStatus
            if status == .notDetermined { location.requestWhenInUseAuthorization() }
            let ssid = CWWiFiClient.shared().interface()?.ssid()
            let auth = status == .authorizedAlways || status == .authorized ? "ok" : status == .notDetermined ? "asking" : "denied"
            return ["ssid": (ssid as Any?) ?? NSNull(), "auth": auth] as [String: Any]
        case "openURL":
            if let s = body["url"] as? String, let url = URL(string: s), ["http", "https"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
            return true
        case "calendar":
            return try syncCalendar(body)
        default:
            throw BridgeError.message(L("未知操作：", "Unknown op: ") + op)
        }
    }

    private func chooseWorkspace(_ reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = L("用这个文件夹", "Use this folder")
        panel.message = L("选一个文件夹做「这一天」的工作目录（Claude Code 也在这里工作）", "Pick a folder for Diem. Claude Code works here too.")
        panel.directoryURL = workspaceURL
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            if response == .OK, let url = panel.url {
                UserDefaults.standard.set(url.path, forKey: self.workspaceKey)
                self.prepareWorkspace(url)
                reply(url.path, nil)
            } else {
                reply(NSNull(), nil)
            }
        }
    }

    /// app 在前台时通知也要弹出来
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    /// 点通知：把窗口叫到前面
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            self.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        completionHandler()
    }

    // 页面里的外链用系统浏览器打开
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? ""),
           navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: L("好", "OK"))
        alert.addButton(withTitle: L("取消", "Cancel"))
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: L("好", "OK"))
        alert.runModal()
        completionHandler()
    }

    // ────────── 菜单 ──────────
    // 没有 NSMenu 的话，⌘C/⌘V/⌘Z 这些都不会派发。

    private func buildMainMenu() {
        let main = NSMenu()

        let name = L("这一天", "Diem")
        let appMenu = submenu(main, name)
        appMenu.addItem(withTitle: L("关于 这一天", "About Diem"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("隐藏 这一天", "Hide Diem"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("退出 这一天", "Quit Diem"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let file = submenu(main, L("文件", "File"))
        item(file, L("新的一张纸", "New Paper"), #selector(menuNewPaper), "n", [.command, .shift])
        item(file, L("给这张纸存一版", "Save a Version"), #selector(menuSaveVersion), "s")
        item(file, L("从照片导入一张手写纸…", "Import Handwritten Page…"), #selector(menuImportPhoto), "i", [.command, .shift])
        file.addItem(.separator())
        item(file, L("在访达中显示工作目录", "Show Folder in Finder"), #selector(menuReveal), "")
        item(file, L("换一个工作目录…", "Use Another Folder…"), #selector(menuChooseWorkspace), "")
        item(file, L("重新读取文件", "Reload Files"), #selector(menuReload), "r")

        let edit = submenu(main, L("编辑", "Edit"))
        item(edit, L("撤销", "Undo"), #selector(menuUndo), "z")
        item(edit, L("重做", "Redo"), #selector(menuRedo), "z", [.command, .shift])
        edit.addItem(.separator())
        edit.addItem(withTitle: L("剪切", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        item(edit, L("拷贝", "Copy"), #selector(menuCopy), "c")
        edit.addItem(withTitle: L("粘贴", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: L("全选", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let view = submenu(main, L("显示", "View"))
        item(view, L("摊开想", "Think"), #selector(menuThink), "1")
        item(view, L("摆今天", "Plan"), #selector(menuPlan), "2")
        view.addItem(.separator())
        item(view, L("收起 / 展开 纸", "Toggle Paper"), #selector(menuTogglePaper), "1", [.command, .option])
        item(view, L("收起 / 展开 池塘", "Toggle Pond"), #selector(menuToggleList), "2", [.command, .option])
        item(view, L("收起 / 展开 时间轴", "Toggle Timeline"), #selector(menuToggleTime), "3", [.command, .option])
        view.addItem(.separator())
        item(view, L("回到今天", "Go to Today"), #selector(menuToday), "t")

        let win = submenu(main, L("窗口", "Window"))
        win.addItem(withTitle: L("最小化", "Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: L("缩放", "Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")

        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }

    private func submenu(_ main: NSMenu, _ title: String) -> NSMenu {
        let holder = NSMenuItem()
        main.addItem(holder)
        let menu = NSMenu(title: title)
        holder.submenu = menu
        return menu
    }

    private func item(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String,
                      _ mods: NSEvent.ModifierFlags = [.command]) {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
        it.keyEquivalentModifierMask = mods
        it.target = self
        menu.addItem(it)
    }

    private func call(_ name: String) {
        webView.evaluateJavaScript("window.__diem && window.__diem.\(name)()", completionHandler: nil)
    }

    @objc private func menuNewPaper() { call("newPaper") }
    @objc private func menuSaveVersion() { call("saveVersion") }
    @objc private func menuReveal() { NSWorkspace.shared.activateFileViewerSelecting([workspaceURL]) }
    @objc private func menuChooseWorkspace() { call("chooseWorkspace") }
    @objc private func menuReload() { call("reload") }
    @objc private func menuUndo() { call("undo") }
    @objc private func menuCopy() { call("copy") }
    @objc private func menuRedo() { call("redo") }
    @objc private func menuThink() { call("think") }
    @objc private func menuPlan() { call("plan") }
    @objc private func menuTogglePaper() { call("togglePaper") }
    @objc private func menuToggleList() { call("toggleList") }
    @objc private func menuToggleTime() { call("toggleTime") }
    @objc private func menuToday() { call("today") }
    @objc private func menuImportPhoto() { call("importPhoto") }

    // ────────── 第一次打开：工作目录 ──────────

    /// 工作目录要有的东西：示例（只在空目录里放一次）、规则（CLAUDE.md / AGENTS.md）、bin/ 下的命令。
    /// Seeds the folder: an example (only into an empty folder), the rules for Claude Code, and the bin/ commands.
    private func prepareWorkspace(_ root: URL) {
        let fm = FileManager.default
        let res = Bundle.main.resourceURL!
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
        let empty = ((try? fm.contentsOfDirectory(atPath: root.path)) ?? []).filter { !$0.hasPrefix(".") }.isEmpty
        if empty { seedExample(into: root) }
        // 规则：带着「diem:managed」记号的是 app 放的，跟着 app 更新；你改过（删了记号）就不再动
        let rules = res.appendingPathComponent("workspace-rules")
        for name in (try? fm.contentsOfDirectory(atPath: rules.path)) ?? [] {
            let dst = root.appendingPathComponent(name)
            let mine = (try? String(contentsOf: dst, encoding: .utf8)) ?? ""
            if !fm.fileExists(atPath: dst.path) || mine.contains("diem:managed") {
                try? fm.removeItem(at: dst)
                try? fm.copyItem(at: rules.appendingPathComponent(name), to: dst)
            }
        }
        // bin/：记下来、日报这些命令，每次打开都换成 app 自带的这一版
        let bin = root.appendingPathComponent("bin")
        try? fm.createDirectory(at: bin, withIntermediateDirectories: true)
        for name in (try? fm.contentsOfDirectory(atPath: res.appendingPathComponent("bin").path)) ?? [] {
            let dst = bin.appendingPathComponent(name)
            try? fm.removeItem(at: dst)
            try? fm.copyItem(at: res.appendingPathComponent("bin/\(name)"), to: dst)
        }
    }

    /// 示例：文件名和内容里的 {{D0}}（今天）、{{S0}}（今天，不带横线）、{{TZ}}、{{TITLE_*}} 换成第一次打开的那天
    /// The example uses date tokens so its paper is always "today" on first launch.
    private func seedExample(into root: URL) {
        let fm = FileManager.default
        let example = Bundle.main.resourceURL!.appendingPathComponent("example-workspace/\(diemIsChinese ? "zh" : "en")")
        let now = Date(timeIntervalSinceNow: -5 * 3600)   // 和页面一样，凌晨 5 点前还算前一天
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"; let d0 = f.string(from: now)
        f.dateFormat = "yyyyMMdd"; let s0 = f.string(from: now)
        f.dateFormat = "xxx"; let tz = f.string(from: now)
        f.dateFormat = "EEE · MMM d"; let titleEn = f.string(from: now)
        let cal = Calendar.current
        let week = ["日", "一", "二", "三", "四", "五", "六"][cal.component(.weekday, from: now) - 1]
        let titleZh = "\(cal.component(.month, from: now))月\(cal.component(.day, from: now))日 周\(week)"
        let fill = { (t: String) in
            t.replacingOccurrences(of: "{{D0}}", with: d0).replacingOccurrences(of: "{{S0}}", with: s0)
                .replacingOccurrences(of: "{{TZ}}", with: tz).replacingOccurrences(of: "{{TITLE_EN}}", with: titleEn)
                .replacingOccurrences(of: "{{TITLE_ZH}}", with: titleZh)
        }
        guard let walk = fm.enumerator(at: example, includingPropertiesForKeys: [.isDirectoryKey]) else { return }
        let base = example.standardizedFileURL.path + "/"
        for case let url as URL in walk {
            let rel = String(url.standardizedFileURL.path.dropFirst(base.count))
            let dst = root.appendingPathComponent(fill(rel))
            if (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
                try? fm.createDirectory(at: dst, withIntermediateDirectories: true)
            } else if ["json", "md"].contains(url.pathExtension), let text = try? String(contentsOf: url, encoding: .utf8) {
                try? fill(text).write(to: dst, atomically: true, encoding: .utf8)
            } else {
                try? fm.copyItem(at: url, to: dst)
            }
        }
    }

    // ────────── 从照片导入 ──────────

    /// 照片存成 photos/日期-时间.jpg（长边不超过 2400，HEIC 也转成 JPEG，Claude Code 才读得了）
    private func importPhoto(_ base64: String?, _ reply: @escaping (Any?, String?) -> Void) {
        let save: (NSImage) -> Void = { [weak self] image in
            guard let self else { return }
            do { reply(try self.savePhoto(image), nil) } catch { reply(nil, error.localizedDescription) }
        }
        if let base64, let data = Data(base64Encoded: base64) {
            guard let image = NSImage(data: data) else { reply(nil, L("这张图打不开", "Couldn't open this image")); return }
            save(image)
            return
        }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.canChooseDirectories = false
        panel.prompt = L("导入", "Import")
        panel.message = L("选一张手写纸的照片", "Pick a photo of a handwritten page")
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { reply(NSNull(), nil); return }
            guard let image = NSImage(contentsOf: url) else { reply(nil, L("这张图打不开", "Couldn't open this image")); return }
            save(image)
        }
    }

    private func savePhoto(_ image: NSImage) throws -> String {
        guard let rep0 = image.representations.first else { throw BridgeError.message(L("这张图打不开", "Couldn't open this image")) }
        let w = CGFloat(rep0.pixelsWide > 0 ? rep0.pixelsWide : Int(image.size.width))
        let h = CGFloat(rep0.pixelsHigh > 0 ? rep0.pixelsHigh : Int(image.size.height))
        let scale = min(1, 2400 / max(w, h))
        let size = NSSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
            throw BridgeError.message(L("这张图打不开", "Couldn't open this image"))
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSColor.white.setFill()
        NSRect(origin: .zero, size: size).fill()
        image.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        guard let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.86]) else {
            throw BridgeError.message(L("存不下这张图", "Couldn't save this image"))
        }
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        let rel = "photos/\(f.string(from: Date())).jpg"
        let url = try workspace.resolve(rel)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try jpg.write(to: url, options: .atomic)
        return rel
    }

    // ────────── 写进系统日历 ──────────

    private func calendarAccess(_ reply: @escaping (Any?, String?) -> Void) {
        events.requestFullAccessToEvents { granted, error in
            DispatchQueue.main.async {
                if granted { reply(["ok": true], nil) }
                else {
                    reply(["ok": false, "message": error?.localizedDescription ?? L("没拿到日历权限：去「系统设置 › 隐私与安全性 › 日历」给 Diem 打开",
                                                                                     "No calendar access: turn Diem on in System Settings › Privacy & Security › Calendars")], nil)
                }
            }
        }
    }

    /// 找「Diem」日历，没有就建一个（有 iCloud 就建在 iCloud 上，iPhone 才看得到）
    private func diemCalendar() throws -> EKCalendar {
        if let c = events.calendars(for: .event).first(where: { $0.title == "Diem" && $0.allowsContentModifications }) { return c }
        let c = EKCalendar(for: .event, eventStore: events)
        c.title = "Diem"
        c.cgColor = NSColor(calibratedRed: 0.176, green: 0.369, blue: 0.227, alpha: 1).cgColor
        let sources = events.sources
        c.source = sources.first(where: { $0.sourceType == .calDAV && $0.title.lowercased().contains("icloud") })
            ?? events.defaultCalendarForNewEvents?.source
            ?? sources.first(where: { $0.sourceType == .local })
        try events.saveCalendar(c, commit: true)
        return c
    }

    /// 把 from–to 这段整段对齐：按 url（diem://item/<key>）对上，多的删、少的加、变了的改
    private func syncCalendar(_ body: [String: Any]) throws -> Any {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            return ["ok": false, "message": L("没有日历权限", "No calendar access")]
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let day = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"
        guard let fromS = body["from"] as? String, let toS = body["to"] as? String,
              let from = day.date(from: fromS), let to0 = day.date(from: toS) else { return ["ok": false] }
        let to = Calendar.current.date(byAdding: .day, value: 2, to: to0)!
        let alertMin = body["alertMin"] as? Int ?? 5
        let want = (body["events"] as? [[String: Any]]) ?? []
        let cal = try diemCalendar()
        let existing = events.events(matching: events.predicateForEvents(withStart: from, end: to, calendars: [cal]))
        var byKey: [String: EKEvent] = [:]
        for e in existing {
            if let u = e.url?.absoluteString, u.hasPrefix("diem://item/") { byKey[String(u.dropFirst(12)).removingPercentEncoding ?? String(u.dropFirst(12))] = e }
        }
        var seen = Set<String>()
        for w in want {
            guard let key = w["key"] as? String, let title = w["title"] as? String,
                  let s = (w["start"] as? String).flatMap({ iso.date(from: $0) }),
                  let e = (w["end"] as? String).flatMap({ iso.date(from: $0) }) else { continue }
            seen.insert(key)
            let ev = byKey[key] ?? EKEvent(eventStore: events)
            let done = w["done"] as? Bool ?? false
            if ev.calendar == nil { ev.calendar = cal }
            if ev.title == title && ev.startDate == s && ev.endDate == e && (ev.alarms?.count ?? 0) == (done || alertMin == 0 ? 0 : 1) { continue }
            ev.title = title
            ev.startDate = s
            ev.endDate = e
            ev.url = URL(string: "diem://item/" + (key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key))
            ev.alarms = done || alertMin == 0 ? nil : [EKAlarm(relativeOffset: TimeInterval(-alertMin * 60))]
            try events.save(ev, span: .thisEvent, commit: false)
        }
        for (key, ev) in byKey where !seen.contains(key) { try events.remove(ev, span: .thisEvent, commit: false) }
        try events.commit()
        return ["ok": true]
    }
}
