'use strict';

const { spawn } = require('child_process');
const http = require('http');

const DEFAULT_RUNTIME_CTX_SIZE = 4096;

class LlamaCppRuntime {
  constructor({ host, port, binaryPath, modelPath, ctxSize = DEFAULT_RUNTIME_CTX_SIZE }) {
    this.host = host;
    this.port = port;
    this.binaryPath = binaryPath;
    this.modelPath = modelPath;
    this.ctxSize = Number(ctxSize) > 0 ? Number(ctxSize) : DEFAULT_RUNTIME_CTX_SIZE;
    this._process = null;
  }

  start() {
    if (this._process) return;
    if (!this.binaryPath || !this.modelPath) {
      throw new Error('Runtime binary path and model path must be set before starting.');
    }
    this._process = spawn(this.binaryPath, [
      '--model', this.modelPath,
      '--host', this.host,
      '--port', String(this.port),
      '--ctx-size', String(this.ctxSize),
    ]);
    this._process.on('error', (err) => {
      console.error('[LlamaCppRuntime] process error:', err.message);
    });
    this._process.on('exit', (code) => {
      console.log('[LlamaCppRuntime] process exited with code', code);
      this._process = null;
    });
  }

  stop() {
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
  }

  isHealthy() {
    return new Promise((resolve) => {
      const req = http.get(
        { host: this.host, port: this.port, path: '/health', timeout: 2000 },
        (res) => resolve(res.statusCode === 200)
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  async chat(messages) {
    const body = JSON.stringify({ model: 'local', messages, stream: false });
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.message?.content ?? '';
              resolve({ content });
            } catch (err) {
              reject(new Error('Failed to parse runtime response: ' + err.message));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = {
  LlamaCppRuntime,
  DEFAULT_RUNTIME_CTX_SIZE,
};
