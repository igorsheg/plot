# Plot Docs

Plot runs coding agents on work your code discovers.

The public model is small:

```txt
extension finds work and registers tools
workflow prompt teaches the agent
Plot schedules runs and shows the fleet
```

If you are writing a Plot extension, start here:

- [Quickstart](quickstart.md) — install Plot and run a workflow.
- [Workflows](workflows.md) — configure the agent, extension, prompt, and resources.
- [Extensions](extensions.md) — write trusted TypeScript that discovers work and registers tools.
- [TUI](tui.md) — own one live Plot Session from a terminal dashboard.
- [Web](web.md) — open the localhost fleet control panel.

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
import { definePlotExtension, defineTool } from "plot-ai/sdk";
```

## Dynamic workflows

Ask Plot to forge a normal Workflow Bundle from a goal:

```bash
plot dynamic "Audit each packages/* package and write a report" --out workflows/package-audit
```

`plot dynamic` is itself a Plot workflow: it runs a forge Source, the Agent Run designs `WORKFLOW.md` + `workflow.extension.ts`, a trusted tool writes the bundle, and Plot validates/repairs it before reporting success.
