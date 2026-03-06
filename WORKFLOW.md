---
tracker:
  kind: github
  active_states:
    - Todo
    - In Progress
    - Human Review
    - Rework
    - Merging
  terminal_states:
    - Done
    - Closed
    - Cancelled
polling:
  interval_ms: 15000
workspace:
  root: ./workspaces
hooks:
  after_create: "WS=$PWD && cd ../.. && rmdir \"$WS\" && git worktree add \"$WS\" HEAD --detach && cd \"$WS\" && bun install --frozen-lockfile"
  before_remove: "WS=$PWD && cd ../.. && git worktree remove \"$WS\" --force || true"
  timeout_ms: 120000
agent:
  max_concurrent_agents: 5
  max_turns: 50
  max_retry_backoff_ms: 60000
codex:
  command: pi
  turn_timeout_ms: 1800000
  stall_timeout_ms: 120000
server:
  port: 3000
---

You are working on issue **{{ issue.identifier }}: {{ issue.title }}** in the `igorsheg/plot` repository.

{% if issue.description %}
## Description
{{ issue.description }}
{% endif %}

{% if issue.labels.size > 0 %}
**Labels**: {{ issue.labels | join: ", " }}
{% endif %}

{% if attempt %}
This is continuation attempt #{{ attempt }}. Review the previous work in the workspace and continue from where you left off. Do not repeat completed work.
{% else %}
Start fresh. Read the codebase, understand the context, then implement the changes.
{% endif %}

## Status map

Issue state is controlled via GitHub labels. The orchestrator reads labels to determine state.

- `Todo` → queued for work. Immediately move to `In Progress` before starting.
- `In Progress` → implementation actively underway.
- `Human Review` → PR is open and validated; waiting on human approval.
- `Rework` → reviewer requested changes; read feedback and address it.
- `Merging` → human approved; merge the PR and close the issue.
- `Done` / `Closed` → terminal; no further action.

## State transitions via labels

To change issue state, use `gh` CLI to swap labels:

```bash
# move to "In Progress"
gh issue edit {{ issue.identifier }} --add-label "In Progress" --remove-label "Todo" --repo igorsheg/plot

# move to "Human Review"
gh issue edit {{ issue.identifier }} --add-label "Human Review" --remove-label "In Progress" --repo igorsheg/plot

# move to "Done" (terminal)
gh issue edit {{ issue.identifier }} --add-label "Done" --remove-label "Merging" --repo igorsheg/plot
gh issue close {{ issue.identifier }} --repo igorsheg/plot
```

## Step 0: Route by current state

1. Determine the current issue state from labels.
2. Route to the matching flow:
   - `Todo` → move to `In Progress`, then start Step 1.
   - `In Progress` → continue Step 1 from current workspace state.
   - `Human Review` → do nothing. The orchestrator will re-dispatch when a human changes the state.
   - `Rework` → go to Step 3 (rework flow).
   - `Merging` → go to Step 4 (merge flow).
   - `Done` / `Closed` → do nothing, shut down.

## Step 1: Implementation (Todo / In Progress)

1. Read the codebase and understand the context for the change.
2. If arriving from `Todo`, move the issue to `In Progress`.
3. Implement the changes. Keep diffs minimal and focused.
4. Run verification: typecheck, lint, and tests must pass.
5. Commit changes and push to a new branch:
   ```bash
   git checkout -b {{ issue.identifier | remove: "#" }}-<short-description>
   git push origin HEAD
   ```
6. Create a pull request:
   ```bash
   gh pr create --title "{{ issue.identifier }}: {{ issue.title }}" --body "Resolves {{ issue.identifier }}" --repo igorsheg/plot
   ```
7. Move the issue to `Human Review`:
   ```bash
   gh issue edit {{ issue.identifier }} --add-label "Human Review" --remove-label "In Progress" --repo igorsheg/plot
   ```

Do NOT close the issue. A human will review the PR and decide next steps.

## Step 2: Human Review (waiting)

When the issue is in `Human Review`:
- Do not make code changes.
- Do not modify the issue.
- The orchestrator will re-dispatch you when a human changes the state.

## Step 3: Rework (addressing review feedback)

When the issue is in `Rework`, a human has requested changes on the PR.

1. Find the open PR for this issue:
   ```bash
   gh pr list --head <branch-name> --repo igorsheg/plot --json number,url
   ```

2. Read ALL feedback from the PR:
   ```bash
   # top-level comments
   gh pr view <pr-number> --repo igorsheg/plot --comments

   # inline review comments (line-level feedback)
   gh api repos/igorsheg/plot/pulls/<pr-number>/comments

   # review summaries
   gh pr view <pr-number> --repo igorsheg/plot --json reviews
   ```

3. Address every actionable comment — either:
   - implement the requested change, or
   - reply with a justified explanation of why you disagree.

4. Run verification: typecheck, lint, and tests must pass.

5. Push the fixes to the existing branch.

6. Move the issue back to `Human Review`:
   ```bash
   gh issue edit {{ issue.identifier }} --add-label "Human Review" --remove-label "Rework" --repo igorsheg/plot
   ```

## Step 4: Merging (land the PR)

When the issue is in `Merging`, a human has approved the PR.

1. Find the approved PR:
   ```bash
   gh pr list --head <branch-name> --repo igorsheg/plot --json number,url
   ```

2. Merge the PR:
   ```bash
   gh pr merge <pr-number> --squash --repo igorsheg/plot
   ```

3. Move the issue to `Done` and close it:
   ```bash
   gh issue edit {{ issue.identifier }} --add-label "Done" --remove-label "Merging" --repo igorsheg/plot
   gh issue close {{ issue.identifier }} --repo igorsheg/plot
   ```

## Guidelines

- Make minimal, focused changes.
- Run typecheck + lint before any state transition.
- If blocked by missing permissions or unclear requirements, explain why in a comment on the issue and leave the state unchanged.
- Never close an issue until the PR is merged (Step 4 only).
