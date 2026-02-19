from __future__ import annotations

import contextlib
import io
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional, Tuple

import numpy as np

from .chunking import TextChunk, split_text_chunks


@dataclass(frozen=True)
class ModelPaths:
    model_path: Path
    voices_path: Path


def resolve_model_paths() -> ModelPaths:
    cwd = Path.cwd()
    root_dir = cwd

    model_candidates = [
        _clean_env_path(os.getenv("TTS_KOKORO_MODEL_PATH")),
        root_dir / "assets" / "kokoro" / "kokoro-v1.0.onnx",
        root_dir.parent / "minimum-headroom" / "assets" / "kokoro" / "kokoro-v1.0.onnx",
    ]
    voices_candidates = [
        _clean_env_path(os.getenv("TTS_KOKORO_VOICES_PATH")),
        root_dir / "assets" / "kokoro" / "voices-v1.0.bin",
        root_dir.parent / "minimum-headroom" / "assets" / "kokoro" / "voices-v1.0.bin",
    ]

    model_path = _first_existing_path(model_candidates)
    voices_path = _first_existing_path(voices_candidates)

    return ModelPaths(model_path=model_path, voices_path=voices_path)


def _clean_env_path(value: str | None) -> Optional[Path]:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    return Path(stripped)


def _first_existing_path(candidates: list[Optional[Path]]) -> Path:
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate

    for candidate in candidates:
        if candidate is not None:
            return candidate

    raise RuntimeError("no model path candidates were provided")


def verify_model_files(paths: ModelPaths) -> None:
    if not paths.model_path.is_file():
        raise FileNotFoundError(f"missing model file: {paths.model_path}")
    if not paths.voices_path.is_file():
        raise FileNotFoundError(f"missing voices file: {paths.voices_path}")


class KokoroEngine:
    def __init__(self, *, model_paths: ModelPaths, default_voice: str = "af_heart") -> None:
        verify_model_files(model_paths)

        self.model_paths = model_paths
        self.default_voice = default_voice

        try:
            from kokoro_onnx import Kokoro  # type: ignore
        except Exception as error:  # noqa: BLE001
            raise RuntimeError(f"failed to import kokoro_onnx: {error}") from error

        try:
            from misaki import ja as misaki_ja  # type: ignore
        except Exception as error:  # noqa: BLE001
            raise RuntimeError(f"failed to import misaki.ja: {error}") from error

        self._kokoro = Kokoro(str(model_paths.model_path), str(model_paths.voices_path))
        self._ja_g2p = misaki_ja.JAG2P(version="pyopenjtalk")

    def chunk_text(self, text: str) -> list[TextChunk]:
        return split_text_chunks(text)

    def synthesize_text(self, text: str, *, voice: Optional[str] = None) -> Tuple[np.ndarray, int]:
        chunks = self.chunk_text(text)
        return self.synthesize_chunks(chunks, voice=voice)

    def synthesize_chunks(
        self, chunks: Iterable[TextChunk], *, voice: Optional[str] = None
    ) -> Tuple[np.ndarray, int]:
        combined: Optional[np.ndarray] = None
        sample_rate: Optional[int] = None
        selected_voice = voice or self.default_voice

        for chunk in chunks:
            if not chunk.text:
                continue

            source_text = chunk.text
            if chunk.is_phonemes:
                source_text = self._to_ja_phonemes(chunk.text)

            audio, chunk_rate = self._kokoro_create(
                source_text,
                voice=selected_voice,
                lang=chunk.lang,
                speed=chunk.speed,
                is_phonemes=chunk.is_phonemes,
            )

            if sample_rate is None:
                sample_rate = chunk_rate
            elif sample_rate != chunk_rate:
                raise RuntimeError(f"sample rate mismatch: {sample_rate} vs {chunk_rate}")

            if combined is None:
                combined = audio
            else:
                combined = np.concatenate([combined, audio])

        if combined is None or sample_rate is None:
            return np.zeros(1, dtype=np.float32), 24_000

        return combined.astype(np.float32, copy=False), sample_rate

    def _to_ja_phonemes(self, text: str) -> str:
        capture = io.StringIO()
        # Keep FastAPI stdout clean by redirecting pyopenjtalk progress lines.
        with contextlib.redirect_stdout(capture):
            raw = self._ja_g2p(text)

        echoed = capture.getvalue().strip()
        if echoed:
            print(echoed, file=sys.stderr)

        if isinstance(raw, str):
            return raw

        if isinstance(raw, (list, tuple)):
            for item in raw:
                if isinstance(item, str) and item.strip():
                    return item

        if hasattr(raw, "phonemes"):
            value = getattr(raw, "phonemes")
            if isinstance(value, str) and value.strip():
                return value

        rendered = str(raw)
        if rendered.strip():
            return rendered

        raise RuntimeError("misaki ja g2p returned empty phoneme output")

    def _kokoro_create(
        self, text: str, *, voice: str, lang: str, speed: float, is_phonemes: bool
    ) -> Tuple[np.ndarray, int]:
        if hasattr(self._kokoro, "create"):
            result = self._kokoro.create(
                text,
                voice=voice,
                lang=lang,
                speed=speed,
                is_phonemes=is_phonemes,
            )
            return _normalize_kokoro_result(result)

        if hasattr(self._kokoro, "generate"):
            result = self._kokoro.generate(
                text,
                voice=voice,
                lang=lang,
                speed=speed,
                is_phonemes=is_phonemes,
            )
            return _normalize_kokoro_result(result)

        raise RuntimeError("kokoro instance does not expose create/generate methods")


def _normalize_kokoro_result(result: Any) -> Tuple[np.ndarray, int]:
    if isinstance(result, tuple) and len(result) >= 2:
        audio = result[0]
        sample_rate = result[1]
        return _normalize_audio(audio), int(sample_rate)

    if isinstance(result, dict):
        audio = result.get("audio")
        sample_rate = result.get("sample_rate")
        if audio is not None and sample_rate is not None:
            return _normalize_audio(audio), int(sample_rate)

    if hasattr(result, "audio") and hasattr(result, "sample_rate"):
        audio = getattr(result, "audio")
        sample_rate = getattr(result, "sample_rate")
        return _normalize_audio(audio), int(sample_rate)

    raise RuntimeError("unsupported kokoro return format")


def _normalize_audio(audio: Any) -> np.ndarray:
    if isinstance(audio, np.ndarray):
        if audio.ndim == 1:
            return audio.astype(np.float32, copy=False)
        return np.mean(audio, axis=-1).astype(np.float32, copy=False)

    if isinstance(audio, (list, tuple)):
        return np.asarray(audio, dtype=np.float32)

    raise RuntimeError(f"unsupported audio type: {type(audio)!r}")
