# Accessibility AI Browser

A local-AI-powered browser built on **Electron**. The AI chat runs fully on-device via `llama.cpp` — no data leaves your machine.

## Architecture

```
src/
├── main.js              # Main process: window management, IPC, app lifecycle
├── preload.js           # contextBridge: exposes safe API to renderer
├── ai/
│   ├── AIBridgeService.js   # Orchestrates model + runtime
│   ├── LlamaCppRuntime.js   # Spawns & queries llama-server
│   ├── ModelCatalog.js      # Available model definitions
│   ├── ModelStore.js        # Persistent settings (electron-store)
│   └── ModelDownloader.js   # Downloads .gguf files over HTTPS
└── renderer/
    ├── browser.html/css/js  # Browser chrome: toolbar, sidebar
    └── setup/               # First-run model setup window
tools/
└── ai/download-model.py     # Optional CLI model downloader
```

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Run the browser
npm start
# or
./scripts/dev.sh
```

The setup window opens automatically on first launch.

## Setting up a local model

1. **Build llama-server** from [llama.cpp](https://github.com/ggerganov/llama.cpp)
2. Open the setup window (click **Setup** in the AI chat sidebar)
3. Enter the path to your `llama-server` binary
4. Either download **Phi-4 Mini** from the catalog or point to an existing `.gguf` file
5. Click **Done** — the AI chat button in the toolbar is ready

The runtime is expected at `http://127.0.0.1:8012` (configurable in `src/ai/ModelStore.js`).

## Model extensibility

Add entries to `src/ai/ModelCatalog.js` to expose more models in the setup UI.

## Known limitations (Milestone 1)

- Streaming token rendering is not yet implemented (full response returned at once)
- No tab management (single web view)
- Packaging/installer out of scope for this milestone
