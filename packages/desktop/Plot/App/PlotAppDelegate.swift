import AppKit
import SwiftUI

class PlotAppDelegate: NSObject, NSApplicationDelegate {
    private var isTerminating = false
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
    }
    
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !isTerminating else { return .terminateLater }
        isTerminating = true
        
        PlotLog.app.info("app quit requested, terminating child processes...")
        
        Task {
            await ProcessSupervisor.shared.terminateAll()
            PlotLog.app.info("all child processes terminated, quitting")
            await MainActor.run {
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
        
        // Safety net: if terminateAll hangs, force quit after 10s
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            PlotLog.app.warning("shutdown timeout, force quitting")
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        
        return .terminateLater
    }
    
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }
    
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
    
    func showMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.identifier?.rawValue == "main" }) {
            window.makeKeyAndOrderFront(nil)
        }
    }
}
