# Local AI Runtime (Milestone 1)

This document explains the current base implementation for a Firefox-derived browser with local AI chat.

## Scope

- Primary target: macOS developer build.
- Runtime: local `llama.cpp` server (`llama-server`).
- Model catalog: currently one model (`phi-4-mini-3.8b-q4`), designed for future additions.

## Repository layout

- `scripts/`:
  - `bootstrap-firefox-macos.sh`: clones Gecko and installs `.mozconfig`.
  - `configure-dev-build.sh`: runs initial Firefox bootstrap.
  - `build-dev-browser.sh`: build and run cycle for local development.
- `browser/components/ai/`:
  - `AIBridgeService.sys.mjs`: browser-facing orchestration service.
  - `LlamaCppRuntime.sys.mjs`: starts and queries local `llama.cpp` server.
  - `ModelCatalog.sys.mjs`: model definitions and future extension point.
  - `ModelStore.sys.mjs`: profile-local model state persistence.
  - `ModelDownloader.sys.mjs`: model artifact download from catalog.
  - `content/`: side chat and first-run setup UI.
- `tools/ai/download-model.py`: command-line model downloader with manifest output.

## Build prerequisites (macOS)

- Xcode command line tools.
- `python3` and `git`.
- Enough disk for Firefox build + model files.

## Developer flow

1. `./scripts/bootstrap-firefox-macos.sh`
2. `./scripts/configure-dev-build.sh`
3. `./scripts/build-dev-browser.sh`
4. Download model:
   - `python3 tools/ai/download-model.py --model phi-4-mini-3.8b-q4 --output-dir models`
5. Configure runtime binary path to local `llama-server` build.

## Runtime notes

- Current runtime API expects OpenAI-compatible endpoint at:
  - `http://127.0.0.1:8012/v1/chat/completions`
- Health check endpoint:
  - `http://127.0.0.1:8012/health`
- Model state is persisted in profile under `ai-models/state.json`.

## Model extensibility

To add another local model:
1. Add an entry in `ModelCatalog.sys.mjs`.
2. Add download metadata and checksum.
3. Ensure runtime launch flags match model requirements.
4. Expose it in setup/settings UI.

## Known gaps in this base

- Browser chrome wiring is scaffolded and requires integration into Firefox window startup path in the fork.
- Installer packaging is out of scope for this milestone.
- Streaming token rendering is currently represented as request/response chat in the base UI.
