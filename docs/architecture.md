# architecture.md（必ず書く：最新版）
#1.アーキテクチャ概要（構成要素と責務）
- EasyClaw は `Tauri + Rust` を中核としたデスクトップGUIアプリとして構成する。
- フロントエンド（Tauri WebView）は Setup/Run/Diagnostics のUI状態を管理する。
- バックエンド（Rust Core）はユースケース実行、ドメイン制約判定、外部I/Oを担う。
- 設定出力はユーザーのメンタルモデル入力を `openclaw.json` strict schema へ変換して保存する。
- gateway 実行は ProcessManager が統括し、Mode A（子起動）/Mode B（外部接続）を同一I/Fで扱う。
- TCC実験機能は実験記録を保存し、比較観測に必要な最小データを提供する。

#2.concept のレイヤー構造との対応表
（テキスト図示）
```text
[Tauri UI] -> [Application Services] -> [Domain] -> [Infra Adapters]
                                             -> [Config Files / Gateway Process]
```

| conceptレイヤー | 対応コンポーネント | 主な責務 |
|---|---|---|
| プレゼンテーション層 | `ui/setup`, `ui/run`, `ui/diagnostics` | 入力受付、一覧表示、状態表示、確認ダイアログ |
| アプリケーション層 | `ModelCatalogService`, `ChannelService`, `AgentBindingService`, `OpenClawConfigService`, `RunService`, `ExperimentService` | UC実行、変換、トランザクション境界、エラーID付与 |
| ドメイン層 | `ModelCatalogItem`, `ProviderDefinition`, `Channel`, `Agent`, `BindingRule`, `ConfigSnapshot` | 制約判定、整合性維持、OpenClaw形式の正本化 |
| インフラ層 | `ConfigRepository`, `SecretStore`, `GatewayProcessAdapter`, `HealthAdapter`, `LogStreamAdapter` | ファイルI/O、プロセス制御、ヘルス/ログ接続 |

#3.インターフェース設計（Interface）
### UI/APP境界（ユースケース単位）
#### UC-1: モデル登録（Provider情報含む）
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `create_model` | モデルカタログ新規作成 | `CreateModelInput { model_name: string(1..128), provider_type: enum<openai,compatible,ollama,lmstudio>, base_url: string(1..2048), api_key?: string(0..512) }` | `ModelView { id: string, model_name: string, provider_label: string, status: enum<saved,test_failed> }` | `ERR-ECLAW-0001/0002/0003` |

#### UC-2: Channel登録
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `create_channel` | Channel新規作成 | `CreateChannelInput { type: enum<slack,discord,telegram>, credential: string(1..512) }` | `ChannelView { id: string, type: string, bindings_count: number }` | `ERR-ECLAW-0004/0005/0006` |

#### UC-3: Agent作成/割当（binding生成）
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `create_or_update_agent` | Agent設定保存 | `UpsertAgentInput { display_name: string(1..64), workspace_path: string(1..4096), model_id: string, channel_id?: string, force_rebind?: bool }` | `AgentView { id: string, display_name: string, model_label: string, channel_label?: string, binding_status: string }` | `ERR-ECLAW-0007/0008/0009` |

#### UC-4: 設定生成
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `apply_config` | OpenClaw互換設定を書き出し | `ApplyConfigInput { target_dir: string(1..4096), backup: bool }` | `ApplyConfigResult { config_path: string, env_path: string, checksum: string }` | `ERR-ECLAW-0010/0011/0012` |

#### UC-5: gateway運用
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `start_gateway` | gateway起動 | `StartGatewayInput { mode: enum<A,B>, dashboard_auto_open: bool, health_timeout_sec: int(1..120) }` | `RunStatus { mode: enum<A,B>, pid?: int, health: enum<starting,ready,failed>, dashboard_url?: string }` | `ERR-ECLAW-0013/0014/0015` |
| `stop_gateway` | gateway停止 | `StopGatewayInput { force: bool }` | `RunStatus { health: enum<stopped> }` | `ERR-ECLAW-0013` |
| `open_dashboard` | Dashboardを開く | `OpenDashboardInput {}` | `OpenDashboardResult { opened: bool, url?: string }` | `ERR-ECLAW-0017` |
| `stream_logs` | ログ受信 | `StreamLogsInput { since_seq?: uint64 }` | `LogBatch { items: array<LogLine> }` | `ERR-ECLAW-0016` |

