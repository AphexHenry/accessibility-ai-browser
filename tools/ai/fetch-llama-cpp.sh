#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/runtime"
LLAMA_DIR="${RUNTIME_DIR}/llama.cpp"

mkdir -p "${RUNTIME_DIR}"

if [[ ! -d "${LLAMA_DIR}" ]]; then
  git clone --depth 1 https://github.com/ggerganov/llama.cpp.git "${LLAMA_DIR}"
fi

cmake -S "${LLAMA_DIR}" -B "${LLAMA_DIR}/build" -DLLAMA_BUILD_SERVER=ON
cmake --build "${LLAMA_DIR}/build" -j

echo "llama-server built at ${LLAMA_DIR}/build/bin/llama-server"
