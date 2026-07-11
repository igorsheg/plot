# plot-ai

Plot is a control plane for coding-agent work. The package installs the `plot` CLI and its complete Workflow, extension SDK, terminal, web, HTTP, and protocol documentation.

```bash
npx plot-ai --help
```

Or install globally:

```bash
npm install -g plot-ai
plot init
plot auth login
plot open WORKFLOW.md
```

Extensions use the public SDK:

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";
```

Print the bundled extension contract or an LLM-ready authoring prompt:

```bash
plot docs extensions
plot docs extension-prompt
```

Project: https://github.com/igorsheg/plot