#### UC-6: TCC実験記録
| 操作/API | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `record_experiment` | A/B観測記録保存 | `ExperimentInput { case_id: string(1..32), mode: enum<A,B,C>, result: enum<success,failed>, observed_error?: string(0..512), note?: string(0..2000) }` | `ExperimentView { id: string, recorded_at: string, mode: string, result: string }` | `ERR-ECLAW-0018/0019` |

### 外部I/F（API単位）
#### API: OpenClaw gateway process
| メソッド | 役割 | 入力（型/主要フィールド/値範囲） | 出力（型/主要フィールド） | 例外（発生条件） |
|---|---|---|---|---|
| `spawn_gateway` | gatewayプロセス開始 | `GatewaySpawnSpec { binary_path: string, args: array<string>, env: map<string,string> }` | `GatewayHandle { pid: int, started_at: string }` | 実行ファイル不存在、権限不足 |
| `check_health` | 起動可否判定 | `HealthSpec { endpoint: string, timeout_ms: int(100..120000) }` | `HealthResult { ready: bool, status_code?: int }` | 接続失敗、タイムアウト |
| `tail_logs` | stdout/stderr購読 | `LogTailSpec { handle: GatewayHandle }` | `array<LogLine { ts: string, level: string, message: string }>` | 購読切断、I/O失敗 |

### 内部I/F（クラス単位）
#### Class: ModelCatalogService
##### Method: `create_model`
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| input | CreateModelInput | モデル登録入力 | `model_name/provider_type/base_url` 必須 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| result | ModelView | `id`, `model_name`, `provider_label`, `status` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `ERR-ECLAW-0001` | ModelCatalogService.validate | 必須項目不足 |
| `ERR-ECLAW-0002` | ModelCatalogService.validate | URL形式不正 |
| `ERR-ECLAW-0003` | ModelConnectivityProbe.ping | 疎通タイムアウト |

#### Class: AgentBindingService
##### Method: `upsert_agent`
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| input | UpsertAgentInput | Agent保存入力 | display_name 1..64、workspace_pathとmodel_id必須 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| result | AgentView | `id`, `display_name`, `model_label`, `channel_label`, `binding_status` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `ERR-ECLAW-0007` | AgentBindingService.resolve_model | model参照切れ |
| `ERR-ECLAW-0008` | AgentBindingService.resolve_channel | channel参照切れ |
| `ERR-ECLAW-0009` | BindingPolicy.ensure_unique_target | binding競合/上書き |

#### Class: OpenClawConfigService
##### Method: `apply_config`
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| input | ApplyConfigInput | 設定出力要求 | target_dir 必須、backup既定true | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| result | ApplyConfigResult | `config_path`, `env_path`, `checksum` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `ERR-ECLAW-0010` | ConfigAssembler.validate | 必須設定不足 |
| `ERR-ECLAW-0011` | AtomicFileWriter.write | ファイルI/O失敗 |
| `ERR-ECLAW-0012` | ConfigVerifier.verify | 生成結果不整合 |

#### Class: RunService
##### Method: `start_gateway`
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| input | StartGatewayInput | 起動要求 | mode必須、timeout 1..120 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| result | RunStatus | `mode`, `pid`, `health`, `dashboard_url` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `ERR-ECLAW-0013` | GatewayProcessAdapter.spawn | 起動不可 |
| `ERR-ECLAW-0014` | HealthAdapter.wait_ready | ヘルス不達 |
| `ERR-ECLAW-0015` | RunStateGuard.ensure_single_run | 多重起動 |

#### Class: ExperimentService
##### Method: `record`
| 引数 | 型 | 意味 | 値範囲/制約 | 必須 |
|---|---|---|---|---|
| input | ExperimentInput | 実験記録入力 | case_id/mode/result 必須 | 必須 |

| 戻り値 | 型 | 主要フィールド |
|---|---|---|
| result | ExperimentView | `id`, `recorded_at`, `mode`, `result` |

| 例外 | 発生場所 | 発生原因 |
|---|---|---|
| `ERR-ECLAW-0018` | ExperimentService.validate | 記録不足 |
| `ERR-ECLAW-0019` | ExperimentRepository.save | 保存失敗 |

