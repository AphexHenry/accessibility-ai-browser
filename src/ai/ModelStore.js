'use strict';

const Store = require('electron-store');

const store = new Store({
  name: 'ai-state',
  defaults: {
    setupCompleted: false,
    modelId: '',
    modelPath: '',
    runtimeHost: '127.0.0.1',
    runtimePort: 8012,
    runtimeAutoStart: true,
    llamaServerBinaryPath: '',
    aiOrchestrationV1: true,
  },
});

module.exports = store;
