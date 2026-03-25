import AppKit
import Dependencies
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
            @Dependency(\.processClient) var processClient
            await processClient.terminateAll()
            PlotLog.app.info("all child processes terminated, quitting")
            await MainActor.run {
                NSApp.reply(toApplicationShouldTerminate: true)
            }
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