#### 依存先I/F（最小契約）
| 依存先 | 最小メソッド | 目的 |
|---|---|---|
| ModelCatalogRepository | `save/find_by_id/list/update/delete` | モデルカタログ永続化 |
| ProviderRepository | `save/find_by_id/list/update/delete` | provider定義永続化 |
| ChannelRepository | `save/find_by_id/list/update/delete` | Channel永続化 |
| AgentRepository | `save/find_by_id/list/update/delete` | Agent永続化 |
| BindingRepository | `save/list/remove/find_by_channel` | binding永続化 |
| ConfigRepository | `write_atomic/read_latest/backup` | 設定ファイル保存 |
| SecretStore | `put/get/remove` | API key/token保持 |
| GatewayProcessAdapter | `spawn/stop/status/subscribe_logs` | gateway運用 |
| HealthAdapter | `wait_ready/check_once` | 起動判定 |
| ExperimentRepository | `save/list` | TCC実験記録 |

### 型定義（入出力/DTOの主要フィールド）
| 型 | 主要フィールド（値範囲/制約） | 用途 |
|---|---|---|
| CreateModelInput | `model_name: string(1..128)`, `provider_type: ProviderType`, `base_url: string(1..2048)`, `api_key?: string(0..512)` | UC-1 |
| CreateChannelInput | `type: ChannelType`, `credential: string(1..512)` | UC-2 |
| UpsertAgentInput | `display_name: string(1..64)`, `workspace_path: string(1..4096)`, `model_id: string`, `channel_id?: string`, `force_rebind?: bool` | UC-3 |
| ApplyConfigInput | `target_dir: string(1..4096)`, `backup: bool` | UC-4 |
| StartGatewayInput | `mode: RunMode`, `dashboard_auto_open: bool`, `health_timeout_sec: int(1..120)` | UC-5 |
| LogBatch | `items: array<LogLine { ts: string, level: enum<debug,info,warn,error>, message: string }>` | UC-5 |
| ExperimentInput | `case_id: string(1..32)`, `mode: enum<A,B,C>`, `result: enum<success,failed>`, `note?: string(0..2000)` | UC-6 |

#4.主要フロー設計（成功/失敗）
| フロー | 成功条件 | 失敗条件 | 例外時の動作 |
|---|---|---|---|
| モデル登録 | モデルカタログが保存され選択可能になる | 必須欠落/URL不正/疎通失敗 | `MSG-ECLAW-0001/0002/0003` を表示 |
| Channel登録 | Channelが保存され選択可能になる | 入力不足/認証失敗/到達不可 | `MSG-ECLAW-0004/0005/0006` を表示 |
| Agent保存 | Agentとbindingが整合状態で保存される | 参照切れ/binding競合 | `MSG-ECLAW-0007/0008/0009` を表示 |
| 設定生成 | `openclaw.json`+`.env` を保存 | 設定不足/I/O失敗/検証失敗 | `MSG-ECLAW-0010/0011/0012` を表示 |
| Run開始 | gateway ready を観測 | 起動失敗/タイムアウト/多重起動 | `MSG-ECLAW-0013/0014/0015` を表示 |
| ログ/ダッシュボード | ログ購読またはURL起動が成功 | ログ断/URL未確定 | `MSG-ECLAW-0016/0017` を表示 |
| TCC記録保存 | A/B比較用レコードを保存 | 入力不足/保存失敗 | `MSG-ECLAW-0018/0019` を表示 |

#5.データ設計（永続化・整合性・マイグレーション）
| データ | 永続化 | 整合性 | マイグレーション |
|---|---|---|---|
| ModelCatalog | `data/models.json` | `id`一意、`model_name`必須 | `agents.defaults.models[]` へ写像 |
| ProviderDefinition | `data/providers.json` | `id`一意、`base_url`必須 | `models.providers[]` へ写像 |
| Channel | `data/channels.json` | `id`一意 | `channels.<type>` へ写像 |
| Agent | `data/agents.json` | `model_id`存在必須、`workspace_path`必須 | `agents.list[]` へ写像 |
| Binding | `data/bindings.json` | `channel_ref`一意、`agent_id`存在必須 | `bindings[]` へ写像 |
| ConfigSnapshot | `data/config-history/` | 生成時刻とchecksumの組で一意 | 旧履歴は読み取り専用で保持 |
| TccExperimentRecord | `data/experiments.jsonl` | `case_id` + `recorded_at` で追跡可能 | 行追加型でスキーマ拡張 |
| Secrets | OS keychain優先、fallbackでローカル暗号化 | 平文保存禁止、参照は`*_ref`のみ | keychain未対応環境は暗号化ファイル移行 |

