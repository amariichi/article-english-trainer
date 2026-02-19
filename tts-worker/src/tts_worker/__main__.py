from __future__ import annotations

import argparse


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="english-trainer tts-worker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8092)
    parser.add_argument("--smoke", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.smoke:
        from .chunking import split_text_chunks
        from .kokoro_engine import resolve_model_paths

        chunks = split_text_chunks("Smoke test 日本語.")
        paths = resolve_model_paths()
        print(
            "TTS worker smoke: imports OK, "
            f"chunks={len(chunks)}, model={paths.model_path}, voices={paths.voices_path}"
        )
        return

    import uvicorn

    uvicorn.run("tts_worker.app:create_app", factory=True, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
