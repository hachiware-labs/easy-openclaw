# EasyClaw

OpenClaw の初期設定を簡単にする Tauri + Rust 製のブートストラップアプリです。

## 配布（MVP）
- npm グローバルインストール後に `easyclaw` で起動します。
- 配布パッケージには事前ビルド済みの macOS `.app` バンドルを同梱します。
- 現在の同梱ターゲットは `darwin-x64` です。

## 開発者向け
- 開発実行: `npm run tauri dev`
- ネイティブ同梱用ビルド: `npm run build:native:darwin-x64`
