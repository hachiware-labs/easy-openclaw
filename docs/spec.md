# easy-openclaw

要件とは（レビュー者視点）＋ Given/When/Done ＋ MSG/ERR のID管理  
※I/F詳細・API使用は書かない

# 要件一覧（Requirements）
| ID | 要件（固定書式・正常系のみ） | 関連UC-ID |
|---|---|---|
| REQ-0001 | モデルを登録したら、Provider接続情報（OpenAIは API Key / OAuth を含む）を利用可能モデルとして保存する。 | UC-1 |
| REQ-0002 | Channelを登録したら、利用可能な会話窓口として保存する。 | UC-2 |
| REQ-0003 | Agentを作成したら、Workspace/Model/Channel指定を bindings を含むOpenClaw形式で保持する。 | UC-3 |
| REQ-0004 | 設定適用を実行したら、OpenClawが読み込める設定ファイルを生成する。 | UC-4 |
| REQ-0005 | Run開始を実行したら、gatewayを起動して稼働状態を判定する。 | UC-5 |
| REQ-0006 | 起動中に運用確認をしたら、ログ閲覧とDashboard導線を提供する。 | UC-5 |
| REQ-0007 | TCC実験を実行したら、Mode A/Bの比較記録を保存する。 | UC-6 |
| REQ-0008 | 画面を表示したら、OpenClawと連続性のあるUI方針で一貫表示する。 | UC-1, UC-2, UC-3, UC-5 |

### [ECLAW-0001] モデルを登録したら、Provider接続情報を含めて利用可能モデルとして保存する。
Given：利用者が Setup タブを開き、モデル追加フォーム（provider種別/base_url/model名/認証情報）を入力できる。  
When：利用者が必須項目を入力して保存する。  
Done：モデル一覧に新規モデルが追加され、後続のAgent作成で選択できる。

補足（OpenAI OAuth）:
- OpenClaw公式で OpenAI Codex OAuth（ChatGPT OAuth）利用が案内されている。
- 参照: `https://docs.openclaw.ai/providers/openai`
- 参照: `https://docs.openclaw.ai/concepts/oauth`
- OpenAI側のChatGPT連携案内: `https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan`
- モデル候補は OpenClaw `models list --all --json` を動的取得し、最大20件を表示する。OpenAI OAuth時は `gpt-5.2 / gpt-5.3-codex / gpt-5.3-codex-spark` を優先表示しつつ、他候補も表示対象に含める。

#### エラー分岐（REQ-0001の枝番）
| ERR-ID | 発生条件 | ユーザーアクション | 関連MSG-ID |
|---|---|---|---|
| ERR-ECLAW-0001 | 必須項目が不足している | 不足項目を入力して再保存する | MSG-ECLAW-0001 |
| ERR-ECLAW-0002 | base_urlの形式が不正 | URL形式を修正する | MSG-ECLAW-0002 |
| ERR-ECLAW-0003 | 疎通テストがタイムアウトした | 接続先の稼働を確認して再試行する | MSG-ECLAW-0003 |

### [ECLAW-0002] Channelを登録したら、利用可能な会話窓口として保存する。
Given：利用者が Setup タブを開き、Slack/Discord/Telegramのいずれかを選択できる。  
When：利用者がチャネル種別ごとの認証情報を入力して保存する。  
Done：Channel一覧に新規Channelが追加され、Agent割当に選択できる。

#### エラー分岐（REQ-0002の枝番）
| ERR-ID | 発生条件 | ユーザーアクション | 関連MSG-ID |
|---|---|---|---|
| ERR-ECLAW-0004 | token等の必須情報が不足 | 必須入力を補完する | MSG-ECLAW-0004 |
| ERR-ECLAW-0005 | 疎通テストで認証失敗 | 認証情報を再発行して再入力する | MSG-ECLAW-0005 |
| ERR-ECLAW-0006 | 疎通先に到達できない | ネットワーク疎通を確認して再試行する | MSG-ECLAW-0006 |

### [ECLAW-0003] Agentを作成したら、Workspace/Model/Channel指定を bindings を含むOpenClaw形式で保持する。
Given：モデルとChannelが1件以上登録されている。  
When：利用者がAgent名/Workspace/Model/Channelを入力して保存する。  
Done：Agent一覧に設定済みAgentが追加され、`agents.list` と `bindings` に反映される。

