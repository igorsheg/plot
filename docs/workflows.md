# Workflows

A Workflow is Markdown with optional YAML front matter. Front matter configures Plot and the Agent Session; the Markdown body is the prompt template.

## Execution modes

- Without `extension`, Plot runs one synthetic Work Item (`workflow:default`) once.
- With `extension`, trusted TypeScript discovers versioned Work Items and may register tools.

```md
---
name: review-queue
agent:
  provider: openai-codex
  model: gpt-5.5
  thinking: high
  maxTurns: 4
extension:
  source: ./review.extension.ts
  maxConcurrentRuns: 2
  config:
    repository: acme/web
plot:
  tickIntervalMs: 300000
  maxRunDurationMs: 900000
  stallTimeoutMs: 180000
resources:
  contextFiles: true
  skills: [./skills/review]
---

# Review {{ work.title }}

Repository: {{ repository }}
Pull request: {{ pr.number }}

Inspect the change and its callers. Use `post_review` only after verification.
```

Use the top-level form above. Plot also accepts these five keys under one `runtime` mapping, but do not mix runtime forms: when `runtime` exists, it is the runtime configuration source. Other top-level front-matter keys are allowed as user data and remain available under `workflow`; unknown fields inside `runtime`, `plot`, `agent`, `resources`, or `extension` are rejected.

## Complete front-matter contract

Positive numeric fields must be positive integers.

### `name`

Optional human-readable Workflow name shown in run metadata and dashboards.

### `agent`

| Field                | Type                                                  | Meaning                                                                                        |
| -------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `provider`           | string                                                | Provider id, for example `openai-codex` or `anthropic`.                                        |
| `model`              | string                                                | Provider model id. A CLI `--model provider/model` selector may supply both provider and model. |
| `thinking`           | `off`, `minimal`, `low`, `medium`, `high`, or `xhigh` | Requested thinking level when supported.                                                       |
| `tools`              | string[]                                              | Allowlist of Agent Session tools.                                                              |
| `excludeTools`       | string[]                                              | Tools removed from the Agent Session.                                                          |
| `noTools`            | boolean, `all`, or `builtin`                          | Disable all tools or only built-in tools.                                                      |
| `allowProjectConfig` | boolean                                               | Trust project agent configuration without an interactive prompt.                               |
| `maxTurns`           | positive integer                                      | Maximum high-level turns in one Agent Run. Default: `20`. This is not a wall-clock timeout.    |

Registered extension tools enter the Agent Session as custom tools. Tool selection flags are Agent Session policy; Sources do not grant tools step by step.

### `extension`

| Field               | Type                       | Meaning                                                                     |
| ------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `source`            | non-empty string, required | TypeScript module. Relative paths resolve from the Workflow file directory. |
| `maxConcurrentRuns` | positive integer           | Per-extension concurrency cap, independent of global scheduler capacity.    |
| `config`            | any YAML value             | Passed to the extension's optional `parseConfig`, then to `create`.         |

The module must export a Plot extension as `default` or as named export `extension`.

### `plot`

| Field                 | Type             | Meaning                                                                                                   |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `tickIntervalMs`      | positive integer | Scheduled discovery/reconciliation cadence. Without it, ticks are explicit or triggered by runtime wakes. |
| `maxRunDurationMs`    | positive integer | Wall-clock timeout for one Agent Run.                                                                     |
| `stallTimeoutMs`      | positive integer | Interrupt an Agent Run after this long without agent events or reported activity.                         |
| `queueCapacity`       | positive integer | Protocol/control request queue capacity. Default: `64`.                                                   |
| `eventCapacity`       | positive integer | In-memory retained RuntimeEvent capacity. Default: `256`. Durable JSONL is separate.                      |
| `eventBufferCapacity` | positive integer | Buffered protocol event-record capacity. Default: `1024`.                                                 |

Failed and timed-out source work is retried by Source policy with exponential backoff. The current extension adapter uses 10 seconds, doubling to a five-minute cap.

### `resources`

| Field                | Type     | Meaning                                                                |
| -------------------- | -------- | ---------------------------------------------------------------------- |
| `skills`             | string[] | Additional skill paths, resolved from `--cwd`.                         |
| `prompts`            | string[] | Additional prompt-template paths, resolved from `--cwd`.               |
| `contextFiles`       | boolean  | Whether the Agent Session loads context files. Set `false` to disable. |
| `systemPrompt`       | string   | Replace the Agent Session system prompt. Empty string is allowed.      |
| `appendSystemPrompt` | string[] | Text fragments appended to the system prompt.                          |

Plot always adds `.plot/skills` and `.plot/prompts` as default search paths. `--no-skills` and `--no-prompt-templates` disable loading, including those defaults. `--skill` and `--prompt-template` replace Workflow-declared additional paths for that invocation.

## Prompt template data

Plot renders the Markdown body with Eta using `{{ ... }}` interpolation, no HTML escaping, and the discovered Work Item as data.

Always available:

```ts
{
  workflow: /* complete parsed front matter */,
  work: {
    id,
    version?,
    title?,
    url?,
    subject?,
    workspace?,
    display?,
    operatorActions?,
  }
}
```

If `work.context` is an object, its fields are merged at prompt top level:

```ts
context: { repository: "acme/web", pr: { number: 42 } }
```

```md
Review {{ repository }} pull request #{{ pr.number }}.
```

If `work.context` is not an object, it is available as `{{ value }}`. Keep context compact and factual. Put investigation strategy and quality criteria in the prompt, not in discovery code.

## Configuration precedence

For provider/model/thinking defaults:

1. CLI override
2. Workflow `agent`
3. project `.plot/settings.json`
4. global `~/.plot/settings.json`

Workflow and CLI resource options are resolved separately as described above. `--api-key` is runtime-only and requires a resolved provider from Workflow `agent.provider`, `--provider`, or `--model provider/model`.

## Paths and durability

- Workflow default: `WORKFLOW.md` under `--cwd`.
- Project state default: `.plot` under `--cwd`.
- Session history: `.plot/sessions/<session-id>.jsonl`.
- Extension `source`: relative to the Workflow file.
- Work Item `workspace`: must be absolute; Plot creates it before the Agent Run and uses it as that run's cwd.
- Agent auth/model state: `~/.plot/agent` unless `--agent-dir` overrides it.

A Session id is 1–128 letters, digits, dots, underscores, or hyphens, beginning with a letter or digit. Plot refuses to append a new Session to an existing event log.

## Validate and run

```bash
plot doctor WORKFLOW.md
plot open WORKFLOW.md
plot run WORKFLOW.md
```

`plot doctor` validates Workflow parsing and checks that at least one provider is authenticated. It does not load the extension or prove that a selected model exists. See [Extensions](extensions.md) for the Source and tool contracts.
