# Workflows

A Workflow is Markdown with front matter. Running one creates a Plot Session.

It answers:

1. Which agent runs?
2. Which extension finds work?
3. What should the agent do with each Work Item?

```md
---
name: review-current-pr
agent: { provider: openai-codex, model: gpt-5.5 }
extension:
  source: ./github-pr-reviewer.extension.ts
  config: { includeDrafts: false }
plot: { tickIntervalMs: 300000, maxRunDurationMs: 300000 }
resources:
  contextFiles: true
  skills: [./skills/pr-review]
---

# Review {{ work.title }}

Use the repo, GitHub CLI, tests, and judgment. Post one useful review.
{{ githubContext }}
```

## The split

The extension finds work and exposes safe integration tools. The prompt teaches judgment.

Good extension context:

```txt
PR #42, URL, head SHA, previous review, display title.
Tool available: post_pr_review.
```

Good prompt:

```txt
Read the diff, inspect callers, run relevant checks, and post one durable review.
```

Bad extension:

```txt
Step 1 read file A. Step 2 grep B. Step 3 post exactly this comment.
```

Plot should shape context, not turn agents into brittle scripts.

## Front matter

- `name`: stable Workflow name.
- `agent`: provider/model settings. `maxTurns` limits high-level Agent Run turns; use `plot.maxRunDurationMs` for wall-clock timeout.
- `extension`: local TypeScript module exporting a Plot extension. `config` is passed to optional `parseConfig`.
- `plot`: runtime settings such as `tickIntervalMs` and `maxRunDurationMs`.
- `resources`: explicit agent-session inputs such as context files and skills.

Defaults may live in `~/.plot/settings.json` or `.plot/settings.json`:

```json
{
	"defaultProvider": "openai-codex",
	"defaultModel": "gpt-5.5",
	"defaultThinkingLevel": "high"
}
```

Workflow front matter and CLI flags override settings. Plot does not auto-load behavior from `.plot/agent/skills`.

## Prompt data and tools

Work Item `context` is available to the prompt:

```ts
context: { issue: { id: "ENG-123", title: "Fix checkout" } }
```

```md
Review {{ issue.id }}: {{ issue.title }}
```

Use context for facts, not micromanagement. Mention important registered tools by name:

```md
Use `prepare_review_context` before reviewing. When done, call `post_pr_review`.
```

TypeScript tools own integration correctness and idempotent mutations. The agent owns investigation, judgment, and final content.

## Run and observe

```bash
plot tui --workflow WORKFLOW.md
plot run --workflow WORKFLOW.md
```

Plot stores session history under `.plot/sessions`. Agent transcripts stay separate.
