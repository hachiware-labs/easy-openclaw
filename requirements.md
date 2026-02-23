# requirements.md — OpenClaw 設定アプリ（onboard代替）+ TCC実験（macOS / MVP）

## 0. 概要
OpenClaw の初期セットアップは Control UI（ダッシュボード）が多機能で分かりにくく、特に macOS では TCC（Screen Recording / Accessibility 等）の扱いが「設定ファイルとは別管理」で混乱しやすい。

本アプリは **`openclaw onboard` の代替**として、以下を最小のUIで完結させる：
- **モデル（Provider）**の登録（複数）
- **チャネル（Slack/Discord/Telegram）**の登録（複数）
- **複数エージェント**の作成と、エージェントへの **モデル・チャネル割り当て**
- **アプリから gateway を起動/停止**し、TCC が安定するかを検証できる（実験）

> 設定の具体キーは OpenClaw のバージョンで変わり得るため、MVPでは
> **「OpenClawが受理できる形式に変換して出力する」**ことを要件とする（出力の中身は実装で追従）。

---

## 1. 用語
- **Provider**: モデル接続先（OpenAI系 / OpenAI互換 / Ollama / LMStudio など）
- **Channel**: 外部チャット連携（Slack / Discord / Telegram）
- **Agent**: OpenClaw のエージェント定義（複数作成可能）
- **TCC**: macOS のプライバシー許可（OS管理）。設定ファイルとは独立。
- **Mode A**: 本アプリが **親プロセスとして gateway を子プロセス起動**する方式（推奨・デフォルト）
- **Mode B**: 既存の外部 gateway に接続する方式（比較・将来用）

---

## 2. 背景整理（重要な前提）
### 2.1 OpenClaw の設定が“増える”理由（3層）
1. **メイン設定**: `openclaw.json`（JSON5含む）+ `$include`
2. **環境変数**: `.env` 等（設定へ注入。secrets分離の主戦場）
3. **派生・状態 JSON**: `models.json` / `auth-profiles.json` 等（状態・認証・レジストリ）。
   - 「設定を変えたのに効かない」は、agent側の派生JSONが上書きしている可能性がある。

### 2.2 “eligible”
スキルが **依存・権限・ポリシーを満たし、実行候補として使える状態**。

### 2.3 macOS TCC
- TCCは **OSが記録する許可**であり、設定ファイルやCLI操作とは別。
- 許可は「製品名」ではなく、主に
  - **.app（Bundle ID + 署名 + 配置）** または
  - **単体バイナリ（パス等）**
  に紐づく。
- CLI（`openclaw`）と GUI（`OpenClaw.app`）は **別扱いになり得る**。
- 親子関係だけではなく、OSが決める **責任主体（responsible process）**で挙動が揺れる。
  → **TCCを一箇所に寄せる**設計が安定しやすい。

---

## 3. 目的（MVPのゴール）
1. ユーザーが **好きなモデル**（複数登録可）を使える  
2. ユーザーが **好きなチャネル**（Slack/Discord/Telegram）で運用できる  
3. ユーザーが **複数エージェント**を作成し、各エージェントに Provider/Model と Channel を割り当てられる  
4. 初版では **チャネルを利用できるのは1エージェントまで**（ルーティングを単純化）  
5. アプリ起点で gateway を起動することで **TCCが改善するか検証できる**（実験）

---

## 4. スコープ
### 4.1 In Scope（MVPでやる）
- Providers/Channels/Agents を GUI で作成・編集・削除
- OpenClawが読み込める設定へ出力（`openclaw.json` + `.env`）
- アプリ内から gateway を起動/停止し、ログを閲覧、Dashboard URL を開ける
- TCC実験（Mode A と Mode B の比較が可能）

### 4.2 Out of Scope（MVPではやらない / 将来）
- 同一チャネルを複数エージェントで共有する高度なルーティング（bindings 等）
- エージェントの人格・プロンプト詳細編集（初版はブートストラップへ委譲）
- スキルのインストール管理UI（マーケット/依存導線）
- 高度な承認フローUI（exec approvals の最適化、監査UI 等）

---

## 5. 画面/タブ構成（MVP）
### 5.1 Setup タブ（設定）
- Providers（Models/Providers）
- Channels
- Agents

### 5.2 Run タブ（起動・運用・実験）
- Apply（保存） / Start / Stop
- Health（起動判定）
- Logs（tail）
- Open Dashboard（自動 or ボタン）
- 起動モード切替（Mode A / Mode B）

### 5.3 Diagnostics タブ（任意 / v1.1でも可）
- TCC チェックリスト（Accessibility / Screen Recording 等）
- 実験ログの保存（A/B比較）
- 観測ガイド（OS設定で何を見るか、必要なら `log stream` のガイド）

---

## 6. 機能要件

### 6.1 Providers（モデル接続先）
#### MUST
- Provider を複数登録できる
- Provider type を選べる
  - OpenAI系（API key）
  - OpenAI互換（base_url指定可）
  - **Ollama**
  - **LMStudio**
