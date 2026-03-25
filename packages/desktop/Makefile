REPO_ROOT := $(shell cd ../.. && pwd)
DESKTOP_DIR := $(shell pwd)
BUILD_DIR := $(DESKTOP_DIR)/.build-app
APP_BUNDLE := $(BUILD_DIR)/Plot.app
RESOURCES := $(APP_BUNDLE)/Contents/Resources

# Release build output (produced by scripts/release/build.ts)
RELEASE_DIR := $(REPO_ROOT)/dist/release
PLATFORM_DIR := $(RELEASE_DIR)/plot-ai-darwin-arm64

# ─── dev ────────────────────────────────────────────────────────────────
# builds everything and opens the app

.PHONY: dev
dev: app
	open $(APP_BUNDLE)

.PHONY: app
app: xcode-project plot-release
	xcodebuild \
		-scheme Plot \
		-configuration Debug \
		-destination "platform=macOS" \
		-skipMacroValidation \
		CONFIGURATION_BUILD_DIR=$(BUILD_DIR) \
		build
	@# Bundle plot-ai release artifacts into the .app
	mkdir -p $(RESOURCES)
	cp $(PLATFORM_DIR)/bin/plot-ai $(RESOURCES)/plot-ai
	cp $(PLATFORM_DIR)/bin/package.json $(RESOURCES)/package.json
	@[ -f $(PLATFORM_DIR)/bin/tui-worker.js ] && cp $(PLATFORM_DIR)/bin/tui-worker.js $(RESOURCES)/tui-worker.js || true
	@[ -d $(PLATFORM_DIR)/web-dist ] && cp -R $(PLATFORM_DIR)/web-dist $(RESOURCES)/web-dist || true
	@[ -d $(PLATFORM_DIR)/pi-resources ] && cp -R $(PLATFORM_DIR)/pi-resources $(RESOURCES)/pi-resources || true
	@[ -d $(PLATFORM_DIR)/bin/tracker ] && cp -R $(PLATFORM_DIR)/bin/tracker $(RESOURCES)/tracker || true
	@echo "✓ Plot.app ready at $(APP_BUNDLE)"

# ─── plot-ai release build ──────────────────────────────────────────────
# uses the monorepo's existing release pipeline

.PHONY: plot-release
plot-release: $(PLATFORM_DIR)/bin/plot-ai

$(PLATFORM_DIR)/bin/plot-ai:
	@echo "building plot-ai release (darwin-arm64)..."
	cd $(REPO_ROOT) && bun run scripts/release/build.ts

# ─── xcode ──────────────────────────────────────────────────────────────

.PHONY: xcode-project
xcode-project:
	xcodegen generate

.PHONY: xcode
xcode: xcode-project
	open Plot.xcodeproj

# ─── release ────────────────────────────────────────────────────────────

.PHONY: release
release: xcode-project plot-release
	xcodebuild \
		-scheme Plot \
		-configuration Release \
		-destination "platform=macOS" \
		-skipMacroValidation \
		CONFIGURATION_BUILD_DIR=$(BUILD_DIR) \
		build
	mkdir -p $(RESOURCES)
	cp $(PLATFORM_DIR)/bin/plot-ai $(RESOURCES)/plot-ai
	cp $(PLATFORM_DIR)/bin/package.json $(RESOURCES)/package.json
	@[ -f $(PLATFORM_DIR)/bin/tui-worker.js ] && cp $(PLATFORM_DIR)/bin/tui-worker.js $(RESOURCES)/tui-worker.js || true
	@[ -d $(PLATFORM_DIR)/web-dist ] && cp -R $(PLATFORM_DIR)/web-dist $(RESOURCES)/web-dist || true
	@[ -d $(PLATFORM_DIR)/pi-resources ] && cp -R $(PLATFORM_DIR)/pi-resources $(RESOURCES)/pi-resources || true
	@[ -d $(PLATFORM_DIR)/bin/tracker ] && cp -R $(PLATFORM_DIR)/bin/tracker $(RESOURCES)/tracker || true
	@echo "✓ Release build at $(APP_BUNDLE)"

# ─── clean ──────────────────────────────────────────────────────────────

.PHONY: clean
clean:
	trash $(BUILD_DIR) 2>/dev/null || true
	trash $(DESKTOP_DIR)/.build 2>/dev/null || true
	trash Plot.xcodeproj 2>/dev/null || true
	trash ~/Library/Developer/Xcode/DerivedData/Plot-* 2>/dev/null || true

.PHONY: clean-all
clean-all: clean
	trash $(RELEASE_DIR) 2>/dev/null || true
