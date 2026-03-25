import AppKit
import Dependencies
import DependenciesMacros
import Foundation

@DependencyClient
struct FileClient: Sendable {
    var readWorkflow: @Sendable (_ projectPath: String) async throws -> WorkflowDocument?
    var writeWorkflow: @Sendable (_ projectPath: String, _ document: WorkflowDocument) async throws -> Void
    var openInEditor: @Sendable (_ filePath: String) async -> Void = { _ in }
}

extension FileClient: DependencyKey {
    static let liveValue = FileClient(
        readWorkflow: { projectPath in
            let filePath = (projectPath as NSString).appendingPathComponent("WORKFLOW.md")
            guard FileManager.default.fileExists(atPath: filePath) else { return nil }

            let content = try String(contentsOfFile: filePath, encoding: .utf8)
            return WorkflowParser.parse(content)
        },
        writeWorkflow: { projectPath, document in
            let filePath = (projectPath as NSString).appendingPathComponent("WORKFLOW.md")
            let content = WorkflowParser.serialize(document)
            try content.write(toFile: filePath, atomically: true, encoding: .utf8)
        },
        openInEditor: { filePath in
            await MainActor.run {
                _ = NSWorkspace.shared.open(URL(fileURLWithPath: filePath))
            }
        }
    )
}

extension DependencyValues {
    var fileClient: FileClient {
        get { self[FileClient.self] }
        set { self[FileClient.self] = newValue }
    }
}
