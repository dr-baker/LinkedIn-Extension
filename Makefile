SHELL := /bin/bash

VERSION := $(shell node -p "require('./manifest.json').version")
BUILD_DIR := build
UNPACKED_DIR := $(BUILD_DIR)/unpacked
ZIP_FILE := $(BUILD_DIR)/LinkedIn-JD-Extractor-$(VERSION).zip
TRACKER_FILE := $(BUILD_DIR)/version.json

EXTENSION_FILES := \
	manifest.json \
	popup.html popup.css popup.js \
	content.js content-styles.css \
	settings.html settings.css settings.js \
	icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png

.PHONY: build clean build-unpacked build-zip sync-version write-version-track

build: sync-version build-unpacked build-zip write-version-track
	@echo "Build complete: $(ZIP_FILE)"
	@echo "Version tracker: $(TRACKER_FILE)"

clean:
	rm -rf "$(UNPACKED_DIR)"
	rm -f "$(BUILD_DIR)"/LinkedIn-JD-Extractor-*.zip

sync-version:
	@node -e ' \
		const fs = require("fs"); \
		const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8")); \
		const versionText = "v" + manifest.version; \
		const popupPath = "popup.html"; \
		const popup = fs.readFileSync(popupPath, "utf8"); \
		const updated = popup.replace(/(<span class="badge">)v[^<]+(<\/span>)/, "$$1" + versionText + "$$2"); \
		if (popup !== updated) fs.writeFileSync(popupPath, updated); \
		console.log("Synced popup badge to", versionText); \
	'

build-unpacked:
	mkdir -p "$(UNPACKED_DIR)"
	cp -R $(EXTENSION_FILES) "$(UNPACKED_DIR)"

build-zip:
	mkdir -p "$(BUILD_DIR)"
	rm -f "$(ZIP_FILE)"
	zip -r "$(ZIP_FILE)" $(EXTENSION_FILES) -x "*.DS_Store" -x "*node_modules*"

write-version-track:
	mkdir -p "$(BUILD_DIR)"
	@node -e ' \
		const fs = require("fs"); \
		const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8")); \
		const data = { \
			name: manifest.name, \
			version: manifest.version, \
			artifact: "build/LinkedIn-JD-Extractor-" + manifest.version + ".zip", \
			builtAt: new Date().toISOString() \
		}; \
		fs.writeFileSync("$(TRACKER_FILE)", JSON.stringify(data, null, 2) + "\n"); \
		console.log("Wrote", "$(TRACKER_FILE)"); \
	'
