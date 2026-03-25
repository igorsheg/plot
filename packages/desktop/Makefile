REPO_ROOT := $(shell cd ../.. && pwd)
DESKTOP_DIR := $(shell pwd)
BUILD_DIR := $(DESKTOP_DIR)/.build-app
APP_BUNDLE := $(BUILD_DIR)/Plot.app
RESOURCES := $(APP_BUNDLE)/Contents/Resources

# plot-ai binary (bun --compile for current platform)
PLOT_ENTRY := $(REPO_ROOT)/packages/plot/src/cli/index.ts
PLOT_TSCONFIG := $(REPO_ROOT)/packages/plot/tsconfig.json
PLOT_BINARY := $(RESOURCES)/plot-ai

# web dashboard
WEB_DIST := $(REPO_ROOT)/packages/web/dist

# ─── dev ────────────────────────────────────────────────────────────────
# builds the app with bundled plot-ai binary + web assets, then opens it

.PHONY: dev
dev: app
	open $(APP_BUNDLE)

.PHONY: app
app: xcode-project plot-binary web-assets
	xcodebuild \
		-scheme Plot \
		-configuration Debug \
		-destination "platform=macOS" \
		-skipMacroValidation \
		CONFIGURATION_BUILD_DIR=$(BUILD_DIR) \
		build
	@# Copy resources into the built .app
	mkdir -p $(RESOURCES)
	cp $(DESKTOP_DIR)/.build-bin/plot-ai $(RESOURCES)/plot-ai
	@[ -d $(WEB_DIST) ] && cp -R $(WEB_DIST) $(RESOURCES)/web-dist || true
	@echo "✓ Plot.app ready at $(APP_BUNDLE)"

# ─── parts ──────────────────────────────────────────────────────────────

.PHONY: xcode-project
xcode-project:
	xcodegen generate

.PHONY: plot-binary
plot-binary: $(DESKTOP_DIR)/.build-bin/plot-ai

$(DESKTOP_DIR)/.build-bin/plot-ai: $(PLOT_ENTRY)
	@echo "compiling plot-ai binary..."
	mkdir -p $(DESKTOP_DIR)/.build-bin
	cd $(REPO_ROOT) && bun build $(PLOT_ENTRY) \
		--compile \
		--outfile $(DESKTOP_DIR)/.build-bin/plot-ai \
		--tsconfig $(PLOT_TSCONFIG)
	chmod +x $(DESKTOP_DIR)/.build-bin/plot-ai

.PHONY: web-assets
web-assets:
	@if [ ! -d $(WEB_DIST) ]; then \
		echo "building web dashboard..."; \
		cd $(REPO_ROOT) && bun run build:web; \
	fi

# ─── swift-only (no xcode) ─────────────────────────────────────────────

.PHONY: swift-build
swift-build:
	swift build

# ─── release ────────────────────────────────────────────────────────────

.PHONY: release
release: xcode-project plot-binary web-assets
	xcodebuild \
		-scheme Plot \
		-configuration Release \
		-destination "platform=macOS" \
		-skipMacroValidation \
		CONFIGURATION_BUILD_DIR=$(BUILD_DIR) \
		build
	mkdir -p $(RESOURCES)
	cp $(DESKTOP_DIR)/.build-bin/plot-ai $(RESOURCES)/plot-ai
	@[ -d $(WEB_DIST) ] && cp -R $(WEB_DIST) $(RESOURCES)/web-dist || true
	@echo "✓ Release build at $(APP_BUNDLE)"

# ─── clean ──────────────────────────────────────────────────────────────

.PHONY: clean
clean:
	rm -rf $(BUILD_DIR) $(DESKTOP_DIR)/.build-bin
	rm -rf $(DESKTOP_DIR)/.build
	rm -rf Plot.xcodeproj
	rm -rf ~/Library/Developer/Xcode/DerivedData/Plot-*
