# Plot PR Review

Continuous, senior-level review of every open PR in a repository. One bounded Agent Run per PR head, durable state on the PR itself, a live dashboard with human override buttons — and no database, no webhook server, no orchestration code of your own.

```bash
npm install -g plot-ai
npm install --prefix examples/pr-review
plot examples/pr-review/WORKFLOW.md
```

Requires GitHub CLI auth (`gh auth status`) and a provider login (`plot auth login`).

## Why this is not a toy

Every hard operational problem here is handled by Plot's scheduler, not by prompt prose or bespoke glue:

| Real-world event                          | What happens                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Process crashes mid-review                | Anchor comment still says `reviewing`; the next tick reconciles GitHub truth and a fresh run resumes from the anchor's resume notes        |
| Author pushes while a review is running   | The old head's run drains gracefully (never shot for succeeding); the new head is discovered as new work                                   |
| Author pushes three times in five minutes | Quiet period (`quietPeriodMs`) holds the PR as `settling` until the head stabilizes — visible on the board, one review instead of three    |
| GitHub API hiccup during discovery        | Discovery throws, Plot keeps last-known work; live reviews are untouched                                                                   |
| A run fails (auth, model, quota)          | Exponential backoff (10s doubling, 5m cap) — visible as a scheduled wake on the dashboard, not a silent retry storm                        |
| Human wants control                       | Operator Actions on every work item: **Review now** (bypass quiet period), **Skip until new head**, **Review again** (re-review a done PR) |
| Reviewer reviews its own PR               | `REQUEST_CHANGES` is auto-downgraded to `COMMENT` (GitHub forbids self-blocking)                                                           |

The division of labor is the demo:

- **Plot** owns `tick -> reconcile -> act`: scheduling, concurrency, drain, backoff, workspaces, dashboards.
- **The extension** (`github-pr-reviewer.extension.ts`) is a trusted TypeScript observer: it lists open PRs, parses the one anchor comment, applies eligibility policy (`eligibility.ts`, pure and tested), and registers three head-SHA-guarded write tools.
- **The prompt** (`WORKFLOW.md`) teaches judgment: tiering, review lenses, intent-vs-diff checking, CI awareness, feedback-sweep discipline, severity rubric, voice.

No layer reaches into another. Swap the model, the repo, or the review policy independently.

## Review behavior

- **Tiered cost**: `trivial` / `lite` / `full` — lockfile churn gets seconds, cross-package lifecycle changes get producers-and-consumers tracing.
- **Feedback sweep before code**: prior reviews and author replies shape scope; "won't fix" replies are respected; a no-finding review must account for every prior actionable comment.
- **Intent check**: the diff is judged against the PR description; "backwards-compatible" claims get verified.
- **CI-aware**: check status arrives in context; a style-only review on a red build is forbidden.
- **One review, one anchor**: inline comments on changed lines with exact coordinates from `load_pr_diff_context`; the anchor holds status, tier, findings count, and resume notes.
- **Injection-hardened**: PR text is data, not instructions; head-SHA checks guard every write.

## Eligibility controls

```yaml
config:
  includeDrafts: false # drafts held visibly, not reviewed
  includeBots: false # dependabot/renovate/[bot] authors skipped
  quietPeriodMs: 90000 # head must settle before dispatch
  maxOpenPrs: 20
  # requireLabel: ai-review   # opt-in mode: only labeled PRs
```

Authors opt out per-PR with `[skip review]` in the title. Operators override anything from the dashboard.

## Durable state model

The single anchor comment per PR carries a machine marker:

```md
<!-- plot-review:v1 status=<reviewing|done> head=<sha> tier=<trivial|lite|full> -->
```

That marker is the entire persistence layer. Reviewed-at-this-head PRs stay visible on the board as `reviewed` with a **Review again** button; a new push makes them fresh work automatically. Kill the process, move the checkout, run it from a different machine — state reconstructs from GitHub.

## Project shape

```txt
examples/pr-review/
  WORKFLOW.md                       # scheduling config + review judgment
  github-pr-reviewer.extension.ts   # trusted GitHub observer + write tools
  eligibility.ts                    # pure eligibility policy (tested)
  diff-context.ts                   # diff -> changed-line coordinates (tested)
  skills/pr-review/                 # investigation method + references
```

`WORKFLOW.md` explicitly declares its skill resources; `.plot/` stays runtime/state territory.

## Review output

Findings use priority badges with raw Shields.io URLs (GitHub Camo-proofed):

```md
**<sub><sub>![P0 Badge](https://img.shields.io/badge/P0-red?style=flat)</sub></sub> P0 title**
**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub> P1 title**
**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub> P2 title**
```
