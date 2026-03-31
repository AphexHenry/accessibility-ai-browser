'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./ModelStore');
const { LlamaCppRuntime, DEFAULT_RUNTIME_CTX_SIZE } = require('./LlamaCppRuntime');
const { ModelDownloader } = require('./ModelDownloader');
const { MODELS } = require('./ModelCatalog');

class AIBridgeService {
  constructor() {
    this._runtime = null;
    this._tryAutoStart();
  }

  async _tryAutoStart() {
    if (!store.get('runtimeAutoStart')) return;
    const binaryPath = store.get('llamaServerBinaryPath');
    const modelPath = store.get('modelPath');
    if (!binaryPath || !modelPath) return;
    this._runtime = new LlamaCppRuntime({
      host: store.get('runtimeHost'),
      port: store.get('runtimePort'),
      binaryPath,
      modelPath,
      ctxSize: store.get('runtimeCtxSize') || DEFAULT_RUNTIME_CTX_SIZE,
    });
    try {
      this._runtime.start();
    } catch (err) {
      console.warn('[AIBridgeService] auto-start failed:', err.message);
      this._runtime = null;
    }
  }

  async getState() {
    return {
      setupCompleted: store.get('setupCompleted'),
      modelId: store.get('modelId'),
      modelPath: store.get('modelPath'),
      llamaServerBinaryPath: store.get('llamaServerBinaryPath'),
      runtimeCtxSize: store.get('runtimeCtxSize') || DEFAULT_RUNTIME_CTX_SIZE,
      aiOrchestrationV1: store.get('aiOrchestrationV1'),
      runtimeHealthy: this._runtime ? await this._runtime.isHealthy() : false,
      catalog: MODELS,
    };
  }

  async chat(messages) {
    if (!this._runtime) {
      throw new Error('Runtime is not running. Complete setup first.');
    }
    const healthy = await this._runtime.isHealthy();
    if (!healthy) {
      throw new Error('Runtime is not responding. Check that llama-server is running.');
    }
    return this._runtime.chat(messages);
  }

  _validateBinaryPath(binaryPath) {
    if (!binaryPath) {
      throw new Error('Set a llama-server binary path first.');
    }
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`llama-server path does not exist: ${binaryPath}`);
    }
    const stat = fs.statSync(binaryPath);
    if (!stat.isFile()) {
      throw new Error('llama-server path must point to an executable file, not a folder.');
    }
    fs.accessSync(binaryPath, fs.constants.X_OK);
    if (!path.basename(binaryPath).includes('llama-server')) {
      throw new Error('Binary path should point to the llama-server executable.');
    }
  }

  _validateModelPath(modelPath) {
    if (!modelPath) {
      throw new Error('Set a model path first.');
    }
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model path does not exist: ${modelPath}`);
    }
    const stat = fs.statSync(modelPath);
    if (!stat.isFile()) {
      throw new Error('Model path must point to a .gguf file, not a folder.');
    }
    if (!modelPath.toLowerCase().endsWith('.gguf')) {
      throw new Error('Model file must be a .gguf file.');
    }
  }

  async setupModel({ modelId, downloadDir }) {
    const model = MODELS[modelId];
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    const downloader = new ModelDownloader();
    const dest = await downloader.download(model.url, downloadDir, model.filename, null);
    store.set('modelId', modelId);
    store.set('modelPath', dest);
    store.set('setupCompleted', true);
    return { modelPath: dest };
  }

  async useExistingModel(modelPath) {
    this._validateModelPath(modelPath);
    const binaryPath = store.get('llamaServerBinaryPath');
    this._validateBinaryPath(binaryPath);

    store.set('modelPath', modelPath);
    store.set('setupCompleted', true);
    if (this._runtime) {
      this._runtime.stop();
    }
    this._runtime = new LlamaCppRuntime({
      host: store.get('runtimeHost'),
      port: store.get('runtimePort'),
      binaryPath,
      modelPath,
      ctxSize: store.get('runtimeCtxSize') || DEFAULT_RUNTIME_CTX_SIZE,
    });
    this._runtime.start();
    return { ok: true };
  }

  async setRuntimeBinaryPath(binaryPath) {
    this._validateBinaryPath(binaryPath);
    store.set('llamaServerBinaryPath', binaryPath);
    return { ok: true };
  }

  async setOrchestrationEnabled(enabled) {
    store.set('aiOrchestrationV1', Boolean(enabled));
    return { ok: true, aiOrchestrationV1: Boolean(enabled) };
  }
}

module.exports = AIBridgeService;
