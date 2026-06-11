# Test Coverage Analysis

Use tests to verify behavior, not to count files.

## Find tests

```bash
rg "<ChangedClassName|functionName|commandName>" test packages -n
rg "describe|test\(|it\(|should" <test-file>
```

Also inspect boundary/process tests when the changed behavior crosses a process, protocol, filesystem, auth, or UI boundary.

## Adequacy rules

Tests are adequate when they prove:

- happy path
- important edge cases
- failure path
- regression for bug fixes
- externally visible behavior rather than implementation details

Tests are weak when they:

- only assert mocked return values
- snapshot huge output without focused behavior checks
- duplicate implementation logic
- assert that a function was called but not what changed externally
- exercise only one branch of a behavioral change

## Missing tests are serious for

| Change                    | Expected coverage                                |
| ------------------------- | ------------------------------------------------ |
| New public API/command    | behavior test                                    |
| Protocol/framing/stdout   | boundary/process or transport test               |
| Runtime lifecycle         | cancellation/shutdown/timeout/running-state test |
| Auth/path/secret behavior | path/state isolation test                        |
| Bug fix                   | regression test proving the bug is fixed         |
| Error handling            | error path test                                  |
| Dependency/build change   | typecheck/build plus import/usage validation     |

## Report format

Only include when useful:

```md
### Test Coverage

| Changed code       | Tests found      | Coverage                  | Verdict |
| ------------------ | ---------------- | ------------------------- | ------- |
| `module.function`  | `module.test.ts` | happy + failure           | OK      |
| `protocol command` | none             | missing boundary behavior | HIGH    |
```
