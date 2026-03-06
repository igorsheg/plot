# plot-ai

`plot-ai` orchestrates coding agents against an issue tracker.

## install

```bash
npx plot-ai --help
```

or install globally:

```bash
npm install -g plot-ai
plot-ai --help
```

## commands

```bash
plot-ai
plot-ai serve
plot-ai web
```

## harness-friendly behavior

- stable subcommands: `serve`, `web`, default dashboard
- non-zero exit codes on failures
- `--help` and `--version` work without side effects

## release channels

- `latest` — stable releases
- `beta` — prerelease builds published under the `beta` dist-tag

## versioning

plot-ai uses semver.

- patch: fixes and small polish
- minor: new backwards-compatible commands or options
- major: breaking cli/config/runtime changes
