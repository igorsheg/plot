import Foundation

struct RuntimeSnapshot: Equatable, Codable {
    var running: [RunningEntry]
    var codexTotals: TokenTotals
    
    struct RunningEntry: Equatable, Codable, Identifiable {
        var id: String { issueIdentifier }
        var issueId: String
        var issueIdentifier: String
        var state: String
        var session: LiveSession
    }
    
    struct LiveSession: Equatable, Codable {
        var inputTokens: Int
        var outputTokens: Int
        var totalTokens: Int
        var turnCount: Int
        var phase: String
    }
    
    struct TokenTotals: Equatable, Codable {
        var inputTokens: Int
        var outputTokens: Int
        var totalTokens: Int
        var secondsRunning: Int
    }
    
    static let empty = RuntimeSnapshot(
        running: [],
        codexTotals: TokenTotals(inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0)
    )
}
