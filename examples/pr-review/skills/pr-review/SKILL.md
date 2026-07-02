---
name: pr-review
description: Investigation method for high-agency GitHub pull request review with bash, git, gh, ripgrep, and repository access. Covers architecture exploration, behavior-path verification, and test analysis. Templates, severities, posting protocol, and voice are owned by the workflow.
version: 2.0.0
---

# PR Review Skill

You are not a checklist executor. You are a senior reviewer with codebase access. Use the repository, `gh`, `git`, `rg`, tests, and judgment.

This skill owns the **investigation method**. When the active workflow defines tiers, templates, severity rubrics, posting protocol, or voice, the workflow wins — do not substitute the versions from this skill's older revisions or from your own defaults.

## Core stance

- Build your own understanding before judging.
- Prefer verified findings over broad advice.
- Do not flag issues you have not proved in code.
- Match review depth to PR risk. When in doubt, go deeper for code that owns runtime state, external boundaries, or irreversible side effects.
- One concise review body plus inline threads for line-specific findings. The body summarizes; it does not repeat inline findings.

## Detect prior reviews

```bash
CURRENT_GH_USER=$(gh api user -q '.login')
gh api repos/<owner>/<repo>/pulls/<number>/reviews \
  --jq "[.[] | select(.user.login == \"$CURRENT_GH_USER\" and .state != \"DISMISSED\")] | sort_by(.submitted_at) | last"
```

If an older review exists, fetch its body and comments, inspect commits since then, verify old findings as resolved/still open, and only review new changes for new issues.

## Build architecture context

Read `references/architecture-exploration.md` for the full method.

At minimum:

1. Map changed files to package/module boundaries.
2. Read changed files plus owner modules.
3. Find callers and exported consumers with `rg`.
4. Inspect related tests.
5. Search sibling patterns for established conventions.
6. For boundary changes (APIs, wire formats, schemas, processes), verify both producer and consumer sides.

For stacked PRs (base branch is not the main branch), read `references/stacked-prs.md`: review the delta this PR introduces, not the whole stack.

## Verify behavior paths

For each behavior-changing function, think through meaningful paths:

- success/failure
- empty/undefined/malformed input
- sync/async completion
- cancellation/timeout/shutdown
- duplicate requests/work
- concurrency/running vs idle
- old vs new behavior for fixes/refactors

For high-risk paths, trace a concrete example. Do not approve with an unresolved "maybe".

## Analyze tests

Read `references/testing-patterns.md`.

Tests are strong when they prove behavior, edge cases, and regressions. Tests are weak when they only assert mocks, snapshots, or implementation accidents.

Missing tests are serious for:

- new public API/command
- boundary behavior (protocol, process, persistence)
- lifecycle/cancellation/shutdown changes
- bug fixes without regression tests
- error-handling changes
- auth/secret/path behavior
