# Programmatic Plot example

This example defines its Extension and Workflow as values, starts Plot in the current Node process, waits for one automatically dispatched Agent Run, and disposes every owned resource.

From a project that has `plot-ai` installed, run the offline lifecycle smoke test:

```bash
node smoke.mjs
```

It exercises value-only setup, automatic and manual ticks, observations, an authoritative Operator Action, concurrent-start coalescing, stop, restart, and disposal. Discovery returns only blocked work, so its placeholder credential is never sent to a provider.

To dispatch a real Agent Run:

```bash
ANTHROPIC_API_KEY=... node index.mjs
```

There is no `WORKFLOW.md`, Extension module path, CLI daemon, or manual scheduler loop. `cwd` is passed only as the Agent tool execution root; both Workflows disable tools.
