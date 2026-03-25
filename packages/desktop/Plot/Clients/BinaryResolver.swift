import Dependencies
import Foundation
import os

struct BinaryResolver: Sendable {
    var resolve: @Sendable (_ projectPath: String) -> BinaryResolution
}

struct BinaryResolution: Equatable, Sendable {
    let path: String
    let arguments: [String]
    let source: Source
    
    enum Source: Equatable, Sendable {
        case bundled
        case monorepo
        case localProject
        case global
    }
}

extension BinaryResolver: DependencyKey {
    static let liveValue = BinaryResolver { projectPath in
        // 1. Bundled binary inside Plot.app/Contents/Resources/
        if let bundled = Bundle.main.path(forResource: "plot-ai", ofType: nil),
           FileManager.default.isExecutableFile(atPath: bundled) {
            PlotLog.binary.info("resolved bundled binary at \(bundled)")
            return BinaryResolution(path: bundled, arguments: [], source: .bundled)
        }
        
        #if DEBUG
        // 2. Dev: run from monorepo source via bun
        if let monorepoRoot = Self.findMonorepoRoot() {
            let entrypoint = (monorepoRoot as NSString).appendingPathComponent(
                "packages/plot/src/cli/index.ts"
            )
            if FileManager.default.fileExists(atPath: entrypoint) {
                let bunPath = Self.findBun() ?? "/usr/local/bin/bun"
                PlotLog.binary.info("resolved monorepo binary via bun at \(entrypoint)")
                return BinaryResolution(
                    path: bunPath,
                    arguments: ["run", entrypoint],
                    source: .monorepo
                )
            }
        }
        #endif
        
        // 3. Local project install (npm/bun workspace)
        let localBin = (projectPath as NSString).appendingPathComponent("node_modules/.bin/plot-ai")
        if FileManager.default.fileExists(atPath: localBin) {
            PlotLog.binary.info("resolved local project binary at \(localBin)")
            return BinaryResolution(path: localBin, arguments: [], source: .localProject)
        }
        
        // 4. Global install
        if let globalPath = Self.which("plot-ai") {
            PlotLog.binary.info("resolved global binary at \(globalPath)")
            return BinaryResolution(path: globalPath, arguments: [], source: .global)
        }
        
        // Last resort — hope it's in PATH at runtime
        PlotLog.binary.warning("no binary found, falling back to bare 'plot-ai'")
        return BinaryResolution(path: "plot-ai", arguments: [], source: .global)
    }
    
    private static func findMonorepoRoot() -> String? {
        // Check env var first (set by Xcode scheme or manually)
        if let root = ProcessInfo.processInfo.environment["PLOT_MONOREPO_ROOT"],
           FileManager.default.fileExists(atPath: (root as NSString).appendingPathComponent("packages/plot")) {
            return root
        }
        
        // Walk up from the app bundle looking for the monorepo marker
        var dir = Bundle.main.bundleURL.deletingLastPathComponent()
        for _ in 0..<10 {
            let marker = dir.appendingPathComponent("packages/plot/src/cli/index.ts")
            if FileManager.default.fileExists(atPath: marker.path) {
                return dir.path
            }
            dir = dir.deletingLastPathComponent()
        }
        
        return nil
    }
    
    private static func findBun() -> String? {
        // Common bun locations
        let candidates = [
            "/usr/local/bin/bun",
            "\(NSHomeDirectory())/.bun/bin/bun",
            "/opt/homebrew/bin/bun",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }
        return which("bun")
    }
    
    private static func which(_ name: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        process.arguments = [name]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        
        guard process.terminationStatus == 0,
              let data = try? pipe.fileHandleForReading.availableData,
              let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !path.isEmpty else {
            return nil
        }
        return path
    }
}

extension DependencyValues {
    var binaryResolver: BinaryResolver {
        get { self[BinaryResolver.self] }
        set { self[BinaryResolver.self] = newValue }
    }
}
