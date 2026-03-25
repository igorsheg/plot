import ComposableArchitecture
import Foundation

@Reducer
struct ProjectDetailFeature {
    @ObservableState
    struct State: Equatable {
        var project: Project
        var workflow: WorkflowDocument?
        var isLoading = true
    }
    
    enum Action {
        case task
        case workflowLoaded(WorkflowDocument?)
        case createWorkflow(WorkflowTemplate)
        case updateFrontmatter(WorkflowFrontmatter)
        case save
        case saved(Bool)
        case openInEditor
    }
    
    enum WorkflowTemplate: String, CaseIterable {
        case github
        case beads
        case blank
    }
    
    @Dependency(\.fileClient) var fileClient
    
    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .task:
                return .run { [path = state.project.path] send in
                    let doc = try await fileClient.readWorkflow(path)
                    await send(.workflowLoaded(doc))
                }
                
            case .workflowLoaded(let doc):
                state.workflow = doc
                state.isLoading = false
                return .none
                
            case .createWorkflow(let template):
                let doc = Self.templateDocument(for: template)
                state.workflow = doc
                return .run { [path = state.project.path] _ in
                    try await fileClient.writeWorkflow(path, doc)
                }
                
            case .updateFrontmatter(let frontmatter):
                state.workflow?.config = frontmatter
                return .none
                
            case .save:
                guard let workflow = state.workflow else { return .none }
                return .run { [path = state.project.path] send in
                    do {
                        try await fileClient.writeWorkflow(path, workflow)
                        await send(.saved(true))
                    } catch {
                        await send(.saved(false))
                    }
                }
                
            case .saved:
                return .none
                
            case .openInEditor:
                let filePath = (state.project.path as NSString).appendingPathComponent("WORKFLOW.md")
                return .run { _ in
                    await fileClient.openInEditor(filePath)
                }
            }
        }
    }
    
    static func templateDocument(for template: WorkflowTemplate) -> WorkflowDocument {
        switch template {
        case .github:
            return WorkflowDocument(
                config: WorkflowFrontmatter(
                    tracker: .init(
                        kind: "github",
                        dispatchStates: ["plot:todo", "plot:in-progress"],
                        parkedStates: ["plot:human-review"],
                        terminalStates: ["plot:done"]
                    ),
                    workspace: .init(root: "./workspaces"),
                    agent: .init(maxConcurrentAgents: 1, maxTurns: 50, model: "anthropic/claude-sonnet-4-20250514")
                ),
                promptBody: "## Instructions\n\nWork on the assigned issue only.\nKeep diffs minimal.\nProve changes with checks before claiming success."
            )
        case .beads:
            return WorkflowDocument(
                config: WorkflowFrontmatter(
                    tracker: .init(
                        kind: "beads",
                        dispatchStates: ["ready"],
                        terminalStates: ["closed"]
                    ),
                    workspace: .init(root: "./workspaces"),
                    agent: .init(maxConcurrentAgents: 1, maxTurns: 50, model: "anthropic/claude-sonnet-4-20250514")
                ),
                promptBody: "## Instructions\n\nWork on the assigned issue only.\nKeep diffs minimal."
            )
        case .blank:
            return WorkflowDocument(
                config: WorkflowFrontmatter(
                    tracker: .init(kind: "github")
                ),
                promptBody: ""
            )
        }
    }
}
