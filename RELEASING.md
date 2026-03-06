# releasing plot-ai

## channels

- `latest` — stable releases
- `beta` — prerelease builds

## versioning

plot-ai uses lockstep semver across the public npm surface.

- patch: fixes and small polish
- minor: backwards-compatible commands, flags, and packaging improvements
- major: breaking cli flags, config, or runtime behavior

## publish flow

1. choose a version
2. run the full verification gates
3. build release artifacts
4. publish platform packages
5. publish `plot-ai`
6. create the github release for the same version tag

## commands

```bash
PLOT_VERSION=0.0.1 bun run release:build
bun run release:smoke
PLOT_CHANNEL=latest bun run release:publish:dry-run
PLOT_VERSION=0.0.1 PLOT_CHANNEL=latest bun run release:publish
```
