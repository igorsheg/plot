import os

enum PlotLog {
    static let runtime = Logger(subsystem: "dev.plot.desktop", category: "runtime")
    static let binary = Logger(subsystem: "dev.plot.desktop", category: "binary")
    static let file = Logger(subsystem: "dev.plot.desktop", category: "file")
    static let app = Logger(subsystem: "dev.plot.desktop", category: "app")
}
