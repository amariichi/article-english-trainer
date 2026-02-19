# tts-worker

`english-trainer` から HTTP で呼び出すローカル TTS ワーカーです。  
Kokoro ONNX + Misaki (`af_heart`) で音声を生成します。

要件:

- Python 3.11+

## Endpoints

- `GET /health`
- `POST /v1/tts`（JSON + base64）
- `POST /v1/tts/stream`（`audio/wav` バイナリ）

## Model files

以下のどちらかでモデルパスを解決します。

1. 環境変数:
   - `TTS_KOKORO_MODEL_PATH`
   - `TTS_KOKORO_VOICES_PATH`
2. 既定候補:
   - `<repo>/assets/kokoro/kokoro-v1.0.onnx`
   - `<repo>/assets/kokoro/voices-v1.0.bin`
   - `<repo>/../minimum-headroom/assets/kokoro/kokoro-v1.0.onnx`
   - `<repo>/../minimum-headroom/assets/kokoro/voices-v1.0.bin`

## Run

初回セットアップ（repo root から）:

```bash
uv sync --project tts-worker
```

起動:

```bash
uv run --project tts-worker tts-worker
```

既定: `http://127.0.0.1:8092`

## Smoke

```bash
uv run --project tts-worker tts-worker --smoke
```
