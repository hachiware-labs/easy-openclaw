# LMStudio + Slack 実物検査ログ（easy-openclaw）

## 1. 実施情報
- 実施日: 2026-02-14
- 実施者:
- easy-openclaw バージョン:
- OS:

## 2. 事前環境
- LMStudio 起動状態:
- LMStudio base_url (`LMSTUDIO_BASE_URL`):
- Slack Bot Token (`SLACK_BOT_USER_OAUTH_TOKEN`):
- OpenClaw gateway binary (`OPENCLAW_GATEWAY_BIN`):
- OpenClaw health URL (`OPENCLAW_HEALTH_URL`):
- OpenClaw state dir (`OPENCLAW_STATE_DIR`): `.openclaw-state`（テスト時に設定）
- OpenClaw token (`OPENCLAW_GATEWAY_TOKEN`): テスト時に設定

## 3. 手順と結果
### IT-0001 Provider疎通（LMStudio）
- 手順: `.env` の `LMSTUDIO_BASE_URL` を参照して `GET /v1/models` を実行
- 結果: OK（再試行で成功）
- 補足: 最新確認で `HTTP_STATUS:200`、models 一覧応答を取得

### IT-0002 Channel疎通（Slack）
- 手順: `SLACK_BOT_USER_OAUTH_TOKEN` で `auth.test`、`SLACK_APP_LEVEL_TOKEN` で `apps.connections.open` を実行
- 結果: OK
- 補足: いずれも `"ok": true` を確認

### IT-0002-1 Slack 読み書き確認（SLACK_CHANNEL_ID）
- 手順: `conversations.history?limit=1` と `chat.postMessage` を `SLACK_CHANNEL_ID` 宛に実行
- 結果: OK
- 補足: 読み取り/書き込みともに `"ok": true` を確認

### IT-0003 gateway実プロセス起動
- 手順: `gateway --allow-unconfigured` を起動し、`openclaw health --json` の成功を確認して停止
- 結果: OK
- 補足: `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` / `OPENCLAW_GATEWAY_TOKEN` を設定して実施

### IT-0004 Setup→Apply→Run 通し
- 手順: `npm run test:e2e`（LMStudio疎通→Slack read/write→gateway起動/health）
- 結果: OK
- 補足: スモークE2Eとして通過。UI操作を伴うE2Eは別途GUIテストで拡張余地あり

### IT-0005 TCC比較（Case A/B）
- Case A 結果:
- Case B 結果:
- 差分観測:

### IT-0006 グローバル配布起動（同梱バイナリ）
- 手順: `cd app && npm pack && npm install -g ./easy-openclaw-0.0.1.tgz` 後、`easy-openclaw --version` / `easy-openclaw --doctor` / `easy-openclaw` 起動を確認
- 結果: OK
- 補足: `easy-openclaw` 起動時に `bin/native/darwin-x64/easy-openclaw` が子プロセスとして実行され、`tauri dev` や追加コンパイルは発生しないことを確認

### デザイン比較E2E（OpenClawトンマナ）
- 手順: `cd app && npm run test:brand-e2e` を実行し、OpenClaw公式サイトと easy-openclaw のスクリーンショットを保存
- 結果: OK
- 補足: 出力先は `app/test-results/brand.e2e-OpenClaw-tone-snapshot-pair-is-captured/openclaw-home.png` と `app/test-results/brand.e2e-OpenClaw-tone-snapshot-pair-is-captured/easy-openclaw-home.png`

## 4. エラー記録
- ERR-ID:
- 発生箇所:
- 再現手順:
- 回避策/修正案:

## 5. 判定
- 合格/不合格:
- 次アクション:
