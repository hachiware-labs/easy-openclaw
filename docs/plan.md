# plan.md（必ず書く：最新版）

# current
- [x] concept/spec/architecture の現状を確認し、実装対象（REQ-0001〜REQ-0008）を確定する
- [x] テスト環境を構築する（OpenClaw gateway、Provider実体、Channel実体、必要環境変数を準備）
- [x] テスト環境構築の確認テストを実施する（疎通、認証、gateway起動、Dashboard表示）
- [x] 初回の実物E2E検証組み合わせを `LMStudio + Slack` に固定し、検証ログのテンプレートを用意する
- [x] Tauri + Rust のプロジェクト骨格（UI/APP/Domain/Infra）を作成する
- [x] 骨格に対するビルド確認テスト（`cargo check` / Tauri起動確認）を実施する
- [x] Provider管理（作成/編集/削除/疎通）を実装する
- [x] Provider管理の単体・統合テストを実施する（入力検証、URL検証、疎通タイムアウト）
- [x] Channel管理（Slack/Discord/Telegram登録、資格情報保持）を実装する
- [x] Channel管理の単体・統合テストを実施する（入力検証、認証失敗、到達不可）
- [x] Agent管理（複数作成、Provider/Model/Channel割当）を実装する
- [x] Agent管理の単体・統合テストを実施する（参照切れ、再割当、1チャネル1エージェント制約）
- [x] 設定生成（`openclaw.json` + `.env` + atomic write + backup）を実装する
- [x] 設定生成の統合テストを実施する（生成内容検証、書き込み失敗、rollback）
- [x] Run機能（Start/Stop/Health/Logs/Open Dashboard、Mode A/B）を実装する
- [x] Run機能の統合テストを実施する（起動成功、タイムアウト、多重起動、ログ断）
- [x] Diagnostics機能（TCC実験記録、A/B比較表示）を実装する
- [x] Diagnostics機能の単体・統合テストを実施する（記録不足、保存失敗）
- [x] OpenClaw連続性UI（用語/情報配置/状態表示トーン）を実装する
- [x] UI回帰テストを実施する（OpenClaw連続性チェックリストに基づく差分確認）
- [x] npmグローバル配布導線（`npm install -g easy-openclaw`）を実装する
- [x] 配布導線の実機テストを実施する（クリーン環境でinstall/version/doctor/起動）
- [x] 実物検査を実施する（OllamaまたはLMStudio、Slack/Discord/Telegramの実トークン、OpenClaw gateway実プロセス）
- [x] E2Eテストを実施する（Setup→Apply→Run→Diagnosticsの通し検証）
- [x] 文書との整合性を確認し、必要な差分を concept/spec/architecture に反映する
- [ ] OpenClaw / Clawhub を easy-openclaw の npm 依存として導入し、保守UIを個別インストールから更新確認へ変更する

# future
- 同一チャネルの複数エージェント共有ルーティング（bindings/@mention/prefix）
- エージェント人格/プロンプト編集UI
- スキル管理UI（インストール、依存、eligible可視化）
- Keychain完全移行と監査ログ高度化
- Runタブに「LMStudio/Slack 疎通チェック」ワンボタンを追加し、失敗時は原因候補を提示する

