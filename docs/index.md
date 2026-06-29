# Plot Docs

Plot runs coding agents on work your TypeScript discovers.

```txt
extension finds work + tools
workflow prompt teaches judgment
Plot schedules Agent Runs and shows dashboards
```

Start here:

- [Quickstart](quickstart.md) — install, auth, run a Workflow.
- [Workflows](workflows.md) — front matter, prompt, resources.
- [Extensions](extensions.md) — trusted TypeScript that discovers Work Items and tools.
- [TUI](tui.md) — terminal dashboard.
- [Web](web.md) — browser dashboard and HTTP API.

For LLM-assisted extension authoring:

```bash
plot docs extension-prompt | pbcopy
```

Use the public SDK only:

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";
```
