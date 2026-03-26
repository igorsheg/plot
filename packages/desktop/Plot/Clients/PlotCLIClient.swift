import Dependencies
import DependenciesMacros
import Foundation
import os

/// Spawns the bundled plot-ai binary and parses NDJSON envelope responses.
@DependencyClient
struct PlotCLIClient: Sendable {
    var listModels: @Sendable () async throws -> ModelRegistry
    var authStatus: @Sendable () async throws -> [AuthProvider]
    var authLogin: @Sendable (_ providerId: String, _ onPrompt: @Sendable (AuthPrompt) async -> String, _ onURL: @Sendable (String) async -> Void) async throws -> Void
}

struct ModelRegistry: Equatable, Sendable {
    var providers: [ModelProvider]
}

struct ModelProvider: Equatable, Sendable, Identifiable {
    var id: String
    var authenticated: Bool
    var models: [ModelInfo]
}

struct ModelInfo: Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var provider: String
    var reasoning: Bool
    var contextWindow: Int
    var maxTokens: Int
}

struct AuthProvider: Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var authenticated: Bool
}

struct AuthPrompt: Sendable {
    var message: String
    var placeholder: String?
    var allowEmpty: Bool
}

extension PlotCLIClient: DependencyKey {
    static let liveValue: PlotCLIClient = {
        PlotCLIClient(
            listModels: {
                let json = try await runPlotAI(["models"])
                guard let result = json["result"] as? [String: Any],
                      let providers = result["providers"] as? [[String: Any]] else {
                    throw PlotCLIError.invalidResponse
                }

                // if truncated, read full output from file
                var allProviders = providers
                if let truncated = result["truncated"] as? Bool, truncated,
                   let fullPath = result["full_output"] as? String {
                    if let fullData = FileManager.default.contents(atPath: fullPath),
                       let fullJSON = try? JSONSerialization.jsonObject(with: fullData) as? [[String: Any]] {
                        // full output is the raw providers array
                        allProviders = fullJSON
                    }
                }

                return ModelRegistry(providers: allProviders.compactMap { parseProvider($0) })
            },
            authStatus: {
                let json = try await runPlotAI(["auth", "status"])
                guard let result = json["result"] as? [String: Any],
                      let providers = result["providers"] as? [[String: Any]] else {
                    throw PlotCLIError.invalidResponse
                }
                return providers.compactMap { dict -> AuthProvider? in
                    guard let id = dict["id"] as? String,
                          let name = dict["name"] as? String,
                          let auth = dict["authenticated"] as? Bool else { return nil }
                    return AuthProvider(id: id, name: name, authenticated: auth)
                }
            },
            authLogin: { providerId, onPrompt, onURL in
                let resolution = resolve()
                let args = resolution.arguments + ["auth", "login", providerId]

                let process = Process()
                process.executableURL = URL(fileURLWithPath: resolution.path)
                process.arguments = args

                let stdoutPipe = Pipe()
                let stdinPipe = Pipe()
                process.standardOutput = stdoutPipe
                process.standardInput = stdinPipe
                process.standardError = FileHandle.nullDevice

                try process.run()

                let reader = stdoutPipe.fileHandleForReading
                var buffer = Data()

                while process.isRunning || reader.availableData.count > 0 {
                    let chunk = reader.availableData
                    if chunk.isEmpty {
                        try await Task.sleep(for: .milliseconds(50))
                        continue
                    }
                    buffer.append(chunk)

                    while let newlineRange = buffer.range(of: Data("\n".utf8)) {
                        let lineData = buffer[buffer.startIndex..<newlineRange.lowerBound]
                        buffer.removeSubrange(buffer.startIndex...newlineRange.lowerBound)

                        guard let line = String(data: lineData, encoding: .utf8),
                              !line.isEmpty,
                              let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                              let type = obj["type"] as? String else { continue }

                        switch type {
                        case "auth:url":
                            if let url = obj["url"] as? String {
                                await onURL(url)
                            }
                        case "auth:prompt":
                            let prompt = AuthPrompt(
                                message: obj["message"] as? String ?? "Enter code",
                                placeholder: obj["placeholder"] as? String,
                                allowEmpty: obj["allowEmpty"] as? Bool ?? false
                            )
                            let response = await onPrompt(prompt)
                            let responseJSON = "{\"type\":\"response\",\"value\":\"\(response)\"}\n"
                            stdinPipe.fileHandleForWriting.write(Data(responseJSON.utf8))
                        case "auth:done":
                            PlotLog.runtime.info("auth login succeeded for \(providerId, privacy: .public)")
                            return
                        case "error":
                            let message = obj["message"] as? String ?? "auth failed"
                            throw PlotCLIError.authFailed(message)
                        default:
                            continue
                        }
                    }
                }

                if process.terminationStatus != 0 {
                    throw PlotCLIError.authFailed("process exited with code \(process.terminationStatus)")
                }
            }
        )
    }()

    private static func resolve() -> BinaryResolution {
        @Dependency(\.binaryResolver) var binaryResolver
        return binaryResolver.resolve("")
    }

    private static func runPlotAI(_ arguments: [String]) async throws -> [String: Any] {
        let resolution = resolve()
        let args = resolution.arguments + arguments

        let process = Process()
        process.executableURL = URL(fileURLWithPath: resolution.path)
        process.arguments = args

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let line = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !line.isEmpty else {
            throw PlotCLIError.invalidResponse
        }

        // NDJSON: take the last line (terminal envelope)
        let lastLine = line.components(separatedBy: "\n").last ?? line
        guard let json = try? JSONSerialization.jsonObject(with: Data(lastLine.utf8)) as? [String: Any] else {
            throw PlotCLIError.invalidResponse
        }

        if json["ok"] as? Bool != true {
            let error = (json["error"] as? [String: Any])?["message"] as? String ?? "command failed"
            throw PlotCLIError.commandFailed(error)
        }

        return json
    }

    private static func parseProvider(_ dict: [String: Any]) -> ModelProvider? {
        guard let id = dict["id"] as? String else { return nil }
        let authenticated = dict["authenticated"] as? Bool ?? false
        let models = (dict["models"] as? [[String: Any]] ?? []).compactMap { parseModel($0) }
        return ModelProvider(id: id, authenticated: authenticated, models: models)
    }

    private static func parseModel(_ dict: [String: Any]) -> ModelInfo? {
        guard let id = dict["id"] as? String,
              let name = dict["name"] as? String,
              let provider = dict["provider"] as? String else { return nil }
        return ModelInfo(
            id: id,
            name: name,
            provider: provider,
            reasoning: dict["reasoning"] as? Bool ?? false,
            contextWindow: dict["contextWindow"] as? Int ?? 0,
            maxTokens: dict["maxTokens"] as? Int ?? 0
        )
    }
}

enum PlotCLIError: Error, Sendable {
    case invalidResponse
    case commandFailed(String)
    case authFailed(String)
}

extension DependencyValues {
    var plotCLI: PlotCLIClient {
        get { self[PlotCLIClient.self] }
        set { self[PlotCLIClient.self] = newValue }
    }
}
