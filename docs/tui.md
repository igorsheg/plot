# TUI

The TUI is the operator view for a Plot workflow.

```bash
plot tui --workflow WORKFLOW.md
```

It is built for a fleet, not a single log stream.

You should be able to answer:

- What is running?
- What is blocked?
- What is waiting for retry?
- What looks stale?
- What just happened?

## Display hints

Extensions influence the dashboard through `display` hints on work items.

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

## What extensions cannot do

Extensions cannot provide:

- React components
- terminal drawing code
- custom keybindings
- custom row renderers
- workflow-specific TUI panels

This keeps the dashboard generic. A GitHub PR, Linear issue, CI failure, or dependency update should all look like Plot work.

## Raw events

The TUI keeps raw events available for debugging, but the default view is projected state.

That is intentional. Operators need a dashboard first and an event log second.
