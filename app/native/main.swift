import Cocoa

// 入口：窗口、菜单、和页面的桥都在 AppDelegate / Entry point; everything lives in AppDelegate
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = MainActor.assumeIsolated { AppDelegate() }
application.delegate = delegate
application.run()