#### エラー分岐（REQ-0003の枝番）
| ERR-ID | 発生条件 | ユーザーアクション | 関連MSG-ID |
|---|---|---|---|
| ERR-ECLAW-0007 | 参照先Modelが存在しない | Modelを再選択する | MSG-ECLAW-0007 |
| ERR-ECLAW-0008 | 参照先Channelが存在しない | Channelを再選択する | MSG-ECLAW-0008 |
| ERR-ECLAW-0009 | 既存binding対象を別Agentへ再割当した | 上書き確認のうえ続行する | MSG-ECLAW-0009 |

## メンタルモデルと保存形式の変換ルール
| ユーザー操作（UI） | 内部変換 | OpenClaw保存先（`openclaw.json`） |
|---|---|---|
| モデルを追加する | model定義とprovider接続定義を分離して保持 | `agents.defaults.models[]` と `models.providers[]` |
| チャンネルを追加する | channel種別ごとの資格情報を正規化 | `channels.<type>...` |
| エージェントにチャンネルを紐づける | ルーティング条件へ変換（agent直結ではなくbinding） | `bindings[]` |
| エージェントにWorkspace/Modelを設定する | agent実行単位へ正規化 | `agents.list[]` |

上記変換後の出力は OpenClaw strict schema 準拠とし、未知キーを出力しない。

### [ECLAW-0004] 設定適用を実行したら、OpenClawが読み込める設定ファイルを生成する。
Given：Agent設定が1件以上あり、保存先が決定している。  
When：利用者が Apply を実行する。  
Done：`openclaw.json` 互換設定と `.env` が保存され、生成結果が画面で確認できる。

#### エラー分岐（REQ-0004の枝番）
| ERR-ID | 発生条件 | ユーザーアクション | 関連MSG-ID |
|---|---|---|---|
| ERR-ECLAW-0010 | 必須設定が欠落している | 欠落項目を補完して再実行する | MSG-ECLAW-0010 |
| ERR-ECLAW-0011 | ファイル書き込みに失敗した | 保存先権限または空き容量を確認する | MSG-ECLAW-0011 |
| ERR-ECLAW-0012 | 生成形式が検証で不整合となった | 直前変更を見直して再生成する | MSG-ECLAW-0012 |

### [ECLAW-0005] Run開始を実行したら、gatewayを起動して稼働状態を判定する。
Given：設定生成が完了し、RunタブでMode AまたはMode Bを選択できる。  
When：利用者が Start を実行する。  
Done：gatewayが起動し、ヘルスチェック結果が画面に表示される。

#### エラー分岐（REQ-0005の枝番）
| ERR-ID | 発生条件 | ユーザーアクション | 関連MSG-ID |
|---|---|---|---|
| ERR-ECLAW-0013 | 起動コマンドの実行に失敗 | 実行パスと実行権限を確認する | MSG-ECLAW-0013 |
| ERR-ECLAW-0014 | ヘルスチェックがタイムアウトした | ログ確認後に再起動する | MSG-ECLAW-0014 |
| ERR-ECLAW-0015 | 既に起動済みプロセスが存在した | Stopを実行してから再開する | MSG-ECLAW-0015 |

### [ECLAW-0006] 起動中に運用確認をしたら、ログ閲覧とDashboard導線を提供する。
Given：gatewayが起動済みである。  
When：利用者が Logs または Open Dashboard を操作する。  
Done：直近ログを閲覧でき、Dashboard URLへ遷移できる。

#### エラー分岐（REQ-0006の枝番）
| ERR-ID | 発生条件 | ユーザーアクション | 関連MSG-ID |
|---|---|---|---|
| ERR-ECLAW-0016 | ログストリーム取得に失敗した | 再接続を実行する | MSG-ECLAW-0016 |
| ERR-ECLAW-0017 | Dashboard URLが未確定 | ヘルス完了後に再実行する | MSG-ECLAW-0017 |

### [ECLAW-0007] TCC実験を実行したら、Mode A/Bの比較記録を保存する。
Given：macOS上でCase A（CLI）とCase B（Mode A）を実施できる。  
When：利用者が各ケースの結果と観測メモを保存する。  
Done：実行経路・結果・観測メモが同一形式で記録され比較できる。

#### エラー分岐（REQ-0007の枝番）
| ERR-ID | 発生条件 | ユーザーアクション | 関連MSG-ID |
|---|---|---|---|
| ERR-ECLAW-0018 | 実験ケース情報が不足している | Case IDと結果を補完する | MSG-ECLAW-0018 |
| ERR-ECLAW-0019 | 記録保存に失敗した | 保存先状態を確認して再保存する | MSG-ECLAW-0019 |