#6.設定：場所／キー／既定値
| 項目 | 場所 | キー | 既定値 |
|---|---|---|---|
| 設定出力先 | App設定 | `output.target_dir` | `$HOME/.easyclaw/output` |
| 実行モード | App設定 | `run.mode` | `A` |
| Dashboard自動オープン | App設定 | `run.dashboard_auto_open` | `true` |
| ヘルス判定秒数 | App設定 | `run.health_timeout_sec` | `30` |
| UIテーマ連続性 | App設定 | `ui.theme_profile` | `openclaw-compatible` |
| OpenClaw config path | 生成ファイル | `openclaw.config_path` | `openclaw.json` |
| OpenClaw env path | 生成ファイル | `openclaw.env_path` | `.env` |

#7.依存と拡張点（Extensibility）
| 依存 | 目的 | 拡張点 |
|---|---|---|
| Tauri runtime | GUI実行基盤 | WebView更新、OS別ビルド設定 |
| OpenClaw gateway | 実行対象 | 起動引数追加、バージョン差分吸収 |
| Channel provider APIs | 疎通確認 | チャネル種別の追加（LINE等） |
| Provider endpoints | モデル接続 | ProviderType追加（Anthropic互換等） |
| Secret backend | 認証情報保持 | Keychain以外のVault連携 |

#7.5.依存関係（DI）
（テキスト図示）
```text
RunService -> GatewayProcessAdapter
RunService -> HealthAdapter
OpenClawConfigService -> ConfigRepository
AgentBindingService -> AgentRepository + BindingRepository + ModelCatalogRepository + ChannelRepository
```

| クラス | コンストラクタDI（依存先） | 目的 |
|---|---|---|
| ModelCatalogService | `ModelCatalogRepository`, `ProviderRepository`, `ModelConnectivityProbe`, `SecretStore` | モデル保存と検証 |
| ChannelService | `ChannelRepository`, `ChannelProbe`, `SecretStore` | Channel保存と検証 |
| AgentBindingService | `AgentRepository`, `BindingRepository`, `ModelCatalogRepository`, `ChannelRepository`, `BindingPolicy` | 割当整合管理 |
| OpenClawConfigService | `ModelCatalogRepository`, `ProviderRepository`, `ChannelRepository`, `AgentRepository`, `BindingRepository`, `ConfigRepository` | OpenClaw形式生成 |
| RunService | `GatewayProcessAdapter`, `HealthAdapter`, `LogStreamAdapter`, `RunStateStore` | 起動運用 |
| ExperimentService | `ExperimentRepository` | 比較記録保存 |

#8.エラーハンドリング設計（冪等性/リトライ/タイムアウト/部分失敗）
| 事象 | 発生場所 | 発生原因 | 方針 | 備考 |
|---|---|---|---|---|
| 同一内容の再保存 | Model/Channel/Agent/binding保存 | 二重クリック、再送 | 冪等upsertで最新値を採用 | 監査用に更新時刻を保持 |
| 疎通失敗 | Model/Channel probe | 一時的ネットワーク断 | 指数バックオフ1回 + 手動再試行 | 失敗時は保存可否を明示 |
| 起動待機タイムアウト | RunService | gateway起動遅延 | timeout後にfailedへ遷移 | `ERR-ECLAW-0014` |
| ログ購読断 | LogStreamAdapter | 子プロセス終了/I/O断 | 再購読を1回試行 | 失敗は警告のみ |
| 設定保存部分失敗 | ConfigRepository | 片方ファイルのみ失敗 | atomic write + rollback | 中間ファイル削除 |
| 実験記録保存失敗 | ExperimentRepository | 保存先I/O失敗 | メモリキュー保持後に再保存 | アプリ終了時に警告 |

#9.セキュリティ設計（秘密情報・最小権限・ログ方針）
| 観点 | 方針 |
|---|---|
| 秘密情報保持 | API key/tokenは `SecretStore` 管理、設定本体には参照IDのみ保持 |
| 最小権限 | ファイル書き込みは出力ディレクトリ配下に限定し、不要なOS権限を要求しない |
| 実行制御 | gateway起動時は許可済み引数のみ組み立てる |
| ログ方針 | 機密値はマスクし、エラーIDと相関IDのみ出力する |
| TCC観測 | 観測ガイドを提示し、許可変更そのものはOS設定に委譲する |

