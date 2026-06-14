# Remove Source-launched subagents

Plot will remove the Source-launched subagent feature and its public SDK surface. Plot exposes one first-class agent execution unit: the Agent Run for a Work Item. Sources discover and reconcile Work Items and may expose tools, but they do not orchestrate separate Plot-visible subagents; this keeps scheduling, usage accounting, retries, and operator views centered on one execution model.