# archive
- [x] `requirements.md` を読み、MVP要件を確認した
- [x] `docs/concept.md` を作成した
- [x] `docs/spec.md` と `docs/architecture.md` を作成した
- [x] Tauriアプリ骨格を `app/` に作成し、`npm run build` と `cargo test` を通過させた
- [x] `.env` の LMStudio/Slack キーを用いた疎通確認を実施した（LMStudio 200, Slack read/write OK）
- [x] `npm pack` と `npm install -g --prefix .npm-global` で配布導線を検証した
- [x] OpenClaw gateway を起動し `health --json` 成功を確認した（state/config/token をローカル指定）
- [x] `npm run test:ui` と `npm run test:e2e` で回帰/E2Eスモークを通過させた
- [x] `npm run test:gui-e2e` でGUIタブ遷移と主要操作UIのE2Eを通過させた
- [x] `easy-openclaw` ランチャーを同梱ネイティブバイナリ実行に切り替え、`npm install -g` 後に追加コンパイルなしで起動することを確認した
- [x] メンタルモデル優先（モデル追加/チャンネル追加/エージェント紐づけ）から OpenClaw strict schema（`agents.defaults.models`/`models.providers`/`agents.list`/`bindings`）へ変換する仕様・設計へ改訂した
- [x] 実装を `model_id + bindings` 中心へ移行し、Setup UI を Models/Channels/Agents のリスト管理（削除含む）へ更新した
- [x] 回帰テストを実行した（`cargo test` / `npm run test:ui` / `npm run test:gui-e2e` / `npm run test:e2e`）
- [x] OpenAI Provider に OAuth（openai-codex）認証モードを追加し、easy-openclaw UI から `openclaw models auth login --provider openai-codex` を実行できるようにした
- [x] Modelモーダルの変更をApply時保存へ統一し、OAuthオンボーディング情報の取り込み保持とTerminal残留抑制を実装した
- [x] 設定変更をドラフト一元管理へ統一し、Apply時のみファイルへ保存する方式へ更新した
- [x] LMStudio/Ollama以外のProviderモデル候補を最新の公開IDベースへ更新し、OpenAI OAuth候補を実利用可能ID（`gpt-5.2`）へ修正した
- [x] Model候補を固定配列から OpenClaw `models list --all --json` の動的取得へ切り替え、取得失敗時は固定候補へフォールバックするようにした
- [x] 動的候補の表示数を最適化し、共通Provider/OpenAI OAuthとも数値表現の大きい順で最大20件を表示しつつ、OpenAI OAuthでは `gpt-5.2 / gpt-5.3-codex / gpt-5.3-codex-spark` を先頭優先で提示するようにした
- [x] Modelモーダルの操作を「追加/更新 + Cancel」の2ボタンに統一し、OpenAI OAuth時はモデル追加submit時にOAuth自動セットアップを起動する方式へ変更した
- [x] Windows の OpenAI OAuth 自動セットアップで、OSX と同様に対話項目（Config handling/Workspace/Gateway など）を既定回答で通過できるよう、Enter 自動入力ポンプを組み込んだ
- [x] OpenClaw / Clawhub のインストール更新タブを追加し、Terminal経由で `npm install -g ...@latest` を実行できるようにした（後続で更新確認方式へ変更）
- [x] インストールタブを改善し、OpenClaw/Clawhubそれぞれの説明・現在バージョン表示・個別のインストール/更新ボタンを表示するUIへ変更した（後続で更新確認方式へ変更）
- [x] Windows配布に向けて `build:native:win32-x64` スクリプトと共通コピーscriptを追加し、`bin/native/win32-x64/easy-openclaw.exe` を同梱可能にした
- [x] macOS依存だったコマンド実行箇所（`bash/sh` 依存の保守コマンド・BOOTSTRAP生成・E2Eスモーク）を両OS対応へ修正した
- [x] 設定画面の部品管理UIを維持しつつ、各項目と選択値の意味を説明するヘルプ文を追加した
- [x] アプリ全体の縦スクロールバーを暗色UIに合わせて調整した
- [x] easy-openclaw終了時にOpenClaw gateway停止確認を出し、停止選択時は終了前に停止するようにした
- [x] Apply完了後にRun/Startへ誘導し、Start成功時にDashboard URLを自動でブラウザ表示するようにした
- [x] Apply完了後はタブ移動せずStart案内のみ表示し、Dashboard自動表示は起動完了ログ確認後に行うよう調整した
- [x] Dashboard自動表示の起動完了ログ判定を安定化し、ログと通知にDashboard URLを表示するようにした
