---
name: pr-review
description: High-agency GitHub pull request review. Use for reviewing PRs with bash, git, gh, ripgrep, and repository access. Focuses on dynamic architecture understanding, behavioral path verification, test coverage, evidence-backed findings, and concise GitHub-ready reports.
version: 1.0.0
---

# PR Review Skill

You are not a checklist executor. You are a senior reviewer with codebase access. Use the repository, `gh`, `git`, `rg`, tests, and judgment.

## Core stance

- Build your own understanding before judging.
- Prefer verified findings over broad advice.
- Do not flag issues you have not proved in code.
- Do not pad reports with empty sections.
- Match review depth to PR risk.
- Use GitHub review structure well: one concise top-level review body plus inline review threads for line-specific findings. A single blob comment is a fallback, not the preferred shape.

## 1. Identify the target

Use one or more:

```bash
gh pr view --json number,title,isDraft,baseRefName,headRefName,url,author,headRefOid,additions,deletions,changedFiles
gh pr view <number> --json number,title,isDraft,baseRefName,headRefName,url,author,headRefOid,files,commits,additions,deletions
git branch --show-current
gh repo view --json nameWithOwner -q '.nameWithOwner'
```

Skip draft PRs if the workflow says drafts should be skipped.

## 2. Detect re-review

Check whether you already reviewed this PR:

```bash
CURRENT_GH_USER=$(gh api user -q '.login')
gh api repos/<owner>/<repo>/pulls/<number>/reviews \
  --jq "[.[] | select(.user.login == \"$CURRENT_GH_USER\" and .state != \"DISMISSED\")] | sort_by(.submitted_at) | last"
```

If an older review exists, fetch its body and comments, inspect commits since then, verify old findings as resolved/still open, and only review new changes for new issues.

## 3. Choose review depth

| Depth            | Use when                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| Tiny sanity      | One small docs/config/test-only change                                         |
| Technical        | Normal implementation PR                                                       |
| Logic deep dive  | State machines, lifecycle, concurrency, retry, protocol, runtime, API behavior |
| Safety deep dive | Auth, secrets, money, filesystem paths, process/stdout boundary, dependencies  |
| Full review      | Large, high-risk, cross-package, or unfamiliar architecture                    |

When in doubt, go deeper for code that owns runtime state, external boundaries, or irreversible side effects.

## 4. Build architecture context

Read `references/architecture-exploration.md` for the full method.

At minimum:

1. Map changed files to package/module boundaries.
2. Read changed files plus owner modules.
3. Find callers and exported consumers with `rg`.
4. Inspect related tests.
5. Search sibling patterns for established conventions.
6. For protocol/process/API changes, verify both producer and consumer sides.

## 5. Verify behavior paths

For each behavior-changing function, think through meaningful paths:

- success/failure
- empty/undefined/malformed input
- sync/async completion
- cancellation/timeout/shutdown
- duplicate requests/work
- concurrency/running vs idle
- old vs new behavior for fixes/refactors

For high-risk paths, trace a concrete example. Do not approve with an unresolved “maybe”.

## 6. Analyze tests

Read `references/testing-patterns.md`.

Tests are strong when they prove behavior, edge cases, and regressions. Tests are weak when they only assert mocks, snapshots, or implementation accidents.

Missing tests are serious for:

- new public API/command
- protocol/process boundary behavior
- lifecycle/cancellation/shutdown changes
- bug fixes without regression tests
- error-handling changes
- auth/secret/path behavior

## 7. Produce the review

Report size should match PR size.

For small PRs:

```md
## Review Summary

[What changed, what you verified, verdict.]

No issues found.
```

For medium/large/high-risk PRs:

```md
## Review Summary

[Concise summary.]

### Architecture Context

- Packages/modules inspected:
- Entry points/callers inspected:
- Tests inspected/run:

### Findings

- ![P0](https://img.shields.io/badge/P0-red?style=flat) `path:line` — [title]. [Impact.] Evidence: [what proved it]. Fix: [concrete fix].

### Confidence

High/Medium/Low — [why].
```

Use priority badges/severities. Use raw Shields URLs, not GitHub Camo URLs; GitHub rewrites external images through Camo when rendering Markdown.

- ![P0](https://img.shields.io/badge/P0-red?style=flat) **P0**: correctness/security/data loss/boundary issue that should block merging.
- ![P1](https://img.shields.io/badge/P1-orange?style=flat) **P1**: real issue that should be fixed but may not block.
- ![P2](https://img.shields.io/badge/P2-yellow?style=flat) **P2**: cleanup, maintainability, clarity.

## 8. Post with GitHub tools

Default:

```bash
gh pr review <number> --comment --body-file /tmp/review.md
```

Include a durable marker in the body when the workflow asks for one:

```md
<!-- plot-pr-review:<head-sha> -->
```

For line-specific findings, prefer creating one GitHub review with inline comments in the same API call:

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR=<number>
HEAD=$(gh pr view "$PR" --json headRefOid -q .headRefOid)

cat > /tmp/review-body.md <<EOF
<!-- plot-pr-review:$HEAD -->

## PR Review

**Disposition:** COMMENT
**Verification:** ...
**Head:** \`$HEAD\`

### Summary
...
EOF

cat > /tmp/review.json <<EOF
{
  "commit_id": "$HEAD",
  "event": "COMMENT",
  "body": $(jq -Rs . < /tmp/review-body.md),
  "comments": [
    {
      "path": "src/example.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "![P1](https://img.shields.io/badge/P1-orange?style=flat) — Finding title. Impact, evidence, and fix."
    }
  ]
}
EOF

gh api "repos/$OWNER_REPO/pulls/$PR/reviews" --method POST --input /tmp/review.json
```

Use `event: "REQUEST_CHANGES"` for verified blocking P0 findings when allowed. If inline coordinates are rejected, inspect the diff and retry once. If still brittle, fall back to `gh pr review <number> --comment --body-file /tmp/review.md` and include findings in the body.
