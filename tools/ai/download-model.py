#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


MODELS = {
    "phi-4-mini-3.8b-q4": {
        "filename": "microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        "url": "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        "sha256": "",
    }
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download local AI model artifacts.")
    parser.add_argument("--model", required=True, choices=MODELS.keys())
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--hf-token",
        default=os.environ.get("HF_TOKEN", "").strip(),
        help="Hugging Face token (or set HF_TOKEN env var)",
    )
    parser.add_argument(
        "--url-override",
        default="",
        help="Optional alternate URL for model download",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path, hf_token: str = "") -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "accessibility-ai-browser-downloader/1.0"}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"

    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request) as response:
        total = int(response.headers.get("Content-Length", "0"))
        downloaded = 0
        with destination.open("wb") as output:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
                downloaded += len(block)
                if total > 0:
                    ratio = downloaded / total * 100
                    print(f"\rDownloading: {ratio:.1f}%", end="", flush=True)
    print()


def write_manifest(output_dir: Path, model_id: str, path: Path, checksum: str) -> None:
    manifest_path = output_dir / "models-manifest.json"
    data = {}
    if manifest_path.exists():
        data = json.loads(manifest_path.read_text())
    data[model_id] = {"path": str(path), "sha256": checksum}
    manifest_path.write_text(json.dumps(data, indent=2))


def main() -> int:
    args = parse_args()
    model = MODELS[args.model]
    output_dir = Path(args.output_dir).resolve()
    destination = output_dir / model["filename"]
    url = args.url_override.strip() or model["url"]

    print(f"Downloading {args.model} to {destination}")
    try:
        download(url, destination, args.hf_token)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            print(
                "Model download unauthorized. This file likely requires Hugging Face authentication.\n"
                "Set a token and retry:\n"
                "  export HF_TOKEN='your_token'\n"
                "  python3 tools/ai/download-model.py --model phi-4-mini-3.8b-q4 --output-dir models\n"
                "Or pass token directly:\n"
                "  python3 tools/ai/download-model.py --model phi-4-mini-3.8b-q4 --output-dir models --hf-token 'your_token'",
                file=sys.stderr,
            )
            return 3
        raise
    checksum = sha256_file(destination)

    expected = model["sha256"].strip().lower()
    if expected and checksum.lower() != expected:
        print("Checksum mismatch. Downloaded file may be invalid.", file=sys.stderr)
        return 2

    write_manifest(output_dir, args.model, destination, checksum)
    print(f"Completed. SHA256={checksum}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
