---
tracker:
  kind: local-fs
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Closed
    - Cancelled
polling:
  interval_ms: 15000
workspace:
  root: ./workspaces
hooks:
  after_create: "WS=$PWD && cd ../.. && rmdir \"$WS\" && git worktree add \"$WS\" HEAD --detach && cd \"$WS\" && bun install --frozen-lockfile"
  before_remove: "WS=$PWD && cd ../.. && git worktree remove \"$WS\" --force || true"
  timeout_ms: 120000
agent:
  max_concurrent_agents: 5
  max_turns: 10
  max_retry_backoff_ms: 60000
codex:
  command: pi
  turn_timeout_ms: 1800000
  stall_timeout_ms: 120000
server:
  port: 3000
---

You are working on issue **{{ issue.identifier }}: {{ issue.title }}**.

{% if issue.description %}
## Description
{{ issue.description }}
{% endif %}

{% if issue.labels.size > 0 %}
**Labels**: {{ issue.labels | join: ", " }}
{% endif %}

{% if attempt %}
This is retry attempt #{{ attempt }}. Review the previous work in the workspace and continue from where you left off.
{% else %}
Start fresh. Read the codebase, understand the context, then implement the changes.
{% endif %}

## Guidelines
- Make minimal, focused changes
- Run tests before marking complete
- If blocked, explain why and transition to the appropriate state
