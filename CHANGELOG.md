# Changelog

このファイルでは、主要な変更点をバージョンごとに記録します。

## v0.2.0 - 2026-02-16

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