### [ECLAW-0008] 画面を表示したら、OpenClawと連続性のあるUI方針で一貫表示する。
Given：利用者が Setup/Run いずれかの画面を表示する。  
When：利用者がナビゲーション、フォーム、状態表示を確認する。  
Done：用語、情報配置、状態表示トーンがOpenClaw運用画面と一貫して認識できる。

補足（インストールタブの独立表示）:
- OpenClaw / Clawhub のバージョン表示は**行単位で独立**して扱う。
- 片方のインストール/更新中に、もう片方のバージョン表示を `確認中` や空表示へ戻さない。
- 各行は最新の確定値（未インストール/バージョン）を維持し、操作対象行のみ `更新中` 状態を表示する。

#### エラー分岐（REQ-0008の枝番）
| ERR-ID | 発生条件 | ユーザーアクション | 関連MSG-ID |
|---|---|---|---|
| ERR-ECLAW-0020 | UI定義と実装表示が不一致 | デザイン定義を再適用する | MSG-ECLAW-0020 |

## メッセージID管理（MSG-xxxx）
| ID | 文面テンプレ | 出力先 | 発生条件 | 関連REQ/ERR |
|---|---|---|---|---|
| MSG-ECLAW-0001 | モデル追加に必要な項目を入力してください。 | Setup/Model | ERR-ECLAW-0001 | REQ-0001 |
| MSG-ECLAW-0002 | provider base_url の形式が不正です。 | Setup/Model | ERR-ECLAW-0002 | REQ-0001 |
| MSG-ECLAW-0003 | モデル接続疎通がタイムアウトしました。 | Setup/Model | ERR-ECLAW-0003 | REQ-0001 |
| MSG-ECLAW-0004 | Channel必須情報を入力してください。 | Setup/Channel | ERR-ECLAW-0004 | REQ-0002 |
| MSG-ECLAW-0005 | 認証に失敗しました。トークンを確認してください。 | Setup/Channel | ERR-ECLAW-0005 | REQ-0002 |
| MSG-ECLAW-0006 | チャネル疎通に失敗しました。 | Setup/Channel | ERR-ECLAW-0006 | REQ-0002 |
| MSG-ECLAW-0007 | モデル定義が見つかりません。再選択してください。 | Setup/Agent | ERR-ECLAW-0007 | REQ-0003 |
| MSG-ECLAW-0008 | Channelが見つかりません。再選択してください。 | Setup/Agent | ERR-ECLAW-0008 | REQ-0003 |
| MSG-ECLAW-0009 | この保存で既存のbindingは更新されます。 | Setup/Agent | ERR-ECLAW-0009 | REQ-0003 |
| MSG-ECLAW-0010 | 設定が不足しています。入力を確認してください。 | Run/Apply | ERR-ECLAW-0010 | REQ-0004 |
| MSG-ECLAW-0011 | 設定ファイルの保存に失敗しました。 | Run/Apply | ERR-ECLAW-0011 | REQ-0004 |
| MSG-ECLAW-0012 | 設定形式の検証に失敗しました。 | Run/Apply | ERR-ECLAW-0012 | REQ-0004 |
| MSG-ECLAW-0013 | gateway起動に失敗しました。 | Run/Start | ERR-ECLAW-0013 | REQ-0005 |
| MSG-ECLAW-0014 | ヘルスチェックがタイムアウトしました。 | Run/Health | ERR-ECLAW-0014 | REQ-0005 |
| MSG-ECLAW-0015 | 既存gatewayが稼働中です。 | Run/Start | ERR-ECLAW-0015 | REQ-0005 |
| MSG-ECLAW-0016 | ログ取得に失敗しました。再接続してください。 | Run/Logs | ERR-ECLAW-0016 | REQ-0006 |
| MSG-ECLAW-0017 | Dashboard URLが未準備です。 | Run/Dashboard | ERR-ECLAW-0017 | REQ-0006 |
| MSG-ECLAW-0018 | 実験記録の必須項目が不足しています。 | Diagnostics | ERR-ECLAW-0018 | REQ-0007 |
| MSG-ECLAW-0019 | 実験記録を保存できませんでした。 | Diagnostics | ERR-ECLAW-0019 | REQ-0007 |
| MSG-ECLAW-0020 | UI定義と表示が一致していません。 | 全画面 | ERR-ECLAW-0020 | REQ-0008 |

