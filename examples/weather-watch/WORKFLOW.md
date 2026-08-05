---
name: plot-weather-watch
description: One Subject with twelve child Work Items (city weather reports) for exercising nested work rendering in the TUI and web dashboard.
version: 1.0.0
plot:
  tickIntervalMs: 5000
  maxRunDurationMs: 300000
  stallTimeoutMs: 120000
agent:
  provider: openai-codex
  model: gpt-5.5
  thinking: minimal
  maxTurns: 8
  allowProjectConfig: true
extension:
  source: ./weather.extension.ts
  maxConcurrentRuns: 4
  config:
    cycleMs: 600000
    # Defaults to <os-tmp>/plot-weather-watch; set an absolute path to override.
    # reportDir: /tmp/plot-weather-watch
resources:
  contextFiles: false
  appendSystemPrompt:
    - |
      You are running inside Plot's weather-watch demo. This is synthetic work for UI inspection.
      Use the weather_* tools in order, keep responses short, and never ask a human for next steps.
---

# Weather report: {{ cityName }}

You are producing one city's section of the daily weather digest. The data is synthetic and complete — do not look up real weather and do not ask questions.

Report directory: `{{ reportDir }}`
Digest cycle: `{{ cycle }}`

Steps, in order:

1. Call `weather_check` to read today's station data for {{ cityName }}.
2. Call `weather_write_report` with a one-paragraph markdown summary of the reading.
3. Call `weather_finish` with a one-line status.
