'use strict';

const MODELS = {
  'phi-4-mini-3.8b-q4': {
    id: 'phi-4-mini-3.8b-q4',
    name: 'Phi-4 Mini (3.8B Q4)',
    filename: 'phi-4-mini-instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/microsoft/Phi-4-mini-instruct-GGUF/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf',
    sizeBytes: 2_500_000_000,
    contextLength: 16384,
    description: 'Compact, fast model. Good for general Q&A and accessibility tasks.',
  },
};

module.exports = { MODELS };
