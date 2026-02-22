# Changelog

このファイルでは、主要な変更点をバージョンごとに記録します。

## v1.0.2 - 2026-02-22

### Added

- iOS Safari の自動再生制限対策として、`HTMLAudioElement` のグローバル再生要素を使った audio unlock フローを追加。
- `Fetch & Summarize` / 手動要約送信時に、`getUserMedia` を使ったマイク許可の先取り（prefetch）を追加。

### Changed

- 録音の自動送信上限 `MIC_MAX_RECORDING_MS` の既定値を `20000ms` から `35000ms` に引き上げ（`src/config/env.ts` / `public/app.js` / `.env.example`）。
- README の ASR ルーティング説明に、現行UIでは `languageHint` 優先で未指定自動判定が通常経路ではない点、および未指定時判定の精度注記を追記。

### Fixed

- iOS で `Fetch & Summarize` 押下時に、audio unlock の待機が原因で送信処理が止まることがある問題を修正（unlock を非ブロッキング化し、内部 timeout を追加）。

### Notes

- このリリースのタグ: `v1.0.2`

## v1.0.1 - 2026-02-20

### Added

- `HOST` 環境変数を追加（既定 `127.0.0.1`）。
- 音声自動再生がブロックされた場合に、直前音声を再生できる手動リトライボタンを追加。

### Changed

- サーバー起動時の bind 先を `localhost` 固定から `HOST` 指定へ変更。
- モバイル音声UXを改善（録音終了後にマイクキャプチャを解放し、再生経路/音量挙動の安定化を図る）。
- iOS 向けに `touch-action` / `user-select` まわりを調整し、PTT ボタン操作の安定性を改善。
- README のアクセス先と LAN 公開手順を `HOST` ベースに更新。

### Chore

- ローカルの公開用クローンを誤って追跡しないよう `.gitignore` を更新。

### Notes

- このリリースのタグ: `v1.0.1`

## v1.0.0 - 2026-02-19

### Changed

- README の要件・セットアップ手順・運用説明を大幅に更新（前提条件、起動手順、補足情報を整理）。

### Notes

- このリリースのタグ: `v1.0.0`

## v0.3.2 - 2026-02-18

### Changed

- `http_audio` / `minimum_headroom_face_say` 両経路で、TTS テキスト正規化後に空文字となる場合は送信をスキップするように変更。
- 日本語句読点のみの入力をスペース正規化対象に含め、不要な無音発話リクエストを抑制。

### Added

- `HttpTtsClient` と `MinimumHeadroomFaceSayClient` の正規化・送信スキップ挙動を検証するテストを追加。

### Notes

- このリリースのタグ: `v0.3.2`

## v0.3.1 - 2026-02-18

### Added

- Shadowing 生成結果に日本語が混入した場合、英語化リトライを行うガードを追加。
- リトライ後も日本語が残る場合に `ShadowingGenerationError` を返し、API で `422` と再試行メッセージを返すように変更。
- Discussion/Shadowing の回帰テストを拡充。

### Changed

- Discussion プロンプトを改善し、初回ターンは記事文脈重視、2ターン目以降は学習者の最新話題を優先する方針へ変更。

### Notes

- このリリースのタグ: `v0.3.1`

## v0.3.0 - 2026-02-17

### Added

- ローカル HTTP TTS サービス `tts-worker`（Kokoro ONNX + Misaki）を追加。
- `npm run tts-worker:start` を追加し、`dev:all` で条件付き自動起動できるようにした。
- `agent-browser` 連携のコマンドタイムアウト／`networkidle` 待機タイムアウト設定を追加。
- Kokoro モデル配置ガイド（`assets/kokoro/README.md`）と `tts-worker` ドキュメントを追加。

### Changed

- TTS 既定バックエンドを `minimum_headroom_face_say` から `http_audio` に変更。
- `agent-browser wait --load networkidle` 失敗時の扱いを改善し、抽出処理を継続できるようにした。
- README とセットアップ説明を、`tts-worker` を含む運用前提に合わせて更新。

### Notes

- このリリースのタグ: `v0.3.0`

## v0.2.0 - 2026-02-17

### Added

- `MIC_MAX_RECORDING_MS` を追加し、録音の自動送信上限を `.env` で設定可能にした（既定 20000ms）。
- URL preflight の回帰テストを追加（`tests/articleExtractor.test.ts`）。
- README に Gemini CLI の前提条件（`/settings` の `Preview Features=true`）と MinimumHeadroom の起動手順を追記。

### Changed

- 音声UIを整理し、`Hold to Talk (EN/JA)` の2ボタン方式へ統一。
- `Start Mic`、Voice入力欄、`日本語で教えて` チェック、再生バーを撤去。
- `help_ja` のTTS本文を改善し、日本語説明部分を含めて発話するように修正。
- URL到達性チェックを強化し、`HTTP 4xx/5xx` を即失敗扱いに変更（長い待ち時間を短縮）。
- `LLM Provider` 行のレイアウトを調整し、ラベル折り返しを防止。
- README を日本語中心に整理し、ASRルーティングの説明を実装仕様（`languageHint` 優先）に合わせた。

### Notes

- このリリースのタグ: `v0.2.0`
- GitHub Release: `https://github.com/amariichi/article-english-trainer/releases/tag/v0.2.0`
