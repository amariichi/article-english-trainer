from __future__ import annotations

import base64
import io
import os
import threading
from dataclasses import dataclass
from typing import Any, Literal

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .kokoro_engine import KokoroEngine, ModelPaths, resolve_model_paths

Language = Literal["ja", "en"]


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    language: Language = Field(default="en")
    voice: str | None = Field(default=None, min_length=1, max_length=64)


class TtsResponse(BaseModel):
    audioBase64: str
    mimeType: str = "audio/wav"
    voice: str
    language: Language


@dataclass
class WorkerSettings:
    default_voice: str = os.getenv("TTS_DEFAULT_VOICE", "af_heart").strip() or "af_heart"
    max_chars: int = int(os.getenv("TTS_MAX_CHARS", "8000"))


def create_app() -> FastAPI:
    settings = WorkerSettings()
    model_paths = resolve_model_paths()
    engine = KokoroEngine(model_paths=model_paths, default_voice=settings.default_voice)
    lock = threading.Lock()

    app = FastAPI(title="english-trainer-tts-worker", version="0.1.0")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "voice": settings.default_voice,
            "modelPath": str(model_paths.model_path),
            "voicesPath": str(model_paths.voices_path),
            "maxChars": settings.max_chars,
        }

    @app.post("/v1/tts", response_model=TtsResponse)
    def synthesize(request: TtsRequest) -> TtsResponse:
        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="text must be non-empty")
        if len(text) > settings.max_chars:
            raise HTTPException(
                status_code=400, detail=f"text too long: {len(text)} chars (max {settings.max_chars})"
            )

        voice = (request.voice or settings.default_voice).strip() or settings.default_voice
        audio_bytes = synthesize_wav(engine, lock, text=text, voice=voice)
        return TtsResponse(
            audioBase64=base64.b64encode(audio_bytes).decode("ascii"),
            mimeType="audio/wav",
            voice=voice,
            language=detect_primary_language(text, request.language),
        )

    @app.post("/v1/tts/stream")
    def synthesize_stream(request: TtsRequest) -> Response:
        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="text must be non-empty")
        if len(text) > settings.max_chars:
            raise HTTPException(
                status_code=400, detail=f"text too long: {len(text)} chars (max {settings.max_chars})"
            )

        voice = (request.voice or settings.default_voice).strip() or settings.default_voice
        audio_bytes = synthesize_wav(engine, lock, text=text, voice=voice)
        return Response(content=audio_bytes, media_type="audio/wav")

    return app


def synthesize_wav(engine: KokoroEngine, lock: threading.Lock, *, text: str, voice: str) -> bytes:
    with lock:
        try:
            audio, sample_rate = engine.synthesize_text(text, voice=voice)
        except Exception as error:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {error}") from error

    try:
        with io.BytesIO() as buffer:
            sf.write(buffer, audio, sample_rate, format="WAV", subtype="PCM_16")
            return buffer.getvalue()
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"WAV encode failed: {error}") from error


def detect_primary_language(text: str, fallback: Language) -> Language:
    ascii_chars = sum(1 for char in text if 0x20 <= ord(char) <= 0x7E)
    non_ascii_chars = max(0, len(text) - ascii_chars)
    if ascii_chars == non_ascii_chars:
        return fallback
    return "en" if ascii_chars > non_ascii_chars else "ja"

