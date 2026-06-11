# Dynamic Architecture Exploration

Before judging code quality, understand the architecture around the changed files. Do not rely on the diff alone.

## 1. Map boundaries

Identify what each changed path belongs to:

- runtime/core state owner
- public API/exported package surface
- protocol or serialization boundary
- CLI/process/stdout boundary
- auth/secret/path boundary
- persistence/filesystem boundary
- UI/TUI boundary
- tests only
- config/dependency/build only

Escalate risk when changes cross boundaries or alter public contracts.

## 2. Explore owner modules

For each changed source file:

```bash
# Find exported symbols and callers
rg "<ClassName|functionName|typeName>" .

# Find package exports and dependency declarations
rg '"exports"|"dependencies"' package.json packages/*/package.json

# Find sibling conventions
rg "similarFunction|similarCommand|similarError" <nearby-dir>
```

Read:

1. the changed file
2. the module that owns the public contract
3. at least one important caller
4. related tests
5. sibling implementations of similar behavior

## 3. Trace behavior

For behavioral changes, identify entry points and flow:

```text
Input/command/event -> adapter -> domain/runtime owner -> side effect/output -> test/assertion
```

Check both producer and consumer sides for protocol/API changes.

## 4. Check service conventions

Before flagging style or design, understand local conventions:

- error handling style
- logging/telemetry style
- cancellation/shutdown pattern
- test fixture style
- dependency injection/factory pattern
- public export pattern

Do not flag a pattern merely because you personally prefer another. Flag deviations that create real risk or inconsistency.

## 5. Build context summary

For medium/large/high-risk PRs, include a short context summary:

```md
### Architecture Context

- Boundary touched:
- Entry points inspected:
- Callers/consumers inspected:
- Runtime/state/protocol flow:
- Tests inspected/run:
```

For tiny PRs, keep this internal and do not pad the report.
