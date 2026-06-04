# easy-openclaw

OpenClaw の初期設定を簡単にする Tauri + Rust 製のブートストラップアプリです。

## 配布（MVP）
- `npm install -g easy-openclaw` 後に `easyclaw` で起動します。
- 配布パッケージには事前ビルド済みの macOS `.app` バンドルと Windows 実行ファイルを同梱します。
- 現在の同梱ターゲットは `darwin-x64` / `win32-x64` です。

## 開発者向け
- 開発実行: `npm run tauri dev`
- ネイティブ同梱用ビルド: `npm run build:native:darwin-x64`
