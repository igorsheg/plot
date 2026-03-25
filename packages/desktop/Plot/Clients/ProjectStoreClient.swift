import Dependencies
import DependenciesMacros
import Foundation

@DependencyClient
struct ProjectStoreClient: Sendable {
    var load: @Sendable () async throws -> [Project] = { [] }
    var save: @Sendable (_ projects: [Project]) async throws -> Void
}

extension ProjectStoreClient: DependencyKey {
    static let liveValue: ProjectStoreClient = {
        let storageURL: URL = {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            let dir = appSupport.appendingPathComponent("dev.plot.desktop", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            return dir.appendingPathComponent("projects.json")
        }()

        return ProjectStoreClient(
            load: {
                guard FileManager.default.fileExists(atPath: storageURL.path) else { return [] }
                let data = try Data(contentsOf: storageURL)
                return try JSONDecoder().decode([Project].self, from: data)
            },
            save: { projects in
                let data = try JSONEncoder().encode(projects)
                try data.write(to: storageURL, options: .atomic)
            }
        )
    }()
}

extension DependencyValues {
    var projectStore: ProjectStoreClient {
        get { self[ProjectStoreClient.self] }
        set { self[ProjectStoreClient.self] = newValue }
    }
}
