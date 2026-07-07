---
name: plot-debug-lab
description: Synthetic extension that continuously exercises Plot scheduling, projection, TUI, web, tools, hooks, operator actions, retries, drains, cancellations, and timeouts.
version: 1.0.0
plot:
  queueCapacity: 128
  eventCapacity: 512
  eventBufferCapacity: 2048
  tickIntervalMs: 5000
  maxRunDurationMs: 20000
  stallTimeoutMs: 15000
agent:
  thinking: minimal
  maxTurns: 3
  allowProjectConfig: true
extension:
  source: ./debug.extension.ts
  maxConcurrentRuns: 4
  config:
    cycleMs: 90000
    waveSize: 6
    shortSleepMs: 2500
    longSleepMs: 45000
    drainAfterMs: 8000
    includeFailure: true
    includeTimeout: true
    includeCancellation: true
    includeDrain: true
    # Set to e.g. 12 to test discover() failures and last-known-work retention.
    simulateDiscoveryFailureEvery: 0
resources:
  contextFiles: false
  appendSystemPrompt:
    - |
      You are running inside Plot's debug lab. This is synthetic work for UI/runtime inspection.
      Follow the scenario instructions exactly, prefer the registered debug_* tools, keep final messages short, and never ask a human for next steps.
---

# Plot debug lab: {{ work.title }}

This Work Item is synthetic and exists to exercise Plot's runtime and dashboard projections.

Debug scenario JSON:

```json
{{ debugContext }}
```

Rules:

1. Follow the scenario JSON instructions in order.
2. Use the registered `debug_*` tools when instructed.
3. Keep any final natural-language response to one short status line.