## エラーID管理（ERR-xxxx）
| ID | 原因 | 検出条件 | ユーザーアクション | 再試行可否 | 関連MSG-ID | 関連REQ |
|---|---|---|---|---|---|---|
| ERR-ECLAW-0001 | モデル追加入力不足 | 保存時の必須項目検証で欠落 | 不足項目入力 | 可 | MSG-ECLAW-0001 | REQ-0001 |
| ERR-ECLAW-0002 | Provider URL形式不正 | base_url構文検証で失敗 | URL修正 | 可 | MSG-ECLAW-0002 | REQ-0001 |
| ERR-ECLAW-0003 | モデル接続先未応答 | 疎通テストが閾値時間超過 | 接続先確認 | 可 | MSG-ECLAW-0003 | REQ-0001 |
| ERR-ECLAW-0004 | Channel入力不足 | 保存時の必須項目検証で欠落 | 不足項目入力 | 可 | MSG-ECLAW-0004 | REQ-0002 |
| ERR-ECLAW-0005 | 認証情報不整合 | 疎通テストで認証エラー | 認証情報更新 | 可 | MSG-ECLAW-0005 | REQ-0002 |
| ERR-ECLAW-0006 | 接続先到達不可 | 疎通テストでネットワーク失敗 | 回線確認 | 可 | MSG-ECLAW-0006 | REQ-0002 |
| ERR-ECLAW-0007 | モデル参照切れ | 保存時にmodel_id未解決 | 再選択 | 可 | MSG-ECLAW-0007 | REQ-0003 |
| ERR-ECLAW-0008 | Channel参照切れ | 保存時にchannel_id未解決 | 再選択 | 可 | MSG-ECLAW-0008 | REQ-0003 |
| ERR-ECLAW-0009 | binding競合/上書き | 同一対象channelに既存bindingが存在 | 上書き確認 | 可 | MSG-ECLAW-0009 | REQ-0003 |
| ERR-ECLAW-0010 | 設定必須項目欠落 | Apply前バリデーションで不足 | 設定補完 | 可 | MSG-ECLAW-0010 | REQ-0004 |
| ERR-ECLAW-0011 | 書き込み失敗 | atomic write中のI/O失敗 | 権限/容量確認 | 可 | MSG-ECLAW-0011 | REQ-0004 |
| ERR-ECLAW-0012 | 生成内容不整合 | 生成後検証で必須キー不足 | 設定見直し | 可 | MSG-ECLAW-0012 | REQ-0004 |
| ERR-ECLAW-0013 | gateway起動失敗 | Start実行時に子プロセス生成不可 | 実行環境確認 | 可 | MSG-ECLAW-0013 | REQ-0005 |
| ERR-ECLAW-0014 | 起動遅延/停止 | ヘルス判定期限内にReady不達 | ログ確認し再起動 | 可 | MSG-ECLAW-0014 | REQ-0005 |
| ERR-ECLAW-0015 | 多重起動 | 起動済みpid検出 | Stop後に再Start | 可 | MSG-ECLAW-0015 | REQ-0005 |
| ERR-ECLAW-0016 | ログ読取失敗 | stdout/stderr購読断 | 再接続 | 可 | MSG-ECLAW-0016 | REQ-0006 |
| ERR-ECLAW-0017 | URL未確定 | 起動完了前にOpen要求 | 起動完了待機 | 可 | MSG-ECLAW-0017 | REQ-0006 |
| ERR-ECLAW-0018 | 記録情報不足 | 保存時にcase/result欠落 | 項目補完 | 可 | MSG-ECLAW-0018 | REQ-0007 |
| ERR-ECLAW-0019 | 実験記録保存失敗 | ファイル保存時I/O失敗 | 保存先確認 | 可 | MSG-ECLAW-0019 | REQ-0007 |
| ERR-ECLAW-0020 | UI差分逸脱 | デザイン検証で不一致 | デザイン再適用 | 可 | MSG-ECLAW-0020 | REQ-0008 |

