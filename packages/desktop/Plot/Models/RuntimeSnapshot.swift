import Foundation

struct RuntimeSnapshot: Equatable, Codable {
    var running: [RunningEntry]
    var codexTotals: TokenTotals

    enum CodingKeys: String, CodingKey {
        case running
        case codexTotals = "codex_totals"
    }

    struct RunningEntry: Equatable, Codable, Identifiable {
        var id: String { issueIdentifier }
        var issueId: String
        var issueIdentifier: String
        var state: String
        var session: LiveSession

        enum CodingKeys: String, CodingKey {
            case issueId = "issue_id"
            case issueIdentifier = "issue_identifier"
            case state
            case session
        }
    }

    struct LiveSession: Equatable, Codable {
        var inputTokens: Int
        var outputTokens: Int
        var totalTokens: Int
        var turnCount: Int
        var phase: String

        enum CodingKeys: String, CodingKey {
            case inputTokens = "input_tokens"
            case outputTokens = "output_tokens"
            case totalTokens = "total_tokens"
            case turnCount = "turn_count"
            case phase
        }
    }

    struct TokenTotals: Equatable, Codable {
        var inputTokens: Int
        var outputTokens: Int
        var totalTokens: Int
        var secondsRunning: Int

        enum CodingKeys: String, CodingKey {
            case inputTokens = "input_tokens"
            case outputTokens = "output_tokens"
            case totalTokens = "total_tokens"
            case secondsRunning = "seconds_running"
        }
    }

    static let empty = RuntimeSnapshot(
        running: [],
        codexTotals: TokenTotals(inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0)
    )
}
