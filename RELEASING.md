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
4. verify bundled pi runtime resources are present in platform packages
5. publish platform packages
6. publish `plot-ai`
7. create the github release for the same version tag

## commands

```bash
PLOT_VERSION=0.0.1 bun run release:build
bun run release:smoke
PLOT_VERSION=0.0.1 PLOT_CHANNEL=latest bun run release:publish:dry-run
PLOT_VERSION=0.0.1 PLOT_CHANNEL=latest bun run release:publish
```

`release:publish:dry-run` still asks npm to validate whether the package version can be published. If the version in `dist/release` was already published, npm rejects the dry-run with `You cannot publish over the previously published versions`.

Use the same unpublished `PLOT_VERSION` for `release:build`, `release:publish:dry-run`, and `release:publish`. For local release validation, prefer an unpublished prerelease-style version such as `0.0.1-beta.0` with `PLOT_CHANNEL=beta` so you do not collide with an existing stable release.
