# Plot weather watch example

A nested-work demo for exercising Subject/children rendering in the TUI and web dashboard.

One Subject — **WX Daily weather digest** — fans out into twelve child Work Items, one per city. Each child reads deterministic synthetic station data and writes a markdown report into the OS temp dir. Nothing outside that directory is touched.

Children: 11 real cities plus **Atlantis**, which has no weather station and is discovered `blocked` with a `Skip city` Operator Action, so the Attention path stays populated.

## Run

From the repository root:

```bash
plot examples/weather-watch/WORKFLOW.md
```

Reports land in:

```txt
<os-tmp>/plot-weather-watch/<city>.md
```

## What to look for

- The Work table shows one `◆` Subject row with dense one-line children, bounded to five visible rows plus a `… +N more` overflow line (`maxConcurrentRuns: 4` keeps four agents running against twelve children).
- Live children sort ahead of idle ones, so the visible window shows the running agents.
- `j/k` to the Subject row, `enter` drills into the Subject view listing all twelve children; `enter` on a child opens its detail view; `esc` walks back.
- Atlantis renders as a `▲` attention row; its detail view lists the `Skip city` Operator Action. (The TUI displays Operator Actions; executing one — e.g. from the web console — drops Atlantis from the next discovery and from the digest total.)
- The Subject meta advances `n/12 complete · collecting` as reports land; when every city is reported the Subject disappears until the next `cycleMs` cycle starts a fresh version.

## Config

Edit `WORKFLOW.md` under `extension.config`:

- `cycleMs` — how often a new digest cycle re-creates all city Work Items (default 10 minutes).
- `reportDir` — where markdown reports are written (default `<os-tmp>/plot-weather-watch`).
