# Workflows

A workflow is a Markdown file with front matter.

It answers three questions:

1. Which agent should run?
2. Which extension finds work?
3. What should the agent do with each work item?

```md
---
name: review-current-pr
agent:
  provider: openai-codex
  model: gpt-5.5
  thinking: high
extension:
  source: ./github-pr-reviewer.extension.ts
  config:
    includeDrafts: false
plot:
  tickIntervalMs: 300000
resources:
  contextFiles: true
  skills:
    - ./skills/pr-review
---

# Review {{ work.title }}

Use the repository, GitHub CLI, tests, and your judgment.
Post one useful review.

{{ githubContext }}
```

## The split

The extension finds work and exposes safe integration tools. The prompt teaches judgment.

Good extension:

```txt
There is a PR: #42. Here is its URL, head SHA, previous review, and display title.
The agent may call post_pr_review when it is ready to publish the final review.
```

Good prompt:

```txt
Read the diff, inspect callers, run relevant checks, and post one durable review.
```

Bad extension:

```txt
Step 1: read file A. Step 2: grep B. Step 3: post exactly this comment.
```

Plot should not turn agents into brittle scripts.

## Front matter

### `name`

A stable workflow name.

### `agent`

Provider and model settings for the inner agent session.

### `extension`

The local TypeScript module that exports a Plot extension.

```yaml
extension:
  source: ./my-extension.ts
  config:
    label: agent-ready
```

The `config` object is passed to your extension after optional `parseConfig`.

An extension can also register tools for the agent session. Tools are not configured in workflow YAML; they are normal TypeScript returned by the extension setup and passed through to pi-mono.

### `plot`

Runtime settings.

```yaml
plot:
  tickIntervalMs: 300000
  maxRunDurationMs: 900000
```

### `resources`

Inputs for the agent session.

```yaml
resources:
  contextFiles: true
  skills:
    - ./skills/review
```

Resources are explicit. Plot does not auto-load behavior from `.plot/agent/skills`.

## Template context

Work context from your extension is available to the prompt.

If the extension returns:

```ts
context: {
  issue: { id: "ENG-123", title: "Fix checkout" }
}
```

The workflow can use:

```md
Review {{ issue.id }}: {{ issue.title }}
```

Use context for facts the agent needs. Do not use it to micromanage every tool call.

## Tools

Workflow prompts should mention important registered tools by name and explain when they are appropriate.

Example:

```md
Use `prepare_review_context` before reviewing. When you have a final review, call `post_pr_review`; do not hand-roll GitHub API mutation in shell.
```

Registered tools come from the extension SDK:

- `registerTool(tool)` exposes a pi-native `ToolDefinition` to the Agent Run.
- `defineTool(...)` is re-exported from pi-mono for tool authoring.

Keep this split clear: TypeScript owns integration correctness and idempotent mutations; the agent owns investigation, judgment, and final content.
