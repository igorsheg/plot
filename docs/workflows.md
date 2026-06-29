# Workflows

A workflow is a Markdown file with front matter. A Plot run is the live runtime created from that workflow.

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

Plot should make agents cheaper and better by shaping context and ownership, not by micromanaging reasoning.

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

Provider and model settings for the agent session. `maxTurns` limits high-level Agent Run turns: one initial prompt plus continuation prompts on the same live session. It does not cap the model/tool loop inside one turn. Use `plot.maxRunDurationMs` for a wall-clock guard.

You can omit provider/model here and use Plot settings instead:

```json
{
	"defaultProvider": "openai-codex",
	"defaultModel": "gpt-5.5",
	"defaultThinkingLevel": "high"
}
```

Plot reads `~/.plot/settings.json`, then `.plot/settings.json`. Workflow front matter and CLI flags override settings.

### `extension`

The local TypeScript module that exports a Plot extension.

```yaml
extension:
  source: ./my-extension.ts
  config:
    label: agent-ready
```

The `config` object is passed to your extension after optional `parseConfig`.

An extension can also register tools for the agent session. Tools are not configured in workflow YAML; they are normal TypeScript registered by the extension setup.

### `plot`

Runtime settings.

```yaml
plot:
  tickIntervalMs: 300000
  maxRunDurationMs: 300000
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

Use context for facts the agent needs. Do not use it to micromanage every tool call. If a Source discovers multiple Work Items, render the relevant context in the prompt (`{{ work.title }}`, `{{ issue.id }}`, etc.) or expose a work-bound context tool.

## Tools

Workflow prompts should mention important registered tools by name and explain when they are appropriate.

Example:

```md
Use `prepare_review_context` before reviewing. When you have a final review, call `post_pr_review`; do not hand-roll GitHub API mutation in shell.
```

Registered tools come from the extension SDK:

- `registerTool(tool)` exposes a tool to the Agent Run.
- `defineTool(...)` defines the tool contract.

Keep this split clear: TypeScript owns integration correctness and idempotent mutations; the agent owns investigation, judgment, and final content. Output tools should bind or validate the current Work Item so the agent cannot accidentally write a result for the wrong target.

## Running and observing

```bash
plot run --workflow WORKFLOW.md
plot tui --workflow WORKFLOW.md
```

`plot run` creates a oneshot Plot run. `plot tui` opens a terminal dashboard attached to a managed run for this project/workflow.

Plot stores project-local event logs under `.plot/sessions`. Event logs record Plot run events and projection state, while agent transcripts remain the inner agent-session record.