#10.観測性（ログ/診断：doctor/status/debug）
| 種別 | 内容 | 出力先 |
|---|---|---|
| app log | ユースケース開始/完了、ERR-ID、相関ID | `logs/easyclaw.log` |
| gateway log | stdout/stderr tail | Runタブ + `logs/gateway.log` |
| health status | 起動モード、ready判定時刻、失敗理由 | Runタブ |
| diagnostics | TCC実験ケース、結果、観測メモ | Diagnosticsタブ + `data/experiments.jsonl` |
| doctor summary | 設定整合、保存先権限、接続先到達性 | Diagnosticsタブ |

## 例外ハンドリング方針（UI/ユースケース層）
| UC | 例外 | 表示/通知 | エラーID/コード方針 | 関連spec ERR-ID |
|---|---|---|---|---|
| UC-1 | 入力不足/URL不正/疎通失敗 | 入力欄下に即時表示 + 保存阻止 | `ERR-ECLAW-0001..0003` | ERR-ECLAW-0001..0003 |
| UC-2 | 認証失敗/到達不可 | フォーム上部に警告表示 | `ERR-ECLAW-0004..0006` | ERR-ECLAW-0004..0006 |
| UC-3 | 参照切れ/競合割当 | ダイアログ確認 + 再割当明示 | `ERR-ECLAW-0007..0009` | ERR-ECLAW-0007..0009 |
| UC-4 | 生成失敗 | Apply結果パネルに失敗理由表示 | `ERR-ECLAW-0010..0012` | ERR-ECLAW-0010..0012 |
| UC-5 | 起動/ヘルス/多重起動 | Runステータスをfailedに遷移 | `ERR-ECLAW-0013..0017` | ERR-ECLAW-0013..0017 |
| UC-6 | 記録不足/保存失敗 | Diagnosticsの保存トースト表示 | `ERR-ECLAW-0018..0019` | ERR-ECLAW-0018..0019 |
| 共通 | UI連続性逸脱 | QAチェックで不一致を記録 | `ERR-ECLAW-0020` | ERR-ECLAW-0020 |

#11.テスト設計（単体/統合/E2E、モック方針）
| 種別 | 対象 | 方針 |
|---|---|---|
| 単体テスト | `AssignmentPolicy`, `ConfigAssembler`, `RunStateGuard` | 制約判定・生成規則を純粋関数中心に検証 |
| 単体テスト | Service層 | Repository/Adapterをモック化しERR-ID返却を検証 |
| 統合テスト | ConfigRepository + AtomicFileWriter | 一時ディレクトリでbackup/rollback動作を検証 |
| 統合テスト | GatewayProcessAdapter + HealthAdapter | ダミープロセスでstart/timeout/stop遷移を検証 |
| E2Eテスト | Setup→Apply→Run→Diagnostics | MVP主要UCをTauriテストで通し確認 |
| UI回帰テスト | OpenClaw連続性 | ナビ構造、用語、主要コンポーネントの差分確認 |

#12.配布・実行形態（インストール/更新/互換性/破壊的変更）
- 配布は npm パッケージ経由（`npm install -g easyclaw`）で行う。
- npmパッケージにはOS別Rustビルド成果物を含め、インストール時に実行可能ファイルを配置する。
- 更新は npm の semver に従い、破壊的変更は major 更新でのみ提供する。
- 既存設定との互換性は「OpenClawが受理できる形式」を優先し、差分は `ConfigVerifier` で検知する。
- 破壊的変更時は起動時に移行ガイドを表示し、旧設定バックアップを必須化する。

#13.CLI：コマンド体系／引数／出力／exit code
- 基本方針: GUIアプリが主であり、CLIは起動補助に限定する。
- コマンド体系:
  - `easyclaw` : GUIを起動する
  - `easyclaw --version` : バージョン表示
  - `easyclaw --doctor` : 事前診断（設定・権限・接続先）
- 引数:
  - `--mode <A|B>`（任意）: 初期Runモード
  - `--config-dir <path>`（任意）: 設定保存先上書き
- 出力:
  - 正常時は標準出力に要約1行、詳細はGUI/ログに表示
  - 異常時は `ERR-ECLAW-xxxx` を標準エラーに出力
- exit code:
  - `0`: 正常
  - `2`: 入力不正
  - `3`: 設定生成失敗
  - `4`: gateway起動失敗
  - `5`: 診断失敗
