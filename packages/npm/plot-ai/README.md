# plot-ai

Plot is a control plane for durable, Source-driven coding-agent Workflows. The package installs the `plot` CLI and exports the supported Extension SDK as `plot-ai/sdk`.

```bash
npm install -g plot-ai
plot auth login
plot check WORKFLOW.md
plot WORKFLOW.md
```

`plot WORKFLOW.md` starts or attaches to the Workflow's Active Plot Session. `q` or Ctrl-C confirms before stopping; `d` explicitly detaches. Use `plot stop WORKFLOW.md` from another shell and `plot web` for the Fleet Web Console.

Extensions import only the public SDK:

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";
```

Print the bundled authoring references:

```bash
plot docs guide
plot docs extensions
plot docs sdk
plot docs --paths
```

Project: https://github.com/igorsheg/plot
