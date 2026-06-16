# Entrypoints use the control protocol

Superseded by [0015 Product command and session lifecycle](0015-product-command-and-session-lifecycle.md) for command names, daemon ownership, and the web gateway split.

Plot product entrypoints such as `plot tui`, `plot run`, and `plot web` use the Local Plot Server and explicit control protocol by default. In-process session hosts may remain for tests or explicit escape hatches, but they are not the normal runtime path.
