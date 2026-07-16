# Workflows

A Workflow is a durable configured use of an Extension. Its Markdown file selects the Extension and integration configuration, configures agent and runtime policy, and provides the prompt template used for every discovered Work Item.

Every Workflow requires an Extension. Plot has one continuous execution model: Sources observe, reconcile, and select work.

```md
---
name: review-acme-prs
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
```

Multiple Workflow files may reference the same Extension. Different files can supply different repository configuration, prompt, model, concurrency, and resources, and may run concurrently.

## Identity and lifecycle

The canonical Workflow file path identifies a Workflow. Equivalent path spellings select the same Active Session. Moving the file creates a different Workflow identity; editing it does not.

An Active Session retains the Workflow and Extension code loaded at start. Stop and restart to apply changes. Plot does not hot-reload them.

## Front matter

The documented top-level runtime keys are `name`, `agent`, `extension`, `plot`, and `resources`. Other top-level keys remain user data available under `workflow`. Unknown fields inside runtime-owned mappings are rejected.

### `name`

Optional human-readable name shown in dashboards.

### `extension`

Required.

| Field               | Type             | Meaning                                                    |
| ------------------- | ---------------- | ---------------------------------------------------------- |
| `source`            | non-empty string | TypeScript module, resolved relative to the Workflow file. |
| `maxConcurrentRuns` | positive integer | Maximum concurrent Agent Runs for this Source.             |
| `config`            | any YAML value   | Input to the Extension's optional `parseConfig`.           |

### `agent`

`provider` and `model` are required.

| Field                | Type                                               | Meaning                                               |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `provider`           | string                                             | Provider identifier.                                  |
| `model`              | string                                             | Provider model identifier.                            |
| `thinking`           | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` | Requested reasoning level.                            |
| `tools`              | string[]                                           | Allowlist of built-in Agent Session tools.            |
| `excludeTools`       | string[]                                           | Built-in tools to remove.                             |
| `noTools`            | boolean, `all`, `builtin`                          | Disable all or built-in tools.                        |
| `allowProjectConfig` | boolean                                            | Trust project agent configuration.                    |
| `maxTurns`           | positive integer                                   | Maximum high-level turns per Agent Run; default `20`. |

Extension tools are registered separately and bound to each Work Item where appropriate.

### `plot`

| Field              | Type             | Meaning                                  |
| ------------------ | ---------------- | ---------------------------------------- |
| `tickIntervalMs`   | positive integer | Scheduled Source reconciliation cadence. |
| `maxRunDurationMs` | positive integer | Wall-clock timeout for one Agent Run.    |
| `stallTimeoutMs`   | positive integer | Interrupt an Agent Run after inactivity. |

### `resources`

| Field                | Type     | Meaning                                                                 |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `skills`             | string[] | Additional skill paths, resolved from the Workflow directory.           |
| `prompts`            | string[] | Additional prompt-template paths, resolved from the Workflow directory. |
| `contextFiles`       | boolean  | Disable context-file loading with `false`.                              |
| `systemPrompt`       | string   | Replace the Agent Session system prompt.                                |
| `appendSystemPrompt` | string[] | Append system-prompt fragments.                                         |

Plot also searches project `.plot/skills` and `.plot/prompts`.

## Prompt data

Always available:

```txt
workflow   complete parsed front matter
work       id, version?, title?, url?, subject?, workspace?,
           display?, operatorActions?
```

Object `work.context` fields merge into the template top level. A non-object context is available as `value`. Keep context factual and compact; investigation strategy belongs in the Markdown prompt.

## Paths and durability

- Extension source and Workflow resource paths resolve relative to the Workflow file.
- Project state defaults to `.plot` under the directory where Plot was started.
- Session History lives under `.plot/sessions`.
- Extension credentials are namespaced by Extension and Workflow identities.
- Agent auth and model catalog live under `~/.plot/agent`.
- A Work Item workspace must be absolute and becomes the Agent Run working directory.

## Validate and operate

```bash
plot check WORKFLOW.md
plot WORKFLOW.md
plot stop WORKFLOW.md
```
