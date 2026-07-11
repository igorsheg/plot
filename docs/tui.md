# Terminal Dashboard

```bash
plot open WORKFLOW.md
# `plot` alone is the same terminal entrypoint
```

The TUI starts one managed child Session through the shared run registry and renders events observed during that process lifetime. It is a live control room, not a durable attach/resume client. Exiting the TUI stops the run it started.

## What it shows

The default Process Table projects generic Plot concepts:

- Work Items and Source-owned state: pending, running, waiting, blocked, draining, completed;
- current or latest Agent Run;
- live agent prose/tool activity;
- retries, scheduled wakes, diagnostics, and recent history;
- token usage and throughput when reported by the Agent Session.

Raw RuntimeEvents remain available in debug mode and through `plot events`/`plot runs logs`.

## Keys

| Key          | Action                                                |
| ------------ | ----------------------------------------------------- |
| `j` / Down   | Select next Work Item or scroll the current view.     |
| `k` / Up     | Select previous Work Item or scroll the current view. |
| Enter        | Open selected Work Item detail.                       |
| Escape       | Return to runs or close help.                         |
| `o`          | Open the selected Work Item HTTP(S) URL.              |
| `t`          | Request an immediate `session.tick`.                  |
| `g`          | Refresh rendering.                                    |
| `d`          | Toggle RuntimeEvent debug view.                       |
| `c`          | Toggle Session configuration view.                    |
| `?`          | Toggle key help.                                      |
| `q` / Ctrl-C | Stop the run and exit.                                |

## Display contract

Extensions may provide generic `display` hints:

```ts
display: {
  kind: "pull-request",
  primary: "#42",
  title: "Fix checkout totals",
  subtitle: "acme/web · main...feature",
  url: "https://github.com/acme/web/pull/42",
  version: "abc1234",
  labels: ["fresh"],
}
```

These fields have no scheduling semantics. Extensions cannot provide components, row renderers, keybindings, custom panels, or terminal drawing code. Domain meaning belongs in titles, labels, URLs, tool output, and agent prose; the TUI remains generic over Plot Work Items, Agent Runs, Sources, and RuntimeEvents.

## Live versus durable views

The TUI subscribes after spawning its run and intentionally does not rebuild old state from the Session JSONL file. The web gateway owns durable baseline replay plus gapless SSE continuation. To inspect durable history from a terminal, use:

```bash
plot runs logs <run-id> --after 0
plot events stream <run-id> --after 0
```
