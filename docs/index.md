# Plot Docs

Plot runs coding agents on work your code discovers.

The public model is small:

```txt
extension finds work
workflow prompt teaches the agent
Plot schedules runs and shows the fleet
```

If you are writing a Plot extension, start here:

- [Quickstart](quickstart.md) — install Plot and run a workflow.
- [Workflows](workflows.md) — configure the agent, extension, prompt, and resources.
- [Extensions](extensions.md) — write trusted TypeScript that discovers work.
- [TUI](tui.md) — make work readable in the dashboard with display hints.

## Ask an agent to write an extension

Plot docs are written to be pasted into an LLM.

```bash
plot docs extension-prompt | pbcopy
```

Then add your goal:

```txt
Create a Plot extension that watches Linear issues tagged agent-ready.
```

The agent should use the public SDK only:

```ts
import { definePlotExtension } from "plot-ai/sdk";
```
