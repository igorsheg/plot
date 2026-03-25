import AppKit

class PlotAppDelegate: NSObject, NSApplicationDelegate {
    private var isTerminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        PlotApp.appStore.send(.task)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !isTerminating else { return .terminateLater }
        isTerminating = true

        PlotLog.app.info("app quit requested, terminating child processes...")

        Task {
            await ProcessClient.liveValue.terminateAll()
            PlotLog.app.info("all child processes terminated, quitting")
            await MainActor.run {
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            PlotLog.app.warning("shutdown timeout, force quitting")
            NSApp.reply(toApplicationShouldTerminate: true)
        }

        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
