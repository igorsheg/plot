---
name: plot-debug-lab
description: Three realistic long-running synthetic work streams for debugging Plot TUI and web behavior without stress-testing every edge state.
version: 2.0.0
plot:
  queueCapacity: 32
  eventCapacity: 512
  tickIntervalMs: 5000
  maxRunDurationMs: 600000
  stallTimeoutMs: 120000
agent:
  provider: openai-codex
  model: gpt-5.5
  thinking: minimal
  maxTurns: 8
  allowProjectConfig: true
extension:
  source: ./debug.extension.ts
  maxConcurrentRuns: 3
  config:
    cycleMs: 900000
    stepDelayMs: 20000
    # Set to e.g. 20 to test discover() failures while keeping the realistic workload shape.
    simulateDiscoveryFailureEvery: 0
resources:
  contextFiles: false
  appendSystemPrompt:
    - |
      You are running inside Plot's debug lab. This is synthetic work for UI/runtime inspection.
      Treat the scenario as realistic operational work. Use the registered debug_* tools, keep progress concrete, and never ask a human for next steps.
---

# Plot debug lab: {{ work.title }}

This Work Item is one of three realistic long-running synthetic streams. It exists to make the TUI and web dashboard look like normal Plot usage instead of a stress test.

Scenario JSON:

```json
{{ debugContext }}
```

Rules:

1. For each scenario step, call `debug_progress`, then `debug_wait` with the configured `stepDelayMs` unless you have a specific shorter reason.
2. Write at least one requested markdown artifact with `debug_write_artifact`.
3. Finish only after every scenario step is complete by calling `debug_finish` with a concise handoff summary.
4. Keep any final natural-language response to one short status line.
