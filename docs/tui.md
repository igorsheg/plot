# TUI

```bash
plot open WORKFLOW.md
```

The terminal dashboard opens one live Plot Session and renders a Process Table: Work Items plus their current or latest Agent Run. The same session is visible in `plot open --web`.

It should answer:

- what is running
- what is blocked or waiting
- what looks stale
- what just happened
- usage and cost so far

## Display hints

Extensions influence the dashboard through Work Item `display` hints. Plot owns rendering.

```ts
display: {
  primary: "#42",
  title: "Fix checkout totals",
  subtitle: "acme/web · main...feature",
  url: "https://github.com/acme/web/pull/42",
  version: "abc1234",
  labels: ["fresh"],
}
```

Extensions may provide titles, labels, URLs, versions, and short status text. They may not provide React components, keybindings, terminal drawing code, custom panels, or row renderers.

GitHub PRs, Linear issues, CI failures, and dependency updates should all look like Plot work. Source-specific meaning belongs in titles, labels, URLs, tool output, or agent prose.

Raw events stay available for debugging, but the default view is projected state.
