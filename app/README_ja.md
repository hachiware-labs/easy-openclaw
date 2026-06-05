# easy-openclaw

easy-openclaw は、OpenClaw の初回セットアップの難しさを、Provider・Channel・Agent・Gateway 起動確認の一本道に整理し、Dashboard へ到達できる状態まで支援する軽量セットアップ UI です。

OpenClaw の設定ファイル構造やルーティングの詳細を最初から理解していなくても、モデル接続先を選び、必要なら Slack を追加し、Agent を作り、設定を適用し、Gateway を起動して Dashboard を開くところまで進められるようにします。

## できること

- LM Studio、Ollama、OpenAI互換、OpenAI OAuth などのモデル Provider を登録する。
- OpenClaw に Slack メッセージを受け取らせたい場合に Channel を追加する。
- Workspace、Model、任意の Channel を束ねる Agent を作成する。
- JSON を手で編集せず、OpenClaw 互換の設定ファイルを生成する。
- OpenClaw Gateway をアプリから起動・停止する。
- Gateway のヘルスを確認し、起動後に Dashboard を開く。

Slack は Gateway 起動そのものには必須ではありません。まず Provider と Agent だけで Gateway と Dashboard の起動確認を行い、Slack で会話を受けたい段階で Channel を後から追加できます。

## 対象構成

- OS: Windows x64
- 配布: `npm install -g easy-openclaw`
- 実行体: 事前ビルド済み `easy-openclaw.exe`
- チュートリアル対象 Channel: Slack
- Model provider: LM Studio、Ollama、OpenAI互換、OpenAI OAuth

## インストール

```powershell
npm install -g easy-openclaw
easy-openclaw
```

確認コマンド:

```powershell
easy-openclaw --version
easy-openclaw --doctor
```

## セットアップチュートリアル

このチュートリアルでは、最初にモデルと Agent を1つ作り、必要な場合だけ後から Slack を追加します。

### 1. Model Provider を用意する

次のいずれかを用意します。

- LM Studio: ローカルサーバーを起動し、通常は `http://127.0.0.1:1234` を使う。
- Ollama: Ollama を起動し、通常は `http://127.0.0.1:11434` を使う。
- OpenAI互換: base URL、model name、API key を用意する。
- OpenAI OAuth: モデル追加画面から OAuth フローを実行する。

easy-openclaw では次のように登録します。

1. `Setup` を開く。
2. `Models` へ移動する。
3. `Add Model` を押す。
4. Provider をドロップダウンから選ぶ。
5. Provider に必要な base URL、model name、認証情報を入力する。
6. Model を保存する。

### 2. Agent を作成する

Agent は、Workspace と Model を使って実行される OpenClaw の単位です。

1. `Setup > Agents` へ移動する。
2. `Add Agent` を押す。
3. Agent 名を入力する。
4. 追加済みの Model を選ぶ。
5. Workspace path を設定する。
6. Gateway と Dashboard の起動確認だけを先に行う場合は、Channel は空のままにする。
7. Agent を保存する。

### 3. 必要なら Slack を後から追加する

Slack app を作成し、次の値を用意します。

- Slack Bot Token: `xoxb-...`
- Slack App Token: `xapp-...`
- Slack channel ID allowlist: 例 `C0123456789`

Slack app 側では次を設定します。

1. Socket Mode を有効化する。
2. Bot Token Scopes に `app_mentions:read`、`channels:history`、`groups:history`、`chat:write` などを追加する。
3. Event Subscriptions を有効化する。
4. Bot Events に `app_mention`、`message.channels`、`message.groups` などを追加する。
5. app を workspace に Install または Reinstall する。
6. 対象 Slack チャンネルへ bot を invite する。

その後、easy-openclaw で次のように登録します。

1. `Setup > Channels` へ移動する。
2. `Add Channel` を押す。
3. Slack を選ぶ。
4. Slack token と channel allowlist を入力する。
5. Channel を保存する。
6. Agent を編集し、Slack Channel を割り当てる。

### 4. Config を適用する

1. `Setup > Apply` へ移動する。
2. `Apply Config` を押す。
3. 設定ファイルが生成されたことを確認する。
4. 画面遷移は任意です。次に行う操作は `Run` の `Start` です。

easy-openclaw は Setup で登録した部品から OpenClaw 互換設定を生成します。通常の初回セットアップでは、`openclaw.json` を手で編集する必要はありません。

### 5. Gateway を起動し Dashboard を開く

1. `Run` を開く。
2. `Start` を押す。
3. Gateway が ready になるまで待つ。
4. easy-openclaw が起動完了ログを確認し、Dashboard URL をブラウザで開く。

ブラウザが前面に出ない場合は、Run 画面の通知と Logs を確認してください。Dashboard URL が表示されます。

### 6. 終了時は Stop する

作業が終わったら Run 画面の `Stop` を使います。easy-openclaw を閉じるときに Gateway が起動中または起動中の可能性がある場合は、OpenClaw も停止するか確認します。

## 基本の考え方

- Provider: モデルの接続先です。
- Channel: Slack など、外部からメッセージが入ってくる場所です。初回の Gateway 起動確認では任意です。
- Agent: Workspace と Model を使って動く OpenClaw の実行単位です。必要に応じて Channel を割り当てます。
- Apply Config: Setup で登録した部品から OpenClaw 設定を書き出します。
- Gateway: OpenClaw の実行プロセスです。Dashboard もここから利用します。
- Dashboard: OpenClaw が起動していることを確認し、運用状態を見るブラウザ画面です。

## 開発・配布更新

```powershell
npm run build
npm run build:native:win32-x64
npm pack
npm install -g .\easy-openclaw-0.0.1.tgz
```
