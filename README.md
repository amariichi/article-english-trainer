# English Trainer (Article Mode)

<img width="640" height="502" alt="Image" src="https://github.com/user-attachments/assets/47f7f62a-3823-4054-a76f-1bbf266d30e2" />

任意の記事を `agent-browser` で取り込み、要約から英会話・日本語ヘルプ・シャドーイングを行う学習アプリです。

## 機能

- 任意URLの記事自動取得 (`agent-browser`)
- LLMプロバイダー切替 (`nemotron`, `gemini`)
- 英語ディスカッション (`discussion`)
- 英語ディスカッション時の先頭リフレーズ（英語入力は補正、 日本語入力は英訳）
- 日本語ヘルプ (`help_ja`)
- シャドーイングスクリプト生成 (`shadowing`)
- 音声ターン (`/api/session/audio-turn`): ASR言語判定 + 返信TTS
- PTT マイク入力（`Hold to Talk (EN/JA)` を押している間のみ録音）
- キーボード録音: `Ctrl` 長押し=英語ASR, `Alt` 長押し=日本語ASR
- テキスト会話返信・シャドーイング生成時の自動TTS
- 抽出失敗時の手動貼り付けフォールバック

### agent-browser とは

`agent-browser` は、CLI からブラウザを操作してページを開き、DOM からタイトルや本文を取得するためのツールです。  
このリポジトリでは記事URL入力時の自動抽出に使います（`/api/article/fetch`）。  
自動抽出に失敗した場合は、`Use Manual Text` で本文を手動貼り付けして続行できます。
公式リポジトリ: <https://github.com/vercel-labs/agent-browser>

## 動作要件

- `bash`（`scripts/setup.sh` / `scripts/doctor.sh` 実行用）
- Node.js 20+
- `npm`
- `uv`（`asr-worker` / `tts-worker` 用）
- Python 3.10+（`asr-worker` 用）
- （`tts-worker` を使う場合）Python 3.11+
- （ローカル Nemotron / llama.cpp を使う場合）
  - NVIDIA GPU + driver（`nvidia-smi` が実行可能）
  - `llama.cpp` の `llama-server` バイナリ
  - （ソースからビルドする場合）`cmake` + C/C++ ビルドツールチェーン
- （自動記事抽出を使う場合）`agent-browser` CLI
- （`npm run article:auth` を使う場合）headedブラウザを開ける GUI 環境
- （`gemini` プロバイダーを使う場合）`gemini` CLI（インストール済みかつ Google アカウントでログイン済み）
  - `gemini /settings` で `Preview Features` を `true` に設定済みであること
- （音声機能を使う場合）Parakeet ASR エンドポイント
- TTS は以下のどちらか
  - MinimumHeadroom (`face_say`)
  - 内蔵 `tts-worker`（Kokoro ONNX + Misaki）
- `ffmpeg`（webm/ogg/mp4 音声のASRフォールバックデコード用）

補足:

- MinimumHeadroom は TTS/発話通知 (`face_say`) のみを担当し、ASR は別サービスです。
- `tts-worker` はこのリポジトリ内で起動できる HTTP TTS サービスです（`TTS_BACKEND=http_audio` 時に利用）。
- Kokoroモデルファイルの配置方法は `assets/kokoro/README.md` を参照してください。

## セットアップ

1. 初期セットアップスクリプトを実行します。

   npm run setup
   - `npm install` を実行
   - `uv sync --project asr-worker --locked` を実行
   - （任意）`--with-tts` 指定時は `uv sync --project tts-worker` も実行
   - 必要に応じて `.env.example` から `.env` を生成
   - 前提チェック（`npm run setup:doctor`）を実行
   - 注: `llama.cpp`（`llama-server`）は自動インストールされません

2. （`NEMOTRON_RUNTIME=local_llama_cpp` を使う場合）`llama.cpp` / `llama-server` を準備します。
   - 例（repo root で実行）:

   ```bash
   mkdir -p .local
   git clone https://github.com/ggerganov/llama.cpp.git .local/llama.cpp
   cmake -S .local/llama.cpp -B .local/llama.cpp/build -DGGML_CUDA=ON
   cmake --build .local/llama.cpp/build --config Release -j
   ```

   - `.env` には次を設定します:

   ```dotenv
   NEMOTRON_RUNTIME=local_llama_cpp
   NEMOTRON_LLAMA_SERVER_BIN=/absolute/path/to/english-trainer/.local/llama.cpp/build/bin/llama-server
   NEMOTRON_GGUF_PATH=/absolute/path/to/model.gguf
   ```

