# Plot Desktop (macOS)

Native macOS menu bar app for managing plot-ai instances across projects.

## Build & Run

```bash
# Generate Xcode project (requires xcodegen)
cd packages/desktop
xcodegen generate

# Open in Xcode
open Plot.xcodeproj

# Or build from command line
xcodebuild -scheme Plot -configuration Debug build
```

## Architecture

- **Swift + SwiftUI** with [The Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture)
- **macOS 14+** (Sonoma)
- Menu bar app that spawns `plot-ai serve` per project
- Communicates via SSE (`/rpc/events`) for real-time agent status

## Structure

```
Plot/
├── App/          # App entry point, delegate
├── Features/     # TCA features (reducer + view pairs)
├── Clients/      # TCA dependency clients
├── Models/       # Domain models
└── Resources/    # Assets, entitlements
```
