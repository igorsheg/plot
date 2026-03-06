---
name: plot-commit
description: "session-aware conventional commits for plot. produces commits with summary, rationale, and validation evidence. use when committing implementation work during orchestrated issue execution."
---

# plot-commit

## goals

- produce commits that reflect the actual code changes and session context
- follow conventional commit format with rationale
- never stage unrelated changes

## steps

1. inspect working tree and staged changes:
   ```bash
   git status
   git diff
   git diff --staged
   ```

2. stage only your changes explicitly — never `git add -A` or `git add .`:
   ```bash
   git add <specific-files>
   ```

3. sanity-check staged files — flag build artifacts, logs, or temp files before committing.

4. choose a conventional type that matches the change:
   - `feat(scope):` — new feature
   - `fix(scope):` — bug fix
   - `refactor(scope):` — restructuring without behavior change
   - `docs(scope):` — documentation only
   - `test(scope):` — test additions/changes
   - `chore(scope):` — tooling, deps, config

5. write the commit message:
   ```
   <type>(<scope>): <short summary, imperative mood, ≤72 chars>

   Summary:
   - <what changed>

   Rationale:
   - <why it changed>

   Validation:
   - <what was verified, or "not run (reason)">
   ```

6. commit using a file to preserve formatting:
   ```bash
   cat > /tmp/commit-msg.md << 'EOF'
   <message>
   EOF
   git commit -F /tmp/commit-msg.md
   ```

## rules

- subject line: imperative mood, ≤72 chars, no trailing period
- body lines: wrapped at 72 chars
- staged diff must match the commit message — if they diverge, fix the index or revise the message
- one logical change per commit when practical