3. `.env` を設定します。
   - 既定は llama.cpp 経由のローカル Nemotron（`NEMOTRON_RUNTIME=local_llama_cpp`）
   - `NEMOTRON_RUNTIME=remote_api` の場合のみ `NEMOTRON_API_KEY` が必要
   - `NEMOTRON_GGUF_PATH` はローカルGGUFモデルを指定
   - `gemini` プロバイダーを使う場合は `gemini -p` のアカウント認証を利用（APIキー不要）
   - `GEMINI_MODEL_ID` 既定は `gemini-3-flash-preview`。
   - 読み込み不可URLの早期判定は `ARTICLE_REACHABILITY_TIMEOUT_MS`（既定 3000ms）で調整できます。
   - `agent-browser` コマンド全体のタイムアウトは `AGENT_BROWSER_COMMAND_TIMEOUT_MS`（既定 10000ms）です。
   - `agent-browser wait --load networkidle` 専用タイムアウトは `AGENT_BROWSER_WAIT_NETWORKIDLE_TIMEOUT_MS`（既定 3000ms）です。
   - 音声機能を使う場合は `ASR_*_URL` を設定。
   - 録音の自動送信上限は `MIC_MAX_RECORDING_MS`（既定 35000ms）です。
   - TTS は切替可能です（既定: `TTS_BACKEND=http_audio`）。
     - `TTS_BACKEND=http_audio`（`TTS_ENDPOINT_URL` 経由で音声を返す）
     - `TTS_BACKEND=minimum_headroom_face_say`（MinimumHeadroom に発話テキストを送る）
   - `.env.example` では `http_audio` 用の推奨値として `TTS_ENDPOINT_URL=http://127.0.0.1:8092/v1/tts` を設定しています。
   - `tts-worker` のモデルは `TTS_KOKORO_MODEL_PATH` / `TTS_KOKORO_VOICES_PATH` で明示指定できます。
     未指定時は `./assets/kokoro/*` と `../minimum-headroom/assets/kokoro/*` を自動探索します。

4. （`gemini` プロバイダーを使う場合）Gemini CLI の前提状態を確認します（初回のみ）。
   - `gemini` コマンドが無い場合は、Gemini CLI を先にインストール
   - `gemini /settings` を開き、`Preview Features` を `true` に設定
   - `gemini --version` で CLI がインストール済みであることを確認
   - `gemini -p "Reply with exactly: OK" --output-format text` が成功することを確認（ログイン済み確認）

5. （任意）認証が必要なサイト向けに auth state を作成します（headed mode）。
   - `agent-browser --headed` でブラウザを開くため、GUI が使える環境で実行してください。

   npm run article:auth

6. （任意）必要に応じて診断コマンドを実行します。

   npm run setup:doctor
   npm run nemotron:preflight

7. MinimumHeadroom の face-app を起動します（別リポジトリ、`face_say` 用）。
   - リポジトリ: `https://github.com/amariichi/MinimumHeadroom`
   - クローンしたディレクトリで `./scripts/setup.sh` を実行
   - `assets/kokoro/` に `kokoro-v1.0.onnx` と `voices-v1.0.bin` を配置
   - 準備完了後に `npm run face-app:start` を実行
   - EnglishTrainer のTTS連携（`face_say` 直送）だけなら `npm run mcp-server:start` は不要

8. `TTS_BACKEND=http_audio` で内蔵 TTS を使う場合は `tts-worker` を起動します。
   - 依存導入: `npm run setup -- --with-tts`（または `uv sync --project tts-worker`）
   - Kokoroモデルの配置: `assets/kokoro/README.md` を参照
   - 起動: `npm run tts-worker:start`
   - ヘルス確認: `curl http://127.0.0.1:8092/health`

## ローカル Nemotron (llama.cpp) 例

既定値（`npm run nemotron:serve` と同じ）:

llama-server \\
  --model /absolute/path/to/model.gguf \\
  --alias nemotron-3-nano \\
  --host 127.0.0.1 \\
  --port 8000 \\
  --ctx-size 8192 \\
  --n-gpu-layers -1

補足:

- llama.cpp では GGUF 形式モデルが必要です（HF safetensors はそのままでは使えません）。
- 検証で使用したモデル例: `https://huggingface.co/unsloth/Nemotron-3-Nano-30B-A3B-GGUF` の `Nemotron-3-Nano-30B-A3B-UD-Q4_K_XL.gguf`
- VRAMが厳しい場合は `NEMOTRON_N_GPU_LAYERS` を減らして調整してください。
- 32GB VRAM では `--ctx-size 8192` 付近から開始し、安定する範囲で段階的に増やすのが実用的です。
- `--ctx-size 65536` は KV cache が大きくなり、32GB VRAM では OOM になりやすいです。

## 起動

推奨（アプリ + ローカル Nemotron + ASR worker を同時起動）:

npm run dev:all

`Ctrl+C` で app / nemotron / asr-worker の全プロセスを停止できます。
- `TTS_BACKEND=http_audio` かつ `TTS_ENDPOINT_URL` が `localhost/127.0.0.1` の場合は `tts-worker` も自動起動します。

- 初回 `npm run dev:all` は `asr-worker` 側で `torch` / `nemo-toolkit` の取得・初期化に時間がかかる場合があります。
- `asr-worker:start` は `.env` を読み込み、`ASR_ENABLE_CUDA_FALLBACK=true` 時に CUDA 不安定時の自動フォールバックを行います。

アクセス先（既定）: `http://127.0.0.1:3000`

- LAN 公開が必要な場合のみ `.env` で `HOST=0.0.0.0` を設定してください。

