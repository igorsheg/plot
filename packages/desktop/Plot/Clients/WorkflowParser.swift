import Foundation
import Yams

enum WorkflowParser {
    static func parse(_ content: String) -> WorkflowDocument? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("---") else {
            return WorkflowDocument(config: WorkflowFrontmatter(), promptBody: trimmed)
        }

        let afterOpening = trimmed.index(trimmed.startIndex, offsetBy: 3)
        let rest = String(trimmed[afterOpening...]).trimmingCharacters(in: .newlines)

        guard let closingRange = rest.range(of: "\n---") else {
            return WorkflowDocument(config: WorkflowFrontmatter(), promptBody: trimmed)
        }

        let yamlString = String(rest[rest.startIndex..<closingRange.lowerBound])
        let body = String(rest[closingRange.upperBound...]).trimmingCharacters(in: .newlines)

        do {
            let decoder = YAMLDecoder()
            let config = try decoder.decode(WorkflowFrontmatter.self, from: yamlString)
            return WorkflowDocument(config: config, promptBody: body)
        } catch {
            return WorkflowDocument(config: WorkflowFrontmatter(), promptBody: content)
        }
    }

    static func serialize(_ document: WorkflowDocument) -> String {
        do {
            let encoder = YAMLEncoder()
            let yaml = try encoder.encode(document.config)
            return "---\n\(yaml)---\n\n\(document.promptBody)\n"
        } catch {
            return document.promptBody
        }
    }
}