- **base_url を入力できる**（LAN上のURL含む）
- default_model（文字列）を設定できる
- 簡易疎通テスト（最低：HTTP到達/タイムアウト）

#### SHOULD
- extra_headers、TLS検証設定等を拡張可能な形で保持
- Provider の用途タグ（fast/cheap/vision/tool-use 等）を任意で保持

---

### 6.2 Channels（Slack / Discord / Telegram）
#### MUST
- Slack / Discord / Telegram を登録できる
- 各種の認証情報（token等）を入力できる
- チャネルの簡易疎通テスト（可能な範囲）
- **MVP制約**: 1チャネルに割り当て可能なエージェントは最大1つ
- UIで「割当状態」を明確に表示し、再割当時は「既存割当が外れる」ことを明示

#### SHOULD
- 各チャネル種別ごとに、入力補助（取得手順リンク、必要権限のメモ等）

---

### 6.3 Agents（複数）
#### MUST
- エージェントを複数作成できる
- 各エージェントに以下を設定できる
  - 利用 Provider
  - 利用 Model（Provider default を上書き可）
  - 利用 Channel（※MVPではチャネル利用可は1エージェントまで）
  - workspace / 作業ディレクトリ（必要なら）
- エージェントの表示名を設定できる

#### 方針（MVP）
- エージェントの性格・初期プロンプト・初期ファイル生成は **ブートストラップ**に委譲。
- 設定アプリは「ブートストラップに必要な最小情報」を生成する。

---

### 6.4 ルーティング制約（MVP）
- **チャネルが“会話窓口”として使えるのは最大1エージェント**。
- 実装上の推奨：Channel 側に `owner_agent_id` を持ち、チャネル割当の正を Channel とする。

---

### 6.5 設定出力（OpenClaw適用）
#### MUST
- 出力物を生成する
  - `openclaw.json`（もしくはOpenClawが読み込める設定）
  - `.env`（secrets: API key / token / base_url 等）
- 保存はバックアップ＋atomic write（テンポラリ→リネーム）推奨
- 既定保存先へ保存できる（ユーザーが選べるのは将来でもOK）

#### SHOULD
- 既存設定の読み込みと差分更新（v1.1以降でも可）
- 設定バリデーション（必須項目欠落の検知）

---

### 6.6 Run（gateway起動/停止）
#### MUST
- gateway を **アプリから起動/停止**できる
- 起動ログ（stdout/stderr）をアプリ内で閲覧できる
- ヘルスチェックで起動成功/失敗を判断できる
- 起動後、Dashboard URL を **自動で開ける**（＋手動Openボタン）

#### 起動モード
- **Mode A（デフォルト）**: アプリが親プロセスとして子プロセス起動（TCC実験の主ルート）
- Mode B: 外部gatewayへ接続（比較・将来）

---

## 7. TCC 実験要件
### 7.1 目的
- 「アプリ親起動でTCCが安定するか」を検証する（成功を保証しない）。

### 7.2 実験ケース（最小）
- Case A: CLIで gateway 起動 → 画面系操作実行
- Case B: アプリ親起動（Mode A）→ 同じ画面系操作実行
- （余裕があれば）Case C: 画面系処理をアプリ側に寄せた構成で実行

### 7.3 観測（MUST）
- 実行経路（A/B/C）と結果（成功/失敗、エラー）を記録
- 可能なら「どの実行体が許可主体になったか」を観測できるガイドを提示
  - OS設定の該当一覧で許可対象を確認
  - 必要なら `log stream --predicate 'subsystem == "com.apple.TCC"' --info` のガイド

---

## 8. プリセット（デフォルト）
MVPでアプリ内にデフォルト（推奨プリセット）を持ち、そこから編集できるようにする。

### 8.1 Preset: Local-first（推奨）
- Provider: Ollama（例：`http://localhost:11434`）
- Provider: LMStudio（例：`http://localhost:1234`）
- Agent: `main`（Channel未割当）
- Run: localhost bind、Dashboard自動オープン

### 8.2 Preset: Remote/OpenAI互換
- Provider: OpenAI互換（base_url入力を強調）
- `.env` に API key を保存する導線

---

## 9. 受け入れ基準（Acceptance Criteria）
MVPとして最低限、以下を満たす：
1. Provider を2つ以上登録できる（例：OpenAI互換 + Ollama）
2. Slack/Discord/Telegram のいずれか1つを設定し、疎通テストができる
3. Agent を2つ以上作成できる
4. 「チャネル利用は1エージェントまで」の制約が UI/内部で守られる
5. 生成した設定で gateway を起動できる（Mode A）
6. アプリ内でログ閲覧・ヘルスチェック・Dashboardオープンができる
7. TCC実験で Case A/B を再現し、比較できる（ログ/メモが残る）

---

## 10. 将来拡張（v2以降）
- 複数エージェントが同一チャネルを共有するルーティングUI（bindings、@mention、prefix等）
- エージェント人格/プロンプト編集（テンプレ、プリセット）
- スキル管理（インストール、要件、eligible判定の可視化）
- secretsのKeychain完全移行、監査ログ、承認フローの高度化
