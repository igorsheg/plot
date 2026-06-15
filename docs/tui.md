# TUI

The TUI is the terminal operator view for one attached Plot Session. Use `plot web` when you want the multi-session fleet view.

```bash
plot --workflow WORKFLOW.md
```

By default it uses or autostarts the machine-local Plot Server and attaches over the explicit control protocol. The session appears in the shared roster used by other local clients. Quitting or pressing Ctrl-C closes this Plot Session; use `plot web` for detached fleet observation and `plot stop --all` to stop the whole local daemon. Use `--no-server` only as an explicit local test/escape hatch.

It is built as a Process Table, not a single log stream. The same per-session projection is used by the web drill-in view.

You should be able to answer:

- What is running?
- What is blocked?
- What is waiting for retry?
- What looks stale?
- What just happened?
- How much token usage and cost has this fleet consumed?

## Display hints

Extensions influence the dashboard through `display` hints on work items and through generic pi agent events. The TUI stays source-agnostic.

```ts
display: {
  kind: "github-pr-review",
  primary: "#42",
  title: "Fix checkout totals",
  subtitle: "acme/web · main...feature",
  url: "https://github.com/acme/web/pull/42",
  version: "abc1234",
  labels: ["fresh"],
}
```

These are hints, not UI code.

Plot decides how to render rows, details, colors, debug events, and keybindings.

## What extensions can do

Extensions can provide:

- `primary` — short identifier, like `#42` or `ENG-123`
- `title` — human-readable work title
- `subtitle` — useful secondary context
- `url` — external link
- `version` — short revision text
- `labels` — generic labels
- `kind` — source kind for debugging and grouping

Extension-registered tools can also emit pi tool updates. Token usage and cost totals come from the Agent Runs Plot schedules, keeping the dashboard centered on one execution unit.

## What extensions cannot do

Extensions cannot provide:

- React components
- terminal drawing code
- custom keybindings
- custom row renderers
- workflow-specific TUI panels

This keeps the dashboard generic. A GitHub PR, Linear issue, CI failure, or dependency update should all look like Plot work. Extension-specific meaning should appear as titles, labels, URLs, tool output, or agent prose—not hardcoded TUI concepts.

## Raw events

The TUI keeps raw events available for debugging, but the default view is projected state.

That is intentional. Operators need a dashboard first and an event log second.
