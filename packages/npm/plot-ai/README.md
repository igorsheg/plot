# plot-ai

Plot is a control plane for Source-driven coding-agent Workflows. The package installs the `plot` CLI, exports the Extension SDK as `plot-ai/sdk`, and exports the in-process runtime from `plot-ai`.

```bash
npm install -g plot-ai
plot auth login
plot check WORKFLOW.md
plot WORKFLOW.md
```

`plot WORKFLOW.md` starts or attaches to the Workflow's Active Session. `q` or Ctrl-C confirms before stopping; `d` explicitly detaches. Use `plot status WORKFLOW.md` for a quick shell summary, `plot stop WORKFLOW.md` from another shell, and `plot web` for the Fleet Web Console.

Application code can also own a value-only, in-process runtime:

```ts
import { createPlot } from "plot-ai";
import { defineWorkflow } from "plot-ai/sdk";

const workflow = defineWorkflow({
	name: "review",
	agent: { provider: "anthropic", model: "claude-sonnet-4-6" },
	extension: { use: reviewer },
	prompt: "Review {{ work.title }}.",
});
const plot = await createPlot({
	credentials: {
		anthropic: { type: "api-key", apiKey: process.env["ANTHROPIC_API_KEY"]! },
	},
});
const session = await plot.start(workflow);
// Plot ticks automatically. Call session.stop() or plot.dispose() explicitly.
```

Programmatic Plot does not read Workflow/config/resource files or reuse CLI auth. See `plot docs programmatic`.

Extensions import only the public SDK:

```ts
import { defineExtension, defineTool } from "plot-ai/sdk";
```

Print the bundled authoring references:

```bash
plot docs guide
plot docs extensions
plot docs programmatic
plot docs sdk
plot docs --paths
```

Project: https://github.com/igorsheg/plot
