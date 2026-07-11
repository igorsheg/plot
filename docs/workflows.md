# Workflows

A Workflow is Markdown with optional YAML front matter: the front matter configures Plot and the Agent Session, the Markdown body is the prompt template. It is the one file a Plot Session starts from.

Without `extension`, Plot runs one synthetic Work Item (`workflow:default`) once. With `extension`, trusted TypeScript discovers versioned Work Items — see [Extensions](extensions.md).

A complete source-driven example:

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

Use this top-level form. Plot also accepts the five config keys under one `runtime` mapping, but never mix the two forms: when `runtime` exists, it is the runtime configuration source. Other top-level keys are allowed as user data and stay available under `workflow`; unknown fields _inside_ `runtime`, `plot`, `agent`, `resources`, or `extension` are rejected.

## Front-matter reference

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
| `maxTurns`           | positive integer                                      | Maximum high-level turns in one Agent Run. Default: `20`. Not a wall-clock timeout.            |

Registered extension tools enter the Agent Session as custom tools. Tool selection is Agent Session policy; extensions do not grant tools step by step.

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

```txt
workflow   complete parsed front matter
work       id, version?, title?, url?, subject?, workspace?,
           display?, operatorActions?
```

If `work.context` is an object, its fields merge into the template top level:

```md
Review {{ repository }} pull request #{{ pr.number }}.
```

If `work.context` is not an object, it is available as `{{ value }}`. Keep context compact and factual; investigation strategy and quality criteria belong in the prompt body, not in discovery code.

## Configuration precedence

For provider/model/thinking defaults:

1. CLI override
2. Workflow `agent`
3. project `.plot/settings.json`
4. global `~/.plot/settings.json`

`--api-key` is runtime-only and requires a resolved provider from Workflow `agent.provider`, `--provider`, or `--model provider/model`.

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

`plot doctor` validates Workflow parsing and checks that at least one provider is authenticated. It does not load the extension or prove that a selected model exists.
