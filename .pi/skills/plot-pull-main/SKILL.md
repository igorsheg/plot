---
name: plot-pull-main
description: "sync current branch with origin/main using merge and zdiff3 conflict resolution. use before implementation starts and before pushing to ensure branch is up to date."
---

# plot-pull-main

## goals

- keep feature branch current with `origin/main`
- resolve merge conflicts with intent-preserving edits
- verify project health after merge

## steps

1. ensure working tree is clean:
   ```bash
   git status
   ```
   if dirty, commit or stash changes first.

2. enable rerere for learned conflict resolution:
   ```bash
   git config rerere.enabled true
   git config rerere.autoupdate true
   ```

3. fetch latest refs:
   ```bash
   git fetch origin
   ```

4. sync remote feature branch first (catches remote auto-commits):
   ```bash
   git pull --ff-only origin $(git branch --show-current) || true
   ```

5. merge origin/main with zdiff3 for clearer conflict context:
   ```bash
   git -c merge.conflictstyle=zdiff3 merge origin/main
   ```

6. if conflicts appear, resolve them following the protocol below, then:
   ```bash
   git add <resolved-files>
   git merge --continue
   ```

7. verify project health:
   ```bash
   bun run typecheck
   bun run lint
   ```

## conflict resolution protocol

- inspect before editing:
  ```bash
  git status                                    # list conflicted files
  git diff                                      # see conflict hunks
  git diff :1:<file> :2:<file>                  # base vs ours
  git diff :1:<file> :3:<file>                  # base vs theirs
  ```

- with zdiff3, conflict markers include `|||||||` (base) between ours and theirs — use it to understand both sides' intent

- resolve strategy:
  1. state what each side is trying to achieve
  2. identify the shared goal
  3. decide the final behavior first, then write the code
  4. prefer preserving API contracts and user-visible behavior

- resolve one file at a time, run verification after each logical batch

- for generated files: resolve source files first, then regenerate

- for import conflicts: accept both sides temporarily, then run lint to remove unused imports

- confirm no conflict markers remain:
  ```bash
  git diff --check
  ```

## rules

- always merge, never rebase (preserves history for orchestrator tracking)
- use `--ff-only` for same-branch pulls only
- document merge result in workpad Notes section:
  - merge source(s)
  - result: `clean` or `conflicts resolved`
  - resulting HEAD short SHA
