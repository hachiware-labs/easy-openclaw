# concept.md（必ず書く：最新版）
#1.概要（Overview）（先頭固定）
- 作るもの（What）：OpenClaw の初期設定を最小UIで完了できる Rust 製ブートストラップアプリ `EasyClaw`
- 解決すること（Why）：OpenClaw 設定の複雑さ（設定層の分散、TCCの理解負担、複数エージェント/チャネル割当の煩雑さ）を減らす
- できること（主要機能の要約）：Provider/Channel/Agent の設定、OpenClaw向け設定出力、gateway 起動停止、TCC比較実験
- 使いどころ（When/Where）：macOS 上で OpenClaw を新規導入または再構成する運用時
- 成果物（Outputs）：`openclaw.json` 互換設定、`.env`、起動ログ、TCC実験メモ
- 前提（Assumptions）：配布は `npm install -g`、実体は Rust バイナリ、MVP は「1チャネル=1エージェント割当」

#2.ユーザーの困りごと（Pain）
- OpenClaw の設定が `openclaw.json` / `.env` / 派生JSON に分かれ、何を直せば良いか分かりづらい。
- Provider と Channel を複数組み合わせた運用初期設定が手作業だと時間がかかる。
- エージェント単位のモデル・チャネル割当で整合を崩しやすい。
- macOS の TCC が CLI/GUI の実行経路で揺れ、再現実験しづらい。
- gateway 起動後の確認（ログ・ヘルス・Dashboard導線）が散在している。

#3.ターゲットと前提環境（詳細）
- ターゲットユーザー: OpenClaw 利用者（個人開発者、検証担当、PoC担当）
- 想定スキル: CLI の基本操作は可能だが、OpenClaw内部設定/TCC詳細は詳しくないユーザー
- 前提OS: macOS（MVPの主要検証対象）
- 前提実行環境: Node.js/npm が利用可能、OpenClaw gateway がローカルで起動可能
- ネットワーク前提: ローカルLLM（Ollama/LMStudio）または外部APIへ接続可能

#4.採用する技術スタック（採用理由つき）
- アプリ本体: Rust（単一バイナリで配布しやすく、プロセス管理と設定ファイル生成の信頼性を確保できるため）
- 配布: npm グローバルパッケージ（`npm install -g` で導入手順を単純化し、Node利用者の導入障壁を下げるため）
- 設定管理: JSON/ENV生成（OpenClaw が受理できる形式へ追従しやすいため）
- 実行制御: 子プロセス管理 + ログ収集（Mode A/Mode B 比較実験のため）

#5.機能一覧（Features）
| ID | 機能 | 解決するPain | 対応UC |
|---|---|---|---|
| F-1 | Provider管理（複数登録/編集/削除） | Provider設定の手作業負担 | UC-1 |
| F-2 | Channel管理（Slack/Discord/Telegram） | チャネル設定の煩雑さ | UC-2 |
| F-3 | Agent管理（複数作成と割当） | 割当整合の崩れやすさ | UC-3 |
| F-4 | 1チャネル1エージェント制約の可視化 | 競合割当の発生 | UC-3 |
| F-5 | OpenClaw互換設定の出力 | 設定層分散による反映不安 | UC-4 |
| F-6 | gateway 起動/停止とヘルス確認 | 実行確認の手間 | UC-5 |
| F-7 | ログ閲覧とDashboard導線 | 起動後の観測導線不足 | UC-5 |
| F-8 | TCC比較実験（Mode A/B） | TCC原因切り分け困難 | UC-6 |

