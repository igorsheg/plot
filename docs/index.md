# Plot

Plot runs durable, Source-driven coding-agent Workflows.

```txt
Extension  1 ──► many Workflows
Workflow   1 ──► at most one Active Plot Session
Session    1 ──► many Work Items and Agent Runs
```

An Extension is reusable trusted TypeScript. A Workflow configures it for one system and policy: integration configuration, prompt, model, resources, and scheduling. This lets one PR-review Extension serve separate Workflows for different repositories without duplicating core integration logic.

A Plot Session survives dashboard disconnection. The terminal dashboard and Fleet Web Console are clients of the same managed Session.

```bash
plot check WORKFLOW.md
plot WORKFLOW.md
```

`q` or Ctrl-C confirms before stopping the Session. Use `d` to explicitly detach and leave it running.

## Documentation map

| Read                        | When                                                          |
| --------------------------- | ------------------------------------------------------------- |
| [Quickstart](quickstart.md) | Install, authenticate, and run a real Source-driven Workflow. |
| [Agent guide](guide.md)     | Ask a coding agent to build an Extension and Workflow.        |
| [Workflows](workflows.md)   | Configure integration, agent, and runtime policy.             |
| [Extensions](extensions.md) | Implement discovery, identity, tools, and Operator Actions.   |
| [CLI](cli.md)               | Learn the complete small command surface.                     |
| [TUI](tui.md)               | Operate one Workflow Session from the terminal.               |
| [Web Console](web.md)       | Operate the local fleet in a browser.                         |

`plot docs sdk` prints the supported `plot-ai/sdk` declarations. Internal Session Manager, worker transport, RuntimeEvents, and browser routes are not public compatibility interfaces.