## 実物検査に必要な環境要件
| 項目 | 必須/任意 | 内容 | 利用箇所 |
|---|---|---|---|
| OS | 必須 | macOS 14以降 | REQ-0005, REQ-0007 |
| Node.js / npm | 必須 | Node.js 22.12+ かつ npm グローバル導入が可能なバージョン | REQ-0008（配布確認） |
| Rust toolchain | 必須（開発時） | stable toolchain と cargo | REQ-0001〜REQ-0008 実装/検証 |
| OpenClaw gateway 実行体 | 必須 | ローカルで起動できること | REQ-0005, REQ-0006 |
| Model接続先実体 | 必須（いずれか1つ） | Ollama または LMStudio または OpenAI互換API | REQ-0001 |
| Channel実体 | 必須（いずれか1つ） | Slack / Discord / Telegram の本番相当接続先 | REQ-0002 |
| ブラウザ | 必須 | Dashboard URL を開ける既定ブラウザ | REQ-0006 |

## 実物検査で利用する環境変数
| キー | 必須/任意 | 利用箇所 | 説明 |
|---|---|---|---|
| OPENCLAW_GATEWAY_BIN | 必須 | Run開始（REQ-0005） | gateway実行ファイルパス |
| OPENCLAW_STATE_DIR | 推奨 | Run開始/health（REQ-0005） | OpenClaw state 保存先（例: `.openclaw-state`） |
| OPENCLAW_CONFIG_PATH | 推奨 | Run開始/health（REQ-0005）, OpenAI OAuthログイン（REQ-0001） | OpenClaw config パス（例: `.openclaw-state/openclaw.json`） |
| OPENCLAW_GATEWAY_TOKEN | 推奨 | Run開始/health（REQ-0005） | gateway auth token（token auth利用時） |
| OPENCLAW_DASHBOARD_URL | 任意 | Dashboard導線（REQ-0006） | Dashboard URL上書き |
| OLLAMA_BASE_URL | 任意（Ollama利用時） | Model接続疎通（REQ-0001） | 例: `http://localhost:11434` |
| LMSTUDIO_BASE_URL | 任意（LMStudio利用時） | Model接続疎通（REQ-0001） | 例: `http://localhost:1234` |
| OPENAI_API_KEY | 任意（OpenAI API Key利用時） | Model接続認証（REQ-0001） | OpenAI系APIキー（OAuth利用時は不要） |
| OPENAI_BASE_URL | 任意（OpenAI互換利用時） | Model接続（REQ-0001） | OpenAI互換base_url |
| SLACK_BOT_USER_OAUTH_TOKEN | 任意（Slack利用時） | Channel認証（REQ-0002） | Slack Bot User OAuth token |
| SLACK_APP_LEVEL_TOKEN | 任意（Slack Socket Mode利用時） | Channel接続（REQ-0002） | Slack App-level token |
| DISCORD_BOT_TOKEN | 任意（Discord利用時） | Channel認証（REQ-0002） | Discord Bot token |
| TELEGRAM_BOT_TOKEN | 任意（Telegram利用時） | Channel認証（REQ-0002） | Telegram Bot token |

## 実物検査の合格条件
| ID | 検査内容 | 合格条件 |
|---|---|---|
| IT-0001 | Model接続先への疎通 | 1つ以上の接続先で疎通成功を確認できる |
| IT-0002 | Channel実体への疎通 | 1つ以上のChannelで認証成功を確認できる |
| IT-0003 | gateway実プロセス起動 | Start後にhealth ready を確認できる |
| IT-0004 | Setup→Apply→Run通し | 設定生成からDashboard表示まで完走できる |
| IT-0005 | TCC比較（Case A/B） | A/B結果と観測メモを保存し比較できる |
| IT-0006 | グローバル配布起動 | `npm install -g` 後の `easyclaw` が追加コンパイルなしで起動できる |

## テスト実行コマンド（MVP）
| 種別 | コマンド | 目的 |
|---|---|---|
| UI回帰 | `cd app && npm run test:ui` | Setup/Run/Diagnostics の主要UI要素が維持されていることを確認 |
| ブランド比較E2E | `cd app && npm run test:brand-e2e` | OpenClaw公式サイトと EasyClaw の比較スナップショットを取得し、テーマトークン整合を検証 |
| GUI E2E | `cd app && npm run test:gui-e2e` | Setup/Run/Diagnostics のタブ遷移と主要操作UIを自動検証 |
| E2Eスモーク | `cd app && npm run test:e2e` | LMStudio/Slack/gateway を使った通し検証 |
| 配布実機確認 | `cd app && npm pack && npm install -g ./easy-openclaw-0.0.1.tgz && easyclaw --version && easyclaw --doctor` | npmグローバル導入後に同梱バイナリで起動可能なことを確認 |
| Rust単体/統合 | `cd app/src-tauri && cargo test` | ドメイン制約・設定生成・診断記録の回帰検証 |