#6.ユースケース（Use Cases）
| ID | 主体 | 目的 | 前提 | 主要手順（最小操作） | 成功条件 | 例外/制約 |
|---|---|---|---|---|---|---|
| UC-1 | 利用者 | 利用するモデル接続先を登録する | EasyClaw 起動済み | Provider種別を選ぶ→base_url/API key等を入力→保存 | Providerが一覧に追加される | 疎通失敗時は保存前に警告表示 |
| UC-2 | 利用者 | 利用するチャネルを登録する | EasyClaw 起動済み | チャネル種別を選ぶ→token等を入力→疎通確認→保存 | Channelが一覧に追加される | 入力不足時は保存不可 |
| UC-3 | 利用者 | エージェントを作成しProvider/Channelを割り当てる | Provider/Channelが1件以上存在 | Agent作成→Provider/Model選択→Channel割当→保存 | Agent設定が保存される | 1チャネルに複数Agentは不可 |
| UC-4 | 利用者 | OpenClawが読める設定を生成する | Agent設定が1件以上存在 | Apply実行→生成結果を確認 | `openclaw.json` と `.env` が生成される | 生成時はatomic writeで安全に保存 |
| UC-5 | 利用者 | gatewayを起動して状態を確認する | 設定生成済み | RunタブでStart→Health確認→必要に応じDashboardを開く→Stop | 起動状態が可視化される | 起動失敗時はログで原因確認 |
| UC-6 | 利用者 | TCC挙動をA/B比較する | macOSで画面系操作を実施可能 | Case A（CLI起動）実施→Case B（Mode A）実施→結果比較記録 | A/Bの差分を再現記録できる | 成功保証ではなく観測目的 |

#7.Goals（Goalのみ／ユースケース紐づけ必須）
- G-1: OpenClaw初期設定を短時間で完了できる（対応：UC-1, UC-2, UC-3, UC-4）
- G-2: gateway運用確認をEasyClaw内で完結できる（対応：UC-5）
- G-3: TCC挙動差分を再現可能な形で記録できる（対応：UC-6）

#8.基本レイヤー構造（Layering）
| レイヤー | 役割 | 主な処理/データ流れ |
|---|---|---|
| プレゼンテーション層 | Setup/Run画面で入力と操作を受け付ける | Provider/Channel/Agent入力、Start/Stop、ログ表示 |
| アプリケーション層 | ユースケース実行と制約適用 | 割当制約判定、設定生成指示、実験フロー記録 |
| ドメイン層 | 設定モデルとルール管理 | Provider/Channel/Agent整合、owner_agent_id制約 |
| インフラ層 | 外部I/Oとプロセス制御 | ファイル出力、gateway子プロセス起動、ヘルスチェック、ログ収集 |

#9.主要データクラス（Key Data Classes / Entities）
| データクラス | 主要属性（不要属性なし） | 用途（対応UC/Feature） |
|---|---|---|
| Provider | id, type, base_url, api_key_ref, default_model, connection_options | UC-1, F-1 |
| Channel | id, type, credential_ref, owner_agent_id | UC-2, UC-3, F-2, F-4 |
| Agent | id, display_name, provider_id, model_override, channel_id, workspace_path | UC-3, F-3 |
| ConfigSnapshot | generated_at, openclaw_config_path, env_path, checksum | UC-4, F-5 |
| GatewayRun | mode, pid, started_at, health_status, dashboard_url | UC-5, F-6, F-7 |
| TccExperimentRecord | case_id, mode, executed_by, result, observed_error, note, recorded_at | UC-6, F-8 |

#10.機能部品の実装順序（Implementation Order）
1. ドメインモデル（Provider/Channel/Agent）と1チャネル1エージェント制約を実装する
2. Setup画面でProvider/Channel/Agent CRUDを実装する
3. OpenClaw互換の設定出力（`openclaw.json` + `.env`）を実装する
4. gateway起動/停止、ヘルス、ログ閲覧、Dashboard導線を実装する
5. Mode A/Mode B切替とTCC実験記録を実装する
6. ローカルファースト/リモート互換のプリセット初期化を実装する
7. npmグローバル導入フローを整備し、初回セットアップ導線を検証する

#11.用語集（Glossary）
- EasyClaw: OpenClaw設定を簡単化する Rust 製ブートストラップアプリ
- Provider: モデル接続先（OpenAI系/OpenAI互換/Ollama/LMStudio）
- Channel: 外部チャット連携（Slack/Discord/Telegram）
- Agent: Provider/Model/Channelを束ねる実行単位
- Mode A: EasyClaw が親プロセスとして gateway を子起動する方式
- Mode B: 外部起動済み gateway に接続する方式
- TCC: macOSプライバシー許可管理（設定ファイルとは独立）