別ターミナルで分ける場合:

- ターミナル1: `npm run nemotron:serve`
- ターミナル2: `npm run asr-worker:start`
- ターミナル3: `npm run dev`

`Use Manual Text` で `Connection error.` が出る場合:

- `nemotron` プロバイダーではローカル endpoint（既定 `http://127.0.0.1:8000/v1`）が起動している必要があります。
- `npm run nemotron:serve` で起動するか、プロバイダーを `gemini` に切り替えてください。

## ASR ルーティング方針

`/api/session/audio-turn` の ASR 切替は、`languageHint` の有無で分岐します。

- `languageHint=ja|en|mixed` が指定されている場合
  - hint の route を優先
  - `languageHint=ja|en` かつ `ASR_SKIP_FAST_WHEN_HINTED=true`（既定）では fast ASR を省略
- hint が未指定の場合
  - fast ASR で言語信頼度（confidence）を取得
  - `ja > en` かつ `ja >= 0.75` なら `ASR_JA_URL`
  - `en > ja` かつ `en >= 0.75` なら `ASR_EN_URL`
  - それ以外は `ASR_MIXED_URL`
- `ASR_SKIP_REDUNDANT_DECODE=true` の場合
  - fast 結果が未クリップかつ route model と同一なら再デコードを省略

注記:

- 現行UIの PTT（`Hold to Talk (EN/JA)` と `Ctrl/Alt`）は `languageHint` を常時付与するため、通常運用で「hint 未指定の自動判定」分岐はほぼ使いません。
- hint 未指定時の判定は、fast 転写テキストの文字種比率ヒューリスティック（`asr-worker`）に依存します。運用条件によっては、特に日本語判定の精度が安定しない場合があります。

既定モデル:

- EN: `nvidia/parakeet-tdt-0.6b-v2`
- JA: `nvidia/parakeet-tdt_ctc-0.6b-ja`

既定デバイス:

- `ASR_DEVICE=cpu`（VRAMに余裕が無い場合は推奨）
- `ASR_DEVICE=cuda` はVRAMに余裕がある場合のみ
- EN/JA同時常駐: `ASR_SINGLE_MODEL_CACHE=false` + `ASR_PRELOAD_MODELS=true`
- 目安: Nemotron 同時運用で `ASR_DEVICE=cuda` + EN/JA同時常駐にすると、GPU使用量は合計で約27GB前後になる場合があります（モデル/ドライバ/設定により変動）
- CUDA不安定時の自動フェイルセーフ: `ASR_ENABLE_CUDA_FALLBACK=true`

TTS は既定で `TTS_BACKEND=http_audio` を使い、内蔵 `tts-worker`（または任意のHTTP TTS API）から
base64 音声を受け取りブラウザで再生します。`af_heart` が既定 voice です。  
`TTS_BACKEND=minimum_headroom_face_say` に切り替えると、MinimumHeadroom の `face_say` に発話テキストを送信します。

## 利用フロー

1. プロバイダーを選び記事 URL を入力
2. `Fetch & Summarize` を実行
3. 要約表示後、英語で意見を入力して会話（返信はテキスト+TTS）
4. 通常会話では、日本語入力でも英語に言い換えて会話を継続（`In English, you could say: "..."`）
5. 日本語で解説してほしいときは、メッセージ内で明示依頼（例: 「日本語で教えて」）すると `help_ja` モードに自動切替
6. `Generate Shadowing Script` で音読用テキスト生成（同時にTTS再生）
7. `Hold to Talk (EN)` / `Hold to Talk (JA)` またはキーボード録音で、ASR+TTS付き会話を実行
8. キーボード録音の言語ヒント: `Ctrl` 長押し=EN, `Alt` 長押し=JA

## API エンドポイント

- `GET /health`
- `GET /api/config`
- `POST /api/article/fetch`
- `POST /api/article/manual`
- `POST /api/session/message`
- `POST /api/session/audio-turn`
- `POST /api/session/audio-turn-upload`（バイナリ音声アップロード）
- `POST /api/session/shadowing`

## テスト

npm run lint
npm test

## CI（GitHub Actions）

- `.github/workflows/ci.yml` で CI を実行します。
- トリガー: `main` への push、`main` 向け PR、手動実行 (`workflow_dispatch`)
- 実行内容:
  - Nodeジョブ（Node 20 / 22）: `npm ci` -> `npm run lint` -> `npm test` -> `npm run build`
  - ASR workerジョブ: `uv sync --project asr-worker --locked` -> Python compile check

ローカルでの近似再現:

```bash
npm ci
npm run lint
npm test
npm run build
uv sync --project asr-worker --locked
uv run --project asr-worker python -m py_compile \
  asr-worker/src/asr_worker/__init__.py \
  asr-worker/src/asr_worker/__main__.py \
  asr-worker/src/asr_worker/app.py
```

## セキュリティ注意点

- `AGENT_BROWSER_STATE_PATH` は認証トークンを含むため共有しない
- `.local/` は `.gitignore` 済み
- 記事全文はセッション内利用のみを想定
