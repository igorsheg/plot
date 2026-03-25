import Foundation

struct WorkflowDocument: Equatable, Codable {
    var config: WorkflowFrontmatter
    var promptBody: String

    enum CodingKeys: String, CodingKey {
        case config, promptBody = "prompt_body"
    }
}

struct WorkflowFrontmatter: Equatable, Codable {
    var tracker: TrackerConfig?
    var workspace: WorkspaceConfig?
    var agent: AgentConfig?
    var server: ServerConfig?
    var polling: PollingConfig?

    struct TrackerConfig: Equatable, Codable {
        var kind: String
        var dispatchStates: [String]?
        var parkedStates: [String]?
        var terminalStates: [String]?

        enum CodingKeys: String, CodingKey {
            case kind
            case dispatchStates = "dispatch_states"
            case parkedStates = "parked_states"
            case terminalStates = "terminal_states"
        }
    }

    struct WorkspaceConfig: Equatable, Codable {
        var root: String?
    }

    struct AgentConfig: Equatable, Codable {
        var maxConcurrentAgents: Int?
        var maxTurns: Int?
        var model: String?

        enum CodingKeys: String, CodingKey {
            case maxConcurrentAgents = "max_concurrent_agents"
            case maxTurns = "max_turns"
            case model
        }
    }

    struct ServerConfig: Equatable, Codable {
        var port: Int?
    }

    struct PollingConfig: Equatable, Codable {
        var intervalMs: Int?

        enum CodingKeys: String, CodingKey {
            case intervalMs = "interval_ms"
        }
    }
}
