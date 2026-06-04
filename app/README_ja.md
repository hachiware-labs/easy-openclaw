# easy-openclaw

easy-openclaw は Windows で OpenClaw の初期設定を行うためのブートストラップアプリです。OpenClaw の設定作成、gateway 起動、Slack 連携までを最小操作で進められます。

## 対象構成

- OS: Windows x64
- 配布: `npm install -g easy-openclaw`
- 実行体: 事前ビルド済み `easy-openclaw.exe`
- Channel: Slack
- Model provider: LM Studio、Ollama、OpenAI互換、OpenAI OAuth

Slack は gateway 起動そのものには必須ではありません。先に Model と Agent だけを追加して起動確認し、Slack で会話を受けたい段階で Channel を後から追加できます。

## インストール

```powershell
npm install -g easy-openclaw
easy-openclaw
```

## 基本手順

1. `easy-openclaw` を起動する。
2. `Setup > Models` でモデルを追加する。
3. `Setup > Agents` で Agent を追加する。
4. 必要に応じて `Setup > Channels` で Slack を追加する。
5. `Apply Config` を実行する。
6. `Run` で `Start` を押す。

## Slack 設定

Slack app を作成し、次の値を用意します。

- Slack Bot Token: `xoxb-...`
- Slack App Token: `xapp-...`
- Slack channel ID allowlist: 例 `C0123456789`

Slack app 側では次を設定します。

- Socket Mode を有効化する。
- Bot Token Scopes に `app_mentions:read`、`channels:history`、`groups:history`、`chat:write` などを追加する。
- Event Subscriptions を有効化し、Bot Events に `app_mention`、`message.channels`、`message.groups` などを追加する。
- app を workspace に Install または Reinstall する。
- 対象 Slack チャンネルへ bot を invite する。

その後、easy-openclaw の Channel 追加画面で Slack を登録し、必要な Agent に割り当てます。

## 確認コマンド

```powershell
easy-openclaw --version
easy-openclaw --doctor
```

## 開発・配布更新

```powershell
npm run build
npm run build:native:win32-x64
npm pack
npm install -g .\easy-openclaw-0.0.1.tgz
```
