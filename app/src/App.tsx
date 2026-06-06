import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import crayfishIcon from "./assets/easy-openclaw-logo.png";
import "./App.css";

type ProviderType =
  | "open_ai"
  | "anthropic"
  | "google"
  | "open_router"
  | "together"
  | "groq"
  | "compatible"
  | "ollama"
  | "lm_studio";
type ChannelType = "slack" | "discord" | "telegram";
type RunMode = "a" | "b";
type GatewayMode = "local" | "remote";
type UiLang = "ja" | "en";
type OpenAiAuthMode = "api_key" | "oauth";
type OpenAiOauthLoginResult = {
  summary: string;
};

type MaintenanceCommandResult = {
  summary: string;
};

type MaintenanceCommand = "check_openclaw_update" | "check_clawhub_update";

type MaintenanceToolStatus = {
  installed: boolean;
  version?: string | null;
};

type MaintenanceStatusResult = {
  openclaw: MaintenanceToolStatus;
  clawhub: MaintenanceToolStatus;
};

function BusyIndicator({ label }: { label: string }) {
  return (
    <span className="busy-indicator" aria-live="polite">
      <span className="busy-spinner" aria-hidden="true" />
      <span>{label}</span>
      <span className="busy-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

type Model = {
  id: string;
  provider_type: ProviderType;
  base_url?: string | null;
  model_name: string;
  openai_auth_mode?: OpenAiAuthMode | null;
};

type Channel = {
  id: string;
  account_id: string;
  slack_channels?: string[];
  channel_type: ChannelType;
  owner_agent_id?: string | null;
};

type Agent = {
  id: string;
  display_name: string;
  model_id: string;
  model_override?: string | null;
  channel_id?: string | null;
  workspace_path?: string | null;
  security?: AgentSecuritySettings;
};

type AgentSecuritySettings = {
  exec_security: "deny" | "allowlist" | "full";
  exec_ask: "off" | "on-miss" | "always";
  exec_allowlist: string[];
  allow_workspace_outside_read: boolean;
  allow_workspace_outside_write: boolean;
  require_ask_for_destructive: boolean;
  protect_secret_files: boolean;
  allow_git_push: boolean;
  allow_system_write: boolean;
  browser_enabled: boolean;
  browser_allowed_domains: string[];
  browser_ask_before_navigation: boolean;
};

type WorkspaceSkillItem = {
  slug: string;
  path: string;
};

type ClawhubSkillItem = {
  slug: string;
  title: string;
  summary: string;
};

type BindingRule = {
  agent_id: string;
  channel_id: string;
};

type ChannelSecretValues = {
  slack_bot_token?: string | null;
  slack_app_token?: string | null;
  slack_signing_secret?: string | null;
  discord_bot_token?: string | null;
  telegram_bot_token?: string | null;
};

type RunStatus = {
  mode: RunMode;
  running: boolean;
  pid?: number;
  health: string;
  dashboard_url: string;
  port_in_use: boolean;
  can_start: boolean;
  can_stop: boolean;
  start_disabled_reason?: string | null;
  stop_disabled_reason?: string | null;
};

type Snapshot = {
  models: Model[];
  channels: Channel[];
  agents: Agent[];
  bindings: BindingRule[];
  gateway: GatewaySettings;
  execution_policy: ExecutionPolicySettings;
  execution_allowlist: string[];
  run_status: RunStatus;
};

type GatewaySettings = {
  mode: GatewayMode;
  port?: number | null;
  bind?: string | null;
  auth_mode?: string | null;
  auth_token?: string | null;
  remote_url?: string | null;
  remote_token?: string | null;
  tailscale_mode?: string | null;
};

type ExecutionPolicySettings = {
  host: "sandbox" | "gateway" | "node";
  security: "deny" | "allowlist" | "full";
  ask: "off" | "on-miss" | "always";
  node?: string | null;
};

type LogLine = {
  ts: string;
  level: string;
  message: string;
};

type ToastItem = {
  id: string;
  level: string;
  message: string;
};

type ExperimentRecord = {
  id: string;
  case_id: string;
  mode: RunMode;
  result: string;
  observed_error?: string;
  note?: string;
  recorded_at: string;
};

type CommandError = {
  code: string;
  message: string;
};

type ResolvedConfigPaths = {
  config_path: string;
  env_path: string;
  approvals_path: string;
};

type ValidationIssue = {
  section: string;
  message: string;
};

type MessageState = {
  message: string;
  nonce: number;
};

function parseCommandError(e: unknown): CommandError | null {
  if (typeof e === "object" && e !== null) {
    const v = e as Partial<CommandError>;
    if (typeof v.code === "string" && typeof v.message === "string") {
      return { code: v.code, message: v.message };
    }
  }
  if (typeof e === "string") {
    try {
      const parsed = JSON.parse(e) as Partial<CommandError>;
      if (typeof parsed.code === "string" && typeof parsed.message === "string") {
        return { code: parsed.code, message: parsed.message };
      }
    } catch {
      return null;
    }
  }
  return null;
}

const emptySnapshot: Snapshot = {
  models: [],
  channels: [],
  agents: [],
  bindings: [],
  gateway: {
    mode: "local",
    port: 18789,
    bind: "loopback",
    auth_mode: "token",
    auth_token: "",
    remote_url: "",
    remote_token: "",
    tailscale_mode: "off",
  },
  execution_policy: {
    host: "gateway",
    security: "allowlist",
    ask: "on-miss",
    node: null,
  },
  execution_allowlist: [
    "/opt/homebrew/bin/rg",
    "/usr/bin/rg",
    "/opt/homebrew/bin/git",
    "/usr/bin/git",
    "/bin/sh",
    "/bin/bash",
  ],
  run_status: {
    mode: "a",
    running: false,
    health: "stopped",
    dashboard_url: "http://127.0.0.1:18789",
    port_in_use: false,
    can_start: true,
    can_stop: false,
    start_disabled_reason: null,
    stop_disabled_reason: null,
  },
};

const providerDefaults: Record<ProviderType, string | null> = {
  open_ai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  open_router: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  groq: "https://api.groq.com/openai/v1",
  compatible: null,
  ollama: "http://localhost:11434/v1",
  lm_studio: "http://localhost:1234/v1",
};

const openAiApiDefaultModel = "gpt-5-mini";
const openAiOauthDefaultModel = "gpt-5.2";

function providerModelCandidatesFallback(
  provider: ProviderType,
  openAiAuthMode: OpenAiAuthMode,
): string[] {
  switch (provider) {
    case "open_ai":
      return openAiAuthMode === "oauth"
        ? ["gpt-5.2"]
        : ["gpt-5-mini", "gpt-5-nano", "gpt-5.2", "gpt-5"];
    case "anthropic":
      return [
        "claude-3-5-haiku-latest",
        "claude-sonnet-4-0",
        "claude-opus-4-1",
        "claude-sonnet-4-20250514",
        "claude-opus-4-1-20250805",
      ];
    case "google":
      return [
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-3-pro-preview",
        "gemini-2.5-flash-preview-09-2025",
      ];
    case "open_router":
      return [
        "openai/gpt-5-mini",
        "openai/gpt-5-nano",
        "anthropic/claude-sonnet-4",
        "moonshotai/kimi-k2.5",
      ];
    case "together":
      return [
        "openai/gpt-oss-20b",
        "openai/gpt-oss-120b",
        "moonshotai/Kimi-K2.5",
        "deepseek-ai/DeepSeek-V3.1",
      ];
    case "groq":
      return [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        "openai/gpt-oss-20b",
      ];
    case "compatible":
      return ["gpt-5-mini", "gpt-4.1-mini", "claude-3-5-haiku-20241022"];
    case "ollama":
      return ["llama3.1:8b"];
    case "lm_studio":
      return ["qwen2.5-coder-7b-instruct"];
    default:
      return [];
  }
}

const providerModelDefaults: Record<ProviderType, string> = {
  open_ai: openAiApiDefaultModel,
  anthropic: "claude-3-5-haiku-latest",
  google: "gemini-2.5-flash-lite",
  open_router: "openai/gpt-5-mini",
  together: "openai/gpt-oss-20b",
  groq: "meta-llama/llama-4-scout-17b-16e-instruct",
  compatible: "gpt-5-mini",
  ollama: "llama3.1:8b",
  lm_studio: "qwen2.5-coder-7b-instruct",
};

const providerOptions: { value: ProviderType; label: string }[] = [
  { value: "open_ai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "open_router", label: "OpenRouter" },
  { value: "together", label: "Together" },
  { value: "groq", label: "Groq" },
  { value: "lm_studio", label: "LMStudio" },
  { value: "ollama", label: "Ollama" },
  { value: "compatible", label: "OpenAI Compatible" },
];

const providerNeedsApiKey = (provider: ProviderType, openAiAuthMode: OpenAiAuthMode): boolean => {
  if (provider === "open_ai" && openAiAuthMode === "oauth") return false;
  return !["ollama", "lm_studio"].includes(provider);
};

const defaultAgentSecuritySettings: AgentSecuritySettings = {
  exec_security: "allowlist",
  exec_ask: "on-miss",
  exec_allowlist: [
    "/opt/homebrew/bin/rg",
    "/usr/bin/rg",
    "/opt/homebrew/bin/git",
    "/usr/bin/git",
    "/bin/sh",
    "/bin/bash",
  ],
  allow_workspace_outside_read: true,
  allow_workspace_outside_write: false,
  require_ask_for_destructive: true,
  protect_secret_files: true,
  allow_git_push: false,
  allow_system_write: false,
  browser_enabled: true,
  browser_allowed_domains: [],
  browser_ask_before_navigation: true,
};

function App() {
  const [activeTab, setActiveTab] = useState<"setup" | "run" | "diagnostics" | "maintenance">("setup");
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [noticeState, setNoticeState] = useState<MessageState>({ message: "", nonce: 0 });
  const [errorState, setErrorState] = useState<MessageState>({ message: "", nonce: 0 });
  const notice = noticeState.message;
  const error = errorState.message;
  const setNotice = (message: string) => setNoticeState({ message, nonce: Date.now() + Math.random() });
  const setError = (message: string) => setErrorState({ message, nonce: Date.now() + Math.random() });

  const [providerType, setProviderType] = useState<ProviderType>("open_ai");
  const [openAiAuthMode, setOpenAiAuthMode] = useState<OpenAiAuthMode>("api_key");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerModel, setProviderModel] = useState(openAiApiDefaultModel);
  const [providerApiKey, setProviderApiKey] = useState("");
  const [showProviderApiKey, setShowProviderApiKey] = useState(false);
  const [showModelForm, setShowModelForm] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const isModelEditing = showModelForm && editingModelId !== null;

  const [channelType, setChannelType] = useState<ChannelType>("slack");
  const [channelAccountId, setChannelAccountId] = useState("");
  const [channelSlackBotToken, setChannelSlackBotToken] = useState("");
  const [channelSlackAppToken, setChannelSlackAppToken] = useState("");
  const [showChannelSlackBotToken, setShowChannelSlackBotToken] = useState(false);
  const [showChannelSlackAppToken, setShowChannelSlackAppToken] = useState(false);
  const [channelSlackChannels, setChannelSlackChannels] = useState("");
  const [channelDiscordBotToken, setChannelDiscordBotToken] = useState("");
  const [channelTelegramBotToken, setChannelTelegramBotToken] = useState("");
  const [showChannelDiscordBotToken, setShowChannelDiscordBotToken] = useState(false);
  const [showChannelTelegramBotToken, setShowChannelTelegramBotToken] = useState(false);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const isChannelEditing = showChannelForm && editingChannelId !== null;

  const [agentId, setAgentId] = useState("");
  const [agentModelId, setAgentModelId] = useState("");
  const [agentChannelId, setAgentChannelId] = useState("");
  const [agentWorkspacePath, setAgentWorkspacePath] = useState(".");
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const isAgentEditing = showAgentForm && editingAgentId !== null;
  const [agentExecSecurity, setAgentExecSecurity] = useState<AgentSecuritySettings["exec_security"]>(
    defaultAgentSecuritySettings.exec_security,
  );
  const [agentExecAsk, setAgentExecAsk] = useState<AgentSecuritySettings["exec_ask"]>(
    defaultAgentSecuritySettings.exec_ask,
  );
  const [agentExecAllowlist, setAgentExecAllowlist] = useState(
    defaultAgentSecuritySettings.exec_allowlist.join("\n"),
  );
  const [agentAllowWorkspaceOutsideRead, setAgentAllowWorkspaceOutsideRead] = useState(
    defaultAgentSecuritySettings.allow_workspace_outside_read,
  );
  const [agentAllowWorkspaceOutsideWrite, setAgentAllowWorkspaceOutsideWrite] = useState(
    defaultAgentSecuritySettings.allow_workspace_outside_write,
  );
  const [agentRequireAskForDestructive, setAgentRequireAskForDestructive] = useState(
    defaultAgentSecuritySettings.require_ask_for_destructive,
  );
  const [agentProtectSecretFiles, setAgentProtectSecretFiles] = useState(
    defaultAgentSecuritySettings.protect_secret_files,
  );
  const [agentAllowGitPush, setAgentAllowGitPush] = useState(
    defaultAgentSecuritySettings.allow_git_push,
  );
  const [agentAllowSystemWrite, setAgentAllowSystemWrite] = useState(
    defaultAgentSecuritySettings.allow_system_write,
  );
  const [agentBrowserEnabled, setAgentBrowserEnabled] = useState(
    defaultAgentSecuritySettings.browser_enabled,
  );
  const [agentBrowserAllowedDomains, setAgentBrowserAllowedDomains] = useState(
    defaultAgentSecuritySettings.browser_allowed_domains.join("\n"),
  );
  const [agentBrowserAskBeforeNavigation, setAgentBrowserAskBeforeNavigation] = useState(
    defaultAgentSecuritySettings.browser_ask_before_navigation,
  );
  const [agentWorkspaceSkills, setAgentWorkspaceSkills] = useState<WorkspaceSkillItem[]>([]);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [skillSearchResults, setSkillSearchResults] = useState<ClawhubSkillItem[]>([]);
  const [skillSearchLoading, setSkillSearchLoading] = useState(false);
  const [installingSkillSlug, setInstallingSkillSlug] = useState("");
  const [showSkillSearchPanel, setShowSkillSearchPanel] = useState(false);

  const [runMode, setRunMode] = useState<RunMode>("a");
  const [runStopping, setRunStopping] = useState(false);
  const [configAppliedAt, setConfigAppliedAt] = useState<string | null>(null);
  const [gatewayDetailsOpen, setGatewayDetailsOpen] = useState(false);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [resolvedConfigPath, setResolvedConfigPath] = useState("");
  const [resolvedEnvPath, setResolvedEnvPath] = useState("");
  const [resolvedApprovalsPath, setResolvedApprovalsPath] = useState("");
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [gatewayInitialized, setGatewayInitialized] = useState(false);
  const [gatewayMode, setGatewayMode] = useState<GatewayMode>("local");
  const [gatewayPort, setGatewayPort] = useState("18789");
  const [gatewayBind, setGatewayBind] = useState("loopback");
  const [gatewayAuthMode, setGatewayAuthMode] = useState("token");
  const [gatewayAuthToken, setGatewayAuthToken] = useState("");
  const [gatewayRemoteUrl, setGatewayRemoteUrl] = useState("");
  const [gatewayRemoteToken, setGatewayRemoteToken] = useState("");
  const [showGatewayAuthToken, setShowGatewayAuthToken] = useState(false);
  const [showGatewayRemoteToken, setShowGatewayRemoteToken] = useState(false);
  const [gatewayTailscaleMode, setGatewayTailscaleMode] = useState("off");

  const [experimentCaseId, setExperimentCaseId] = useState("case-a");
  const [experimentMode, setExperimentMode] = useState<RunMode>("a");
  const [experimentResult, setExperimentResult] = useState("success");
  const [experimentNote, setExperimentNote] = useState("");
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceBusyCommand, setMaintenanceBusyCommand] = useState<MaintenanceCommand | "">("");
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatusResult | null>(null);
  const [maintenanceStatusLoading, setMaintenanceStatusLoading] = useState(false);
  const [providerModelCandidatesDynamic, setProviderModelCandidatesDynamic] = useState<string[]>([]);
  const [providerModelCandidatesLoading, setProviderModelCandidatesLoading] = useState(false);
  const snapshotRef = useRef(snapshot);
  const closeConfirmedRef = useRef(false);

  const modelOptions = useMemo(() => snapshot.models, [snapshot.models]);
  const channelOptions = useMemo(() => snapshot.channels, [snapshot.channels]);
  const providerBaseUrlPlaceholder = providerDefaults[providerType] ?? "";
  const providerModelPlaceholder = providerModelDefaults[providerType];
  const fallbackModelCandidates = useMemo(
    () => providerModelCandidatesFallback(providerType, openAiAuthMode),
    [providerType, openAiAuthMode],
  );
  const modelCandidates = useMemo(
    () =>
      providerModelCandidatesDynamic.length > 0
        ? providerModelCandidatesDynamic
        : fallbackModelCandidates,
    [providerModelCandidatesDynamic, fallbackModelCandidates],
  );
  const useModelDropdown = !["lm_studio", "ollama"].includes(providerType);
  const selectedModelOption = modelCandidates.includes(providerModel) ? providerModel : "__custom__";
  const initialUiLang = useMemo<UiLang>(() => {
    const locale =
      (typeof navigator !== "undefined" && navigator.language) ||
      Intl.DateTimeFormat().resolvedOptions().locale ||
      "en";
    return locale.toLowerCase().startsWith("ja") ? "ja" : "en";
  }, []);
  const [uiLang, setUiLang] = useState<UiLang>(initialUiLang);
  const t = (ja: string, en: string) => (uiLang === "ja" ? ja : en);

  function providerTypeHelp(type: ProviderType): string {
    switch (type) {
      case "open_ai":
        return t("OpenAI公式のAPIまたはChatGPT/Codex OAuthを使います。", "Uses the official OpenAI API or ChatGPT/Codex OAuth.");
      case "anthropic":
        return t("Anthropic Claude APIへ接続します。API Keyが必要です。", "Connects to Anthropic Claude. Requires an API key.");
      case "google":
        return t("Google Gemini APIへ接続します。API Keyが必要です。", "Connects to Google Gemini. Requires an API key.");
      case "open_router":
        return t("OpenRouter経由で複数Providerのモデルを使います。", "Uses models from multiple providers through OpenRouter.");
      case "together":
        return t("Together AIのホスト済みモデルへ接続します。", "Connects to hosted models on Together AI.");
      case "groq":
        return t("Groqの高速推論APIへ接続します。", "Connects to Groq's fast inference API.");
      case "lm_studio":
        return t("このPCで起動したLM Studioのローカルサーバーへ接続します。", "Connects to a local LM Studio server running on this PC.");
      case "ollama":
        return t("このPCで起動したOllamaへ接続します。", "Connects to Ollama running on this PC.");
      case "compatible":
        return t("OpenAI互換APIを持つ任意のサーバーへ接続します。Base URLを指定してください。", "Connects to any OpenAI-compatible API server. Set its Base URL.");
    }
  }

  function openAiAuthModeHelp(mode: OpenAiAuthMode): string {
    return mode === "oauth"
      ? t("ChatGPTプランのOAuth認証を使います。保存時にOpenClawの認証セットアップを起動します。", "Uses ChatGPT plan OAuth. Saving starts OpenClaw auth setup.")
      : t("OpenAI API Keyを使います。通常のAPI課金/利用枠で動かす場合はこちらです。", "Uses an OpenAI API key. Choose this for normal API billing and quotas.");
  }

  function channelTypeHelp(type: ChannelType): string {
    switch (type) {
      case "slack":
        return t("SlackのチャンネルやDMからAgentへメッセージを渡します。", "Routes Slack channel or DM messages to an agent.");
      case "discord":
        return t("Discord Bot経由でAgentへメッセージを渡します。", "Routes messages to an agent through a Discord bot.");
      case "telegram":
        return t("Telegram Bot経由でAgentへメッセージを渡します。", "Routes messages to an agent through a Telegram bot.");
    }
  }

  function gatewayModeHelp(mode: GatewayMode): string {
    return mode === "remote"
      ? t("別サーバーで起動しているgatewayへ接続します。初回は通常不要です。", "Connects to a gateway running on another server. Usually unnecessary for first setup.")
      : t("この端末でgatewayを起動します。通常はこちらのままで進めます。", "Starts the gateway on this device. Keep this for the normal setup.");
  }

  function gatewayBindHelp(bind: string): string {
    switch (bind) {
      case "loopback":
        return t("このPC内からだけ接続できます。最も安全な標準設定です。", "Only this PC can connect. This is the safest default.");
      case "lan":
        return t("同じLAN内の端末から接続できます。必要な場合だけ使います。", "Devices on the same LAN can connect. Use only when needed.");
      case "tailnet":
        return t("Tailscaleのネットワーク内から接続できます。Tailnet運用向けです。", "Devices in your Tailscale network can connect. For Tailnet setups.");
      case "auto":
        return t("OpenClawに接続先の選択を任せます。迷う場合はloopbackを使います。", "Lets OpenClaw choose the bind target. Use loopback if unsure.");
      case "custom":
        return t("手動指定用です。ネットワーク設定を理解している場合だけ使います。", "For manual network configuration. Use only if you understand the network setup.");
      default:
        return "";
    }
  }

  function gatewayAuthModeHelp(mode: string): string {
    return mode === "password"
      ? t("Dashboard等のアクセスにパスワード形式の認証値を使います。", "Uses a password-style secret for Dashboard and gateway access.")
      : t("Dashboard等のアクセスにトークン形式の認証値を使います。空欄ならApply時に自動生成します。", "Uses a token-style secret for Dashboard and gateway access. Leave empty to auto-generate it on Apply.");
  }

  function tailscaleModeHelp(mode: string): string {
    switch (mode) {
      case "serve":
        return t("Tailscale ServeでTailnet内へ公開します。", "Publishes inside your Tailnet with Tailscale Serve.");
      case "funnel":
        return t("Tailscale Funnelで外部公開します。公開範囲に注意してください。", "Publishes externally with Tailscale Funnel. Be careful with exposure.");
      default:
        return t("Tailscale公開を使いません。通常はこちらです。", "Does not use Tailscale publishing. This is the normal setting.");
    }
  }

  function runModeHelp(mode: RunMode): string {
    return mode === "b"
      ? t("すでに別の方法でgatewayを起動している場合に、その状態を確認します。", "Use this when the gateway was already started another way.")
      : t("easy-openclawがgatewayを起動・停止します。通常はこちらです。", "easy-openclaw starts and stops the gateway. This is the normal mode.");
  }

  function markConfigDirty() {
    setConfigAppliedAt(null);
  }

  function setupNextAction(): string {
    if (snapshot.models.length === 0) {
      return t("まず Model Provider を1つ追加してください。", "Add one Model Provider first.");
    }
    if (snapshot.agents.length === 0) {
      return t("次は Agent を追加し、使うModelとWorkspaceを選びます。", "Next, add an Agent and choose its model and workspace.");
    }
    if (!configAppliedAt) {
      return t("次は Apply Config でOpenClaw設定を書き出します。", "Next, use Apply Config to write the OpenClaw files.");
    }
    if (snapshot.run_status.health !== "ready") {
      return t("次は Run で Start し、GatewayとDashboardを確認します。", "Next, open Run and press Start to check the Gateway and Dashboard.");
    }
    return t("Gatewayはreadyです。Dashboardで動作確認できます。", "Gateway is ready. You can verify from the Dashboard.");
  }

  function statusLabel(done: boolean, next = false): string {
    if (done) return t("完了", "Done");
    if (next) return t("次", "Next");
    return t("未完了", "Pending");
  }

  function statusClass(done: boolean, next = false): string {
    if (done) return "done";
    if (next) return "next";
    return "pending";
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("easy-openclaw_ui_lang");
    if (saved === "ja" || saved === "en") {
      setUiLang(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("easy-openclaw_ui_lang", uiLang);
  }, [uiLang]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      if (closeConfirmedRef.current) return;
      const current = snapshotRef.current;
      const appManagedGatewayMayBeRunning =
        current.run_status.pid !== undefined ||
        current.run_status.health === "ready" ||
        current.run_status.health === "starting";
      if (!appManagedGatewayMayBeRunning) return;

      event.preventDefault();
      setExitConfirmVisible(true);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [uiLang]);

  async function closeAppAfterDecision(stopOpenClaw: boolean) {
    setExitBusy(true);
    setError("");
    let stopFailed = false;
    if (stopOpenClaw) {
      try {
        await Promise.race([
          invoke("stop_gateway_for_exit"),
          new Promise((resolve) => window.setTimeout(resolve, 8000)),
        ]);
      } catch {
        stopFailed = true;
      }
    }
    try {
      closeConfirmedRef.current = true;
      await invoke("exit_app");
    } catch (e) {
      try {
        await getCurrentWindow().destroy();
      } catch {
        closeConfirmedRef.current = false;
        setExitBusy(false);
        handleCommandError(e);
        await message(
          stopFailed
            ? t(
                "OpenClawの停止でエラーが出たうえ、easy-openclawの終了にも失敗しました。Runタブまたはターミナルから停止状態を確認してください。",
                "OpenClaw stop reported an error, and easy-openclaw also failed to close. Check the Run tab or terminal for the process state.",
              )
            : t(
                "easy-openclawの終了に失敗しました。もう一度閉じる操作を試してください。",
                "Failed to close easy-openclaw. Try closing it again.",
              ),
          { title: "easy-openclaw", kind: "warning" },
        );
      }
    }
  }

  function cancelExitConfirm() {
    if (exitBusy) return;
    setExitConfirmVisible(false);
  }

  useEffect(() => {
    if (activeTab !== "maintenance") return;
    (async () => {
      setMaintenanceStatusLoading(true);
      try {
        const status = await invoke<MaintenanceStatusResult>("get_maintenance_status");
        setMaintenanceStatus(status);
      } catch {
        setMaintenanceStatus(null);
      } finally {
        setMaintenanceStatusLoading(false);
      }
    })();
  }, [activeTab]);

  function nextChannelAccountId(type: ChannelType): string {
    const label = type === "slack" ? "slack" : type === "discord" ? "discord" : "telegram";
    const prefix = `${label}-`;
    let max = 0;
    for (const channel of snapshot.channels) {
      if (channel.channel_type !== type) continue;
      const normalized = channel.account_id.toLowerCase();
      if (!normalized.startsWith(prefix)) continue;
      const seq = Number.parseInt(normalized.slice(prefix.length), 10);
      if (Number.isFinite(seq)) max = Math.max(max, seq);
    }
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
  }

  function resetAgentSecurityDefaults() {
    setAgentExecSecurity(defaultAgentSecuritySettings.exec_security);
    setAgentExecAsk(defaultAgentSecuritySettings.exec_ask);
    setAgentExecAllowlist(defaultAgentSecuritySettings.exec_allowlist.join("\n"));
    setAgentAllowWorkspaceOutsideRead(defaultAgentSecuritySettings.allow_workspace_outside_read);
    setAgentAllowWorkspaceOutsideWrite(defaultAgentSecuritySettings.allow_workspace_outside_write);
    setAgentRequireAskForDestructive(defaultAgentSecuritySettings.require_ask_for_destructive);
    setAgentProtectSecretFiles(defaultAgentSecuritySettings.protect_secret_files);
    setAgentAllowGitPush(defaultAgentSecuritySettings.allow_git_push);
    setAgentAllowSystemWrite(defaultAgentSecuritySettings.allow_system_write);
    setAgentBrowserEnabled(defaultAgentSecuritySettings.browser_enabled);
    setAgentBrowserAllowedDomains(defaultAgentSecuritySettings.browser_allowed_domains.join("\n"));
    setAgentBrowserAskBeforeNavigation(defaultAgentSecuritySettings.browser_ask_before_navigation);
  }

  async function refresh() {
    const snap = await invoke<Snapshot>("get_snapshot");
    setSnapshot(snap);
    setRunMode(snap.run_status.mode);
    return snap;
  }

  async function refreshLogs() {
    const value = await invoke<LogLine[]>("get_logs");
    setLogs(value);
  }

  function isGatewayStartedLog(line: LogLine): boolean {
    return line.message.toLowerCase().includes("gateway started");
  }

  function countGatewayStartedLogs(value: LogLine[]): number {
    return value.filter(isGatewayStartedLog).length;
  }

  async function waitForGatewayStartedLog(previousCount: number, timeoutMs = 10000): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = await invoke<LogLine[]>("get_logs");
      setLogs(value);
      const startedCount = countGatewayStartedLogs(value);
      if (startedCount > previousCount || startedCount > 0) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    return false;
  }

  function toastLevelClass(level: string): string {
    const normalized = level.toLowerCase();
    if (normalized.includes("error") || normalized.includes("stderr")) return "error";
    if (normalized.includes("warn")) return "warn";
    return "info";
  }

  function logLevelClass(level: string): string {
    const normalized = level.toLowerCase();
    if (normalized.includes("error") || normalized.includes("stderr")) return "error";
    if (normalized.includes("warn")) return "warn";
    if (normalized.includes("stdout")) return "stdout";
    return "info";
  }

  function pushToast(level: string, message: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, level, message }].slice(-4));
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 7000);
  }

  async function refreshExperiments() {
    const value = await invoke<ExperimentRecord[]>("list_experiments");
    setExperiments(value);
  }

  async function refreshResolvedPaths() {
    const value = await invoke<ResolvedConfigPaths>("get_resolved_config_paths");
    setResolvedConfigPath(value.config_path);
    setResolvedEnvPath(value.env_path);
    setResolvedApprovalsPath(value.approvals_path);
  }

  function handleCommandError(e: unknown) {
    const parsed = parseCommandError(e);
    if (parsed) {
      setError(`${parsed.code}: ${parsed.message}`);
      return;
    }
    setError(String(e));
  }

  async function showDeleteErrorDialog(e: unknown) {
    const parsed = parseCommandError(e);
    if (parsed) {
      await message(`${parsed.code}: ${parsed.message}`, {
        title: t("削除エラー", "Delete Error"),
        kind: "error",
      });
    } else {
      await message(String(e), {
        title: t("削除エラー", "Delete Error"),
        kind: "error",
      });
    }
  }

  useEffect(() => {
    refresh()
      .catch(handleCommandError)
      .finally(() => setSnapshotLoaded(true));
    refreshLogs().catch(handleCommandError);
    refreshExperiments().catch(handleCommandError);
    refreshResolvedPaths().catch(handleCommandError);
    const t = setInterval(() => {
      refreshLogs().catch(() => undefined);
      refresh().catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!agentModelId && modelOptions.length > 0) {
      setAgentModelId(modelOptions[0].id);
    }
    if (!gatewayInitialized && snapshotLoaded) {
      setGatewayMode(snapshot.gateway.mode ?? "local");
      setGatewayPort(String(snapshot.gateway.port ?? 18789));
      setGatewayBind(snapshot.gateway.bind ?? "loopback");
      setGatewayAuthMode(snapshot.gateway.auth_mode ?? "token");
      setGatewayAuthToken(snapshot.gateway.auth_token ?? "");
      setGatewayRemoteUrl(snapshot.gateway.remote_url ?? "");
      setGatewayRemoteToken(snapshot.gateway.remote_token ?? "");
      setGatewayTailscaleMode(snapshot.gateway.tailscale_mode ?? "off");
      setGatewayInitialized(true);
    }
  }, [snapshot, modelOptions, agentModelId, gatewayInitialized, snapshotLoaded]);

  useEffect(() => {
    if (!notice.trim()) return;
    pushToast("notice", notice);
  }, [noticeState]);

  useEffect(() => {
    if (!error.trim()) return;
    pushToast("error", error);
  }, [errorState]);

  async function onCreateProvider(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      const normalizedBaseUrl =
        !providerBaseUrl.trim() || providerBaseUrl.trim() === providerBaseUrlPlaceholder
          ? null
          : providerBaseUrl.trim();
      const input = {
        provider_type: providerType,
        base_url: normalizedBaseUrl,
        model_name: providerModel,
        openai_auth_mode: providerType === "open_ai" ? openAiAuthMode : null,
        api_key: providerApiKey || null,
      };
      const shouldRunOauthAutoSetup =
        !editingModelId && providerType === "open_ai" && openAiAuthMode === "oauth";
      if (editingModelId) {
        await invoke("update_model", { input: { id: editingModelId, ...input } });
      } else {
        await invoke("create_model", { input });
      }
      if (shouldRunOauthAutoSetup) {
        await invoke<OpenAiOauthLoginResult>("run_openai_oauth_onboard_auto");
      }
      await refresh();
      markConfigDirty();
      setNotice(
        editingModelId
          ? t("モデルを更新しました。", "Model updated.")
          : shouldRunOauthAutoSetup
            ? t(
                "モデルを追加し、OAuth自動セットアップを開始しました。",
                "Model added and OAuth auto setup started.",
              )
            : t("モデルを追加しました。", "Model added."),
      );
      setShowModelForm(false);
      setEditingModelId(null);
      setProviderApiKey("");
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onProbeProvider(id: string) {
    setError("");
    setNotice("");
    try {
      await invoke("probe_model", { modelId: id });
      setNotice(t("Model疎通に成功しました。", "Model connectivity check succeeded."));
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onDeleteModel(id: string) {
    setError("");
    setNotice("");
    try {
      await invoke("delete_model", { modelId: id });
      await refresh();
      markConfigDirty();
      setNotice(t("モデルを削除しました。", "Model deleted."));
      if (editingModelId === id) {
        setEditingModelId(null);
        setShowModelForm(false);
      }
    } catch (e) {
      handleCommandError(e);
      await showDeleteErrorDialog(e);
    }
  }

  function onEditModel(id: string) {
    const model = modelOptions.find((m) => m.id === id);
    if (!model) return;
    setEditingModelId(model.id);
    setProviderType(model.provider_type);
    setOpenAiAuthMode(model.openai_auth_mode ?? "api_key");
    setProviderBaseUrl(model.base_url ?? "");
    setProviderModel(model.model_name);
    setProviderApiKey("");
    setShowModelForm(true);
    setError("");
    setNotice(t("Model編集モードです。必要ならAPI Keyを再入力してください。", "Editing model. Re-enter API key if needed."));
  }

  function onOpenCreateModel() {
    setEditingModelId(null);
    setProviderType("open_ai");
    setOpenAiAuthMode("api_key");
    setProviderBaseUrl("");
    setProviderModel(openAiApiDefaultModel);
    setProviderApiKey("");
    setShowModelForm(true);
    setError("");
    setNotice("");
  }

  function selectProviderType(next: ProviderType) {
    setProviderModelCandidatesDynamic([]);
    setProviderType(next);
    const nextOpenAiAuthMode = next === "open_ai" ? openAiAuthMode : "api_key";
    const nextDefault =
      next === "open_ai"
        ? (nextOpenAiAuthMode === "oauth" ? openAiOauthDefaultModel : openAiApiDefaultModel)
        : providerModelDefaults[next];
    setProviderModel(nextDefault);
    if (next !== "open_ai") setOpenAiAuthMode("api_key");
    if (!providerNeedsApiKey(next, nextOpenAiAuthMode)) setProviderApiKey("");
  }

  async function refreshProviderModelCandidates() {
    if (!useModelDropdown || providerModelCandidatesLoading) return;
    setProviderModelCandidatesLoading(true);
    setError("");
    try {
      const dynamic = await invoke<string[]>("list_provider_model_candidates", {
        providerType,
        openAiAuthMode: providerType === "open_ai" ? openAiAuthMode : null,
      });
      const normalized = Array.from(new Set((dynamic ?? []).filter((v) => !!v?.trim())));
      setProviderModelCandidatesDynamic(normalized);
      setNotice(
        normalized.length > 0
          ? t("Model候補を更新しました。", "Model candidates refreshed.")
          : t("取得できるModel候補がありません。固定候補を使います。", "No model candidates were found. Using fallback candidates."),
      );
    } catch (e) {
      setProviderModelCandidatesDynamic([]);
      handleCommandError(e);
    } finally {
      setProviderModelCandidatesLoading(false);
    }
  }

  function onCloseModelModal() {
    setShowModelForm(false);
    setEditingModelId(null);
    setOpenAiAuthMode("api_key");
    setProviderApiKey("");
    setShowProviderApiKey(false);
  }

  function resetChannelForm(type: ChannelType) {
    setChannelType(type);
    setChannelAccountId(nextChannelAccountId(type));
    setChannelSlackBotToken("");
    setChannelSlackAppToken("");
    setShowChannelSlackBotToken(false);
    setShowChannelSlackAppToken(false);
    setChannelSlackChannels("");
    setChannelDiscordBotToken("");
    setChannelTelegramBotToken("");
    setShowChannelDiscordBotToken(false);
    setShowChannelTelegramBotToken(false);
  }

  function onOpenCreateChannel() {
    setEditingChannelId(null);
    resetChannelForm("slack");
    setShowChannelForm(true);
    setError("");
    setNotice("");
  }

  async function onEditChannel(id: string) {
    const channel = snapshot.channels.find((c) => c.id === id);
    if (!channel) return;
    let secrets: ChannelSecretValues = {};
    try {
      secrets = await invoke<ChannelSecretValues>("get_channel_secret_values", { channelId: id });
    } catch {
      secrets = {};
    }
    setEditingChannelId(channel.id);
    setChannelType(channel.channel_type);
    setChannelAccountId((channel.account_id || nextChannelAccountId(channel.channel_type)).toLowerCase());
    setChannelSlackBotToken(secrets.slack_bot_token ?? "");
    setChannelSlackAppToken(secrets.slack_app_token ?? "");
    setShowChannelSlackBotToken(false);
    setShowChannelSlackAppToken(false);
    setChannelSlackChannels((channel.slack_channels ?? []).join(", "));
    setChannelDiscordBotToken(secrets.discord_bot_token ?? "");
    setChannelTelegramBotToken(secrets.telegram_bot_token ?? "");
    setShowChannelDiscordBotToken(false);
    setShowChannelTelegramBotToken(false);
    setShowChannelForm(true);
    setError("");
    setNotice(t("Channel編集モードです。保存済みトークンを読み込みました。", "Editing channel. Loaded saved tokens."));
  }

  function onCloseChannelModal() {
    setShowChannelForm(false);
    setEditingChannelId(null);
  }

  async function onCreateChannel(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      const slackChannels = channelSlackChannels
        .split(/[\n,]/)
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      const input = {
        channel_type: channelType,
        account_id: channelAccountId.trim().toLowerCase() || null,
        slack_channels: slackChannels,
        display_name: null,
        slack_bot_token: channelSlackBotToken || null,
        slack_app_token: channelSlackAppToken || null,
        slack_signing_secret: null,
        discord_bot_token: channelDiscordBotToken || null,
        telegram_bot_token: channelTelegramBotToken || null,
      };
      if (editingChannelId) {
        await invoke("update_channel", { input: { id: editingChannelId, ...input } });
      } else {
        await invoke("create_channel", { input });
      }
      await refresh();
      markConfigDirty();
      setNotice(editingChannelId ? t("Channelを更新しました。", "Channel updated.") : t("Channelを保存しました。", "Channel saved."));
      setShowChannelForm(false);
      setEditingChannelId(null);
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onProbeChannel(id: string) {
    setError("");
    setNotice("");
    try {
      await invoke("probe_channel", { channelId: id });
      setNotice(t("Channel疎通に成功しました。", "Channel connectivity check succeeded."));
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onDeleteChannel(id: string) {
    setError("");
    setNotice("");
    try {
      await invoke("delete_channel", { channelId: id });
      await refresh();
      markConfigDirty();
      setNotice(t("Channelを削除しました。", "Channel deleted."));
      if (editingChannelId === id) {
        setEditingChannelId(null);
        setShowChannelForm(false);
      }
    } catch (e) {
      handleCommandError(e);
      await showDeleteErrorDialog(e);
    }
  }

  async function refreshAgentWorkspaceSkills(workspace: string) {
    try {
      const items = await invoke<WorkspaceSkillItem[]>("list_workspace_skills", {
        input: { workspace_path: workspace },
      });
      setAgentWorkspaceSkills(items);
    } catch (e) {
      handleCommandError(e);
    }
  }

  function showClawhubInstallHintIfNeeded(e: unknown): boolean {
    const parsed = parseCommandError(e);
    if (parsed?.code === "ERR-ECLAW-0100") {
      setError(parsed.message);
      setNotice(t("clawhub が必要です。easy-openclaw を再インストールしてから再度検索してください。", "clawhub is required. Reinstall easy-openclaw and retry."));
      return true;
    }
    return false;
  }

  async function onSearchSkills() {
    setError("");
    setNotice("");
    if (!skillSearchQuery.trim()) {
      setSkillSearchResults([]);
      return;
    }
    setSkillSearchLoading(true);
    try {
      const results = await invoke<ClawhubSkillItem[]>("search_clawhub_skills", {
        input: { query: skillSearchQuery.trim(), limit: 20 },
      });
      setSkillSearchResults(results);
      if (results.length === 0) {
        setNotice(t("検索結果は0件でした。別キーワードで再試行してください。", "No results found. Try another keyword."));
      }
    } catch (e) {
      if (showClawhubInstallHintIfNeeded(e)) return;
      handleCommandError(e);
    } finally {
      setSkillSearchLoading(false);
    }
  }

  async function onInstallSkill(slug: string) {
    setError("");
    setNotice("");
    if (!slug.trim()) return;
    setInstallingSkillSlug(slug);
    try {
      const skills = await invoke<WorkspaceSkillItem[]>("install_workspace_skill", {
        input: {
          workspace_path: agentWorkspacePath,
          slug,
        },
      });
      setAgentWorkspaceSkills(skills);
      setNotice(t(`スキルを追加しました: ${slug}`, `Skill added: ${slug}`));
    } catch (e) {
      if (showClawhubInstallHintIfNeeded(e)) return;
      handleCommandError(e);
    } finally {
      setInstallingSkillSlug("");
    }
  }

  async function onToggleSkillSearchPanel() {
    if (showSkillSearchPanel) {
      setShowSkillSearchPanel(false);
      return;
    }
    setError("");
    setNotice("");
    try {
      await invoke("ensure_clawhub_available");
      setShowSkillSearchPanel(true);
    } catch (e) {
      if (showClawhubInstallHintIfNeeded(e)) return;
      handleCommandError(e);
    }
  }

  async function onOpenCreateAgent() {
    setEditingAgentId(null);
    setAgentId("");
    setAgentModelId(modelOptions[0]?.id ?? "");
    setAgentChannelId("");
    setAgentWorkspacePath(".");
    setSkillSearchQuery("");
    setSkillSearchResults([]);
    setAgentWorkspaceSkills([]);
    setShowSkillSearchPanel(false);
    resetAgentSecurityDefaults();
    await refreshAgentWorkspaceSkills(".");
    setShowAgentForm(true);
  }

  async function onEditAgent(id: string) {
    const agent = snapshot.agents.find((a) => a.id === id);
    if (!agent) return;
    setEditingAgentId(agent.id);
    setAgentId(agent.id);
    setAgentModelId(agent.model_id);
    setAgentChannelId(agent.channel_id ?? "");
    const workspace = agent.workspace_path ?? ".";
    setAgentWorkspacePath(workspace);
    setSkillSearchQuery("");
    setSkillSearchResults([]);
    setShowSkillSearchPanel(false);
    const security = agent.security ?? defaultAgentSecuritySettings;
    setAgentExecSecurity(security.exec_security ?? "allowlist");
    setAgentExecAsk(security.exec_ask ?? "on-miss");
    setAgentExecAllowlist((security.exec_allowlist ?? []).join("\n"));
    setAgentAllowWorkspaceOutsideRead(security.allow_workspace_outside_read ?? true);
    setAgentAllowWorkspaceOutsideWrite(security.allow_workspace_outside_write ?? false);
    setAgentRequireAskForDestructive(security.require_ask_for_destructive ?? true);
    setAgentProtectSecretFiles(security.protect_secret_files ?? true);
    setAgentAllowGitPush(security.allow_git_push ?? false);
    setAgentAllowSystemWrite(security.allow_system_write ?? false);
    setAgentBrowserEnabled(security.browser_enabled ?? true);
    setAgentBrowserAllowedDomains((security.browser_allowed_domains ?? []).join("\n"));
    setAgentBrowserAskBeforeNavigation(security.browser_ask_before_navigation ?? true);
    await refreshAgentWorkspaceSkills(workspace);
    setShowAgentForm(true);
  }

  function onCloseAgentModal() {
    setShowAgentForm(false);
    setEditingAgentId(null);
    setAgentWorkspaceSkills([]);
    setSkillSearchQuery("");
    setSkillSearchResults([]);
    setInstallingSkillSlug("");
    setShowSkillSearchPanel(false);
    resetAgentSecurityDefaults();
  }

  async function onPickWorkspace() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Workspace Folder",
      });
      if (typeof selected === "string" && selected.trim()) {
        setAgentWorkspacePath(selected);
        await refreshAgentWorkspaceSkills(selected);
      }
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onSaveAgent(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const candidateId = agentId.trim() || editingAgentId || "";
    if (!candidateId) {
      setError(t("Agent ID を入力してください。", "Enter Agent ID."));
      return;
    }
    if (!agentModelId) {
      setError(t("Model を選択してください。", "Select a model."));
      return;
    }
    try {
      const saved = await invoke<Agent>("upsert_agent", {
        input: {
          id: candidateId,
          display_name: null,
          model_id: agentModelId,
          model_override: null,
          channel_id: agentChannelId || null,
          workspace_path: agentWorkspacePath || null,
          security: {
            exec_security: agentExecSecurity,
            exec_ask: agentExecAsk,
            exec_allowlist: agentExecAllowlist
              .split("\n")
              .map((v) => v.trim())
              .filter((v) => v.length > 0),
            allow_workspace_outside_read: agentAllowWorkspaceOutsideRead,
            allow_workspace_outside_write: agentAllowWorkspaceOutsideWrite,
            require_ask_for_destructive: agentRequireAskForDestructive,
            protect_secret_files: agentProtectSecretFiles,
            allow_git_push: agentAllowGitPush,
            allow_system_write: agentAllowSystemWrite,
            browser_enabled: agentBrowserEnabled,
            browser_allowed_domains: agentBrowserAllowedDomains
              .split("\n")
              .map((v) => v.trim().toLowerCase())
              .filter((v) => v.length > 0),
            browser_ask_before_navigation: agentBrowserAskBeforeNavigation,
          },
          force_rebind: true,
        },
      });
      if (saved.id !== editingAgentId) {
        setEditingAgentId(saved.id);
      }
      if (saved.id !== agentId) {
        setAgentId(saved.id);
      }
      await refresh();
      markConfigDirty();
      setNotice(editingAgentId ? t("Agentを更新しました。", "Agent updated.") : t("Agentを保存しました。", "Agent saved."));
      setShowAgentForm(false);
      setEditingAgentId(null);
      setAgentWorkspaceSkills([]);
      setSkillSearchQuery("");
      setSkillSearchResults([]);
      setInstallingSkillSlug("");
      setShowSkillSearchPanel(false);
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onDeleteAgent(id: string) {
    setError("");
    setNotice("");
    try {
      await invoke("delete_agent", { agentId: id });
      await refresh();
      markConfigDirty();
      setNotice(t("Agentを削除しました。", "Agent deleted."));
      if (editingAgentId === id) {
        setEditingAgentId(null);
        setShowAgentForm(false);
      }
    } catch (e) {
      handleCommandError(e);
      await showDeleteErrorDialog(e);
    }
  }

  async function onApplyConfig() {
    setError("");
    setNotice("");
    setValidationIssues([]);
    try {
      await invoke<OpenAiOauthLoginResult>("sync_openai_oauth_from_files");
      const currentModels = await refresh();
      const issues: ValidationIssue[] = [];
      if (currentModels.models.length === 0) {
        issues.push({ section: "Models", message: t("モデルを1つ以上追加してください。", "Add at least one model.") });
      }
      if (currentModels.agents.length === 0) {
        issues.push({ section: "Agents", message: t("エージェントを1つ以上追加してください。", "Add at least one agent.") });
      }
      for (const model of currentModels.models) {
        if (!model.model_name?.trim()) {
          issues.push({ section: "Models", message: t(`モデルID ${model.id}: model name は必須です。`, `Model ID ${model.id}: model name is required.`) });
        }
      }
      for (const channel of currentModels.channels) {
        if (!channel.account_id?.trim()) {
          issues.push({ section: "Channels", message: t(`チャンネルID ${channel.id}: account id は必須です。`, `Channel ID ${channel.id}: account id is required.`) });
        }
        if (channel.channel_type === "slack" && (!channel.slack_channels || channel.slack_channels.length === 0)) {
          issues.push({ section: "Channels", message: t(`Slack ${channel.account_id || channel.id}: Slack Channels (allowlist) を1つ以上設定してください。`, `Slack ${channel.account_id || channel.id}: set at least one Slack channel in allowlist.`) });
        }
      }
      for (const agent of currentModels.agents) {
        if (!agent.id?.trim()) {
          issues.push({ section: "Agents", message: t("agent id は必須です。", "agent id is required.") });
        }
        if (!agent.model_id?.trim()) {
          issues.push({ section: "Agents", message: t(`Agent ${agent.id || "(unknown)"}: model の選択が必須です。`, `Agent ${agent.id || "(unknown)"}: model selection is required.`) });
        }
      }
      if (gatewayMode === "remote") {
        if (!gatewayRemoteUrl.trim()) {
          issues.push({ section: "Gateway", message: t("Remote URL (VPS) を入力してください。", "Enter Remote URL (VPS).") });
        }
      } else {
        if (!gatewayPort.trim()) {
          issues.push({ section: "Gateway", message: t("Port を入力してください。", "Enter Port.") });
        }
      }
      if (issues.length > 0) {
        setValidationIssues(issues);
        setError(t("必須項目に不足があります。Setupのチェック一覧を確認してください。", "Required settings are missing. Check the Setup checklist."));
        return;
      }

      await invoke("set_gateway_config", {
        input: {
          mode: gatewayMode,
          port: gatewayMode === "local" && gatewayPort.trim() ? Number.parseInt(gatewayPort, 10) : null,
          bind: gatewayMode === "local" ? gatewayBind : null,
          auth_mode: gatewayMode === "local" ? gatewayAuthMode : null,
          auth_token: gatewayMode === "local" ? (gatewayAuthToken || null) : null,
          remote_url: gatewayMode === "remote" ? (gatewayRemoteUrl || null) : null,
          remote_token: gatewayMode === "remote" ? (gatewayRemoteToken || null) : null,
          tailscale_mode: gatewayMode === "local" ? gatewayTailscaleMode : null,
        },
      });
      const allowlistPatterns = defaultAgentSecuritySettings.exec_allowlist;
      await invoke("set_execution_allowlist", {
        input: {
          patterns: allowlistPatterns,
        },
      });
      await invoke("set_execution_policy", {
        input: {
          host: "gateway",
          security: defaultAgentSecuritySettings.exec_security,
          ask: defaultAgentSecuritySettings.exec_ask,
          node: null,
        },
      });
      await invoke<{ config_path: string; env_path: string; approvals_path: string }>("apply_config", {
        input: { target_dir: null },
      });
      setGatewayInitialized(false);
      setConfigAppliedAt(new Date().toLocaleString());
      await refresh();
      await refreshResolvedPaths();
      setNotice(
        t(
          "設定を適用しました。次はRunタブでStartしてください。",
          "Configuration applied. Next, open Run and press Start.",
        ),
      );
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onStart() {
    setError("");
    setNotice("");
    try {
      const logsBefore = await invoke<LogLine[]>("get_logs");
      const previousStartedLogs = countGatewayStartedLogs(logsBefore);
      const started = await invoke<RunStatus>("start_gateway", {
        input: {
          mode: runMode,
          health_timeout_sec: 20,
        },
      });
      const snap = await refresh();
      const startupLogConfirmed = await waitForGatewayStartedLog(previousStartedLogs);
      const dashboardUrl = dashboardUrlWithTokenFor(started.dashboard_url, snap.gateway);
      if (!startupLogConfirmed) {
        setNotice(
          t(
            `gatewayを起動しましたが、起動完了ログを確認できませんでした。Dashboard URL: ${dashboardUrl}`,
            `Gateway started, but the startup-complete log was not confirmed. Dashboard URL: ${dashboardUrl}`,
          ),
        );
        return;
      }
      try {
        await openUrl(dashboardUrl);
        setNotice(
          t(
            `起動完了ログを確認しました。Dashboardを開きました: ${dashboardUrl}`,
            `Startup-complete log confirmed. Dashboard opened: ${dashboardUrl}`,
          ),
        );
      } catch (openError) {
        setNotice(
          t(
            `起動完了ログを確認しましたが、ブラウザで開けませんでした。Dashboard URL: ${dashboardUrl}`,
            `Startup-complete log confirmed, but the browser did not open. Dashboard URL: ${dashboardUrl}`,
          ),
        );
        handleCommandError(openError);
      }
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onStop() {
    setError("");
    setNotice("");
    setRunStopping(true);
    try {
      await invoke("stop_gateway");
      await refresh();
      setNotice(t("gatewayを停止しました。", "Gateway stopped."));
    } catch (e) {
      handleCommandError(e);
    } finally {
      setRunStopping(false);
    }
  }

  async function onOpenDashboard() {
    setError("");
    try {
      await openUrl(dashboardUrlWithToken());
      setNotice(t(`Dashboardを開きました: ${dashboardUrlWithToken()}`, `Dashboard opened: ${dashboardUrlWithToken()}`));
    } catch (e) {
      handleCommandError(e);
    }
  }

  function dashboardUrlWithTokenFor(dashboardUrl: string, gateway: GatewaySettings): string {
    const token =
      (gateway.mode === "remote"
        ? gateway.remote_token
        : gateway.auth_token) ?? "";
    const trimmed = token.trim();
    if (!trimmed) return dashboardUrl;
    try {
      const url = new URL(dashboardUrl);
      url.hash = `token=${encodeURIComponent(trimmed)}`;
      return url.toString();
    } catch {
      return dashboardUrl;
    }
  }

  function dashboardUrlWithToken(): string {
    return dashboardUrlWithTokenFor(snapshot.run_status.dashboard_url, snapshot.gateway);
  }

  async function onCopyDashboardUrl() {
    setError("");
    const url = dashboardUrlWithToken();
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t(`Dashboard URLをコピーしました: ${url}`, `Dashboard URL copied: ${url}`));
    } catch (e) {
      setNotice(t(`Dashboard URL: ${url}`, `Dashboard URL: ${url}`));
    }
  }

  async function onRecordExperiment(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      await invoke("record_experiment", {
        input: {
          case_id: experimentCaseId,
          mode: experimentMode,
          result: experimentResult,
          observed_error: null,
          note: experimentNote || null,
        },
      });
      await refreshExperiments();
      setNotice(t("実験記録を保存しました。", "Experiment record saved."));
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onRunMaintenanceCommand(command: MaintenanceCommand) {
    setError("");
    setNotice("");
    setMaintenanceBusy(true);
    setMaintenanceBusyCommand(command);
    setNotice(
      command === "check_openclaw_update"
        ? t("OpenClaw の更新を確認しています。完了まで待ってください。", "Checking OpenClaw updates. Wait until it finishes.")
        : t("Clawhub の更新を確認しています。完了まで待ってください。", "Checking Clawhub updates. Wait until it finishes."),
    );
    try {
      const result = await invoke<MaintenanceCommandResult>("run_maintenance_command", { command });
      setNotice(result.summary);
      setMaintenanceStatusLoading(true);
      const status = await invoke<MaintenanceStatusResult>("get_maintenance_status");
      setMaintenanceStatus(status);
    } catch (e) {
      handleCommandError(e);
    } finally {
      setMaintenanceStatusLoading(false);
      setMaintenanceBusy(false);
      setMaintenanceBusyCommand("");
    }
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>easy-openclaw</h1>
          <p>{t("OpenClawオンボーディング用ブートストラップ", "OpenClaw onboarding bootstrap")}</p>
        </div>
        <div className="top-bar-actions">
          <label className="lang-picker-label">
            {t("言語", "Language")}
            <select className="form-select lang-picker" value={uiLang} onChange={(e) => setUiLang(e.target.value as UiLang)}>
              <option value="ja">🇯🇵 日本語</option>
              <option value="en">🇺🇸 English</option>
            </select>
          </label>
          <img className="brand-icon" src={crayfishIcon} alt="easy-openclaw logo" />
        </div>
      </header>

      <nav className="tab-row">
        <button onClick={() => setActiveTab("setup")} className={activeTab === "setup" ? "active" : ""}>{t("設定", "Setup")}</button>
        <button onClick={() => setActiveTab("run")} className={activeTab === "run" ? "active" : ""}>Run</button>
        <button onClick={() => setActiveTab("diagnostics")} className={activeTab === "diagnostics" ? "active" : ""}>{t("診断", "Diagnostics")}</button>
        <button onClick={() => setActiveTab("maintenance")} className={activeTab === "maintenance" ? "active" : ""}>
          {t("更新確認", "Updates")}
        </button>
      </nav>

      {validationIssues.length > 0 && (
        <article className="panel validation-panel">
          <h2>{t("Apply前チェック（不足項目）", "Pre-Apply Validation (Missing Items)")}</h2>
          <ul>
            {validationIssues.map((issue, index) => (
              <li key={`${issue.section}-${index}`}>
                <strong>{issue.section}</strong>: {issue.message}
              </li>
            ))}
          </ul>
        </article>
      )}

      {activeTab === "setup" && (
        <section className="tab-panel">
          <article className="panel setup-status-panel">
            <div className="panel-head">
              <h2>{t("セットアップの現在地", "Setup Status")}</h2>
              <p className="next-action">{setupNextAction()}</p>
            </div>
            <div className="setup-status-strip" aria-label={t("セットアップ状態", "Setup status")}>
              <div className={`setup-status-item ${statusClass(snapshot.models.length > 0, snapshot.models.length === 0)}`}>
                <span>Model Provider</span>
                <strong>{statusLabel(snapshot.models.length > 0, snapshot.models.length === 0)}</strong>
                <small>{snapshot.models.length > 0 ? t(`${snapshot.models.length}件`, `${snapshot.models.length} configured`) : t("最初に追加", "Add first")}</small>
              </div>
              <div className={`setup-status-item ${statusClass(snapshot.agents.length > 0, snapshot.models.length > 0 && snapshot.agents.length === 0)}`}>
                <span>Agent</span>
                <strong>{statusLabel(snapshot.agents.length > 0, snapshot.models.length > 0 && snapshot.agents.length === 0)}</strong>
                <small>{snapshot.agents.length > 0 ? t(`${snapshot.agents.length}件`, `${snapshot.agents.length} configured`) : t("Model追加後", "After model")}</small>
              </div>
              <div className={`setup-status-item ${statusClass(snapshot.channels.length > 0)}`}>
                <span>Channel</span>
                <strong>{snapshot.channels.length > 0 ? t("任意設定済み", "Optional done") : t("任意", "Optional")}</strong>
                <small>{snapshot.channels.length > 0 ? t(`${snapshot.channels.length}件`, `${snapshot.channels.length} configured`) : t("後から追加可", "Can add later")}</small>
              </div>
              <div className={`setup-status-item ${statusClass(!!configAppliedAt, snapshot.models.length > 0 && snapshot.agents.length > 0 && !configAppliedAt)}`}>
                <span>Apply Config</span>
                <strong>{statusLabel(!!configAppliedAt, snapshot.models.length > 0 && snapshot.agents.length > 0 && !configAppliedAt)}</strong>
                <small>{configAppliedAt ?? t("未適用", "Not applied")}</small>
              </div>
              <div className={`setup-status-item ${statusClass(snapshot.run_status.health === "ready", !!configAppliedAt && snapshot.run_status.health !== "ready")}`}>
                <span>Gateway</span>
                <strong>{snapshot.run_status.health === "ready" ? "ready" : statusLabel(false, !!configAppliedAt)}</strong>
                <small>{snapshot.run_status.health}</small>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <h2>{t("モデルプロバイダー", "Model Providers")}</h2>
              <button type="button" onClick={onOpenCreateModel} disabled={isModelEditing}>{t("モデルを追加", "Add Model")}</button>
            </div>
            <p className="panel-subtitle">
              {t("AIの接続先です。まず1つ登録すると、Agent作成で選べるようになります。", "AI connection targets. Add at least one so agents can use it.")}
            </p>
            <p className="next-step-note">
              {snapshot.models.length === 0
                ? t("次の操作: モデルを追加します。", "Next action: add a model.")
                : snapshot.agents.length === 0
                  ? t("次の操作: AgentsでAgentを追加します。", "Next action: add an Agent in Agents.")
                  : t("モデル接続先は設定済みです。必要ならProbeで疎通確認できます。", "Model provider is configured. Use Probe if you want to check connectivity.")}
            </p>
            <p className="rule-note">
              {t("Model変更はドラフトとして保持され、ファイルへの保存はApply時に行います。", "Model changes stay in draft and are written to files on Apply.")}
            </p>
            {modelOptions.length === 0 ? (
              <p className="empty-state">{t("現在のモデルはありません。最初に使うLLMを追加してください。", "No models configured. Add the LLM you want to use first.")}</p>
            ) : (
              <table className="list-table">
                <thead><tr><th>Model</th><th>Actions</th></tr></thead>
                <tbody>
                  {modelOptions.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.model_name}
                      </td>
                      <td className="action-cell">
                        <button type="button" className="table-action-btn action-edit" onClick={() => onEditModel(item.id)} disabled={isModelEditing}>Edit</button>
                        <button type="button" className="table-action-btn action-probe" onClick={() => onProbeProvider(item.id)} disabled={isModelEditing}>Probe</button>
                        <button type="button" className="table-action-btn action-delete" onClick={() => onDeleteModel(item.id)} disabled={isModelEditing}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>

          <article className="panel">
            <div className="panel-head">
              <h2>Channels</h2>
              <button type="button" onClick={onOpenCreateChannel} disabled={isChannelEditing}>{t("チャンネルを追加", "Add Channel")}</button>
            </div>
            <p className="panel-subtitle">
              {t("Slackなど外部チャットとの接続です。チャット画面から使わない場合は未設定のままで進めます。", "External chat connections such as Slack. Leave this empty if you do not need chat integration yet.")}
            </p>
            <p className="next-step-note">
              {snapshot.channels.length === 0
                ? t("次の操作: Slack連携が必要になった段階で追加します。初回のGateway確認ではスキップできます。", "Next action: add Slack only when you need chat integration. You can skip this for the first Gateway check.")
                : t("Channelは設定済みです。Agent編集で必要なChannelを割り当てます。", "Channel is configured. Assign it from Agent editing when needed.")}
            </p>
            {snapshot.channels.length === 0 ? (
              <p className="empty-state">{t("現在のチャンネルはありません。外部チャット連携は任意です。", "No channels configured. External chat integration is optional.")}</p>
            ) : (
              <table className="list-table">
                <thead><tr><th>ID</th><th>Type</th><th>Route</th><th>Actions</th></tr></thead>
                <tbody>
                  {snapshot.channels.map((item) => (
                    <tr key={item.id}>
                      <td>{item.account_id}</td>
                      <td>{item.channel_type}</td>
                      <td>{item.channel_type === "slack" ? ((item.slack_channels ?? []).join(", ") || "(none)") : "-"}</td>
                      <td className="action-cell">
                        <button type="button" className="table-action-btn action-edit" onClick={() => onEditChannel(item.id)} disabled={isChannelEditing}>Edit</button>
                        <button type="button" className="table-action-btn action-probe" onClick={() => onProbeChannel(item.id)} disabled={isChannelEditing}>Probe</button>
                        <button type="button" className="table-action-btn action-delete" onClick={() => onDeleteChannel(item.id)} disabled={isChannelEditing}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>

          <article className="panel">
            <div className="panel-head">
              <h2>Agents</h2>
              <button type="button" onClick={onOpenCreateAgent} disabled={isAgentEditing}>{t("エージェントを追加", "Add Agent")}</button>
            </div>
            <p className="panel-subtitle">
              {t("Agentは「どのモデルを、どの作業フォルダで動かすか」をまとめた実行単位です。", "An agent is the runnable unit: which model to use and which workspace it works in.")}
            </p>
            <p className="next-step-note">
              {snapshot.agents.length === 0
                ? t("次の操作: Agentを追加します。ChannelはNo ChannelのままでもDashboard確認できます。", "Next action: add an Agent. You can keep Channel as No Channel for Dashboard verification.")
                : !configAppliedAt
                  ? t("次の操作: Apply ConfigでOpenClaw設定を書き出します。", "Next action: write OpenClaw files with Apply Config.")
                  : t("Agentは設定済みです。次はRunでStartします。", "Agent is configured. Next, open Run and press Start.")}
            </p>
            {snapshot.agents.length === 0 ? (
              <p className="empty-state">{t("現在のエージェントはありません。モデルを追加したら、次にAgentを作成してください。", "No agents configured. After adding a model, create an agent next.")}</p>
            ) : (
              <table className="list-table">
                <thead><tr><th>ID</th><th>Model</th><th>Channel</th><th>Workspace</th><th>Actions</th></tr></thead>
                <tbody>
                  {snapshot.agents.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{modelOptions.find((m) => m.id === item.model_id)?.model_name ?? item.model_id}</td>
                      <td>{channelOptions.find((c) => c.id === item.channel_id)?.account_id ?? "none"}</td>
                      <td>{item.workspace_path ?? "."}</td>
                      <td className="action-cell">
                        <button type="button" className="table-action-btn action-edit" onClick={() => onEditAgent(item.id)} disabled={isAgentEditing}>Edit</button>
                        <button type="button" className="table-action-btn action-delete" onClick={() => onDeleteAgent(item.id)} disabled={isAgentEditing}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>

          <article className="panel">
            <div className="panel-head">
              <h2>Gateway</h2>
            </div>
            <p className="panel-subtitle">
              {t("OpenClawの実行サーバー設定です。初回は標準のLocal/loopbackのままがおすすめです。", "OpenClaw runtime server settings. For first setup, keep the standard Local/loopback values.")}
            </p>
            <p className="gateway-summary">
              {gatewayMode === "remote"
                ? t(`現在: Remote ${gatewayRemoteUrl || "(未設定)"}`, `Current: Remote ${gatewayRemoteUrl || "(unset)"}`)
                : t(`現在: Local ${gatewayBind}:${gatewayPort || "18789"}`, `Current: Local ${gatewayBind}:${gatewayPort || "18789"}`)}
            </p>
            <details className="gateway-details" open={gatewayDetailsOpen} onToggle={(e) => setGatewayDetailsOpen(e.currentTarget.open)}>
              <summary>{gatewayDetailsOpen ? t("Gateway詳細設定を閉じる", "Close Gateway advanced settings") : t("Gateway詳細設定を開く", "Open Gateway advanced settings")}</summary>
            <div className="form-grid gateway-details-grid">
              <label>
                Gateway Mode
                <select className="form-select" value={gatewayMode} onChange={(e) => { setGatewayMode(e.target.value as GatewayMode); markConfigDirty(); }}>
                  <option value="local">{t("Local (この端末で起動)", "Local (run on this device)")}</option>
                  <option value="remote">{t("Remote/VPS (外部gatewayへ接続)", "Remote/VPS (connect to external gateway)")}</option>
                </select>
                <span className="field-help">{gatewayModeHelp(gatewayMode)}</span>
              </label>
              {gatewayMode === "local" && (
                <>
                  <label>
                    Bind
                    <select className="form-select" value={gatewayBind} onChange={(e) => { setGatewayBind(e.target.value); markConfigDirty(); }}>
                      <option value="loopback">loopback</option>
                      <option value="lan">lan</option>
                      <option value="tailnet">tailnet</option>
                      <option value="auto">auto</option>
                      <option value="custom">custom</option>
                    </select>
                    <span className="field-help">{gatewayBindHelp(gatewayBind)}</span>
                  </label>
                  <label>
                    Port
                    <input className="form-control" type="number" min={1} max={65535} value={gatewayPort} onChange={(e) => { setGatewayPort(e.target.value); markConfigDirty(); }} />
                    <span className="field-help">{t("gatewayが待ち受ける番号です。競合がなければ標準値のままで構いません。", "The port the gateway listens on. Keep the default unless it conflicts.")}</span>
                  </label>
                  <label className="full-row">
                    {t("Auth (任意)", "Auth (optional)")}
                    <div className="inline-row">
                      <select className="form-select" value={gatewayAuthMode} onChange={(e) => { setGatewayAuthMode(e.target.value); markConfigDirty(); }}>
                        <option value="token">token</option>
                        <option value="password">password</option>
                      </select>
                      <div className="input-with-button">
                        <input
                          className="form-control"
                          type={showGatewayAuthToken ? "text" : "password"}
                          value={gatewayAuthToken}
                          onChange={(e) => { setGatewayAuthToken(e.target.value); markConfigDirty(); }}
                          placeholder={gatewayAuthMode === "token" ? t("空欄なら自動生成", "Auto-generated if empty") : "Gateway Password"}
                        />
                        <button type="button" className="toggle-visibility" onClick={() => setShowGatewayAuthToken((v) => !v)}>
                          {showGatewayAuthToken ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>
                    <span className="field-help">{gatewayAuthModeHelp(gatewayAuthMode)}</span>
                  </label>
                  <label>
                    Tailscale
                    <select className="form-select" value={gatewayTailscaleMode} onChange={(e) => { setGatewayTailscaleMode(e.target.value); markConfigDirty(); }}>
                      <option value="off">off</option>
                      <option value="serve">serve</option>
                      <option value="funnel">funnel</option>
                    </select>
                    <span className="field-help">{tailscaleModeHelp(gatewayTailscaleMode)}</span>
                  </label>
                </>
              )}
              {gatewayMode === "remote" && (
                <>
                  <label className="full-row">
                    Remote URL (VPS)
                    <input className="form-control" value={gatewayRemoteUrl} onChange={(e) => { setGatewayRemoteUrl(e.target.value); markConfigDirty(); }} placeholder="ws://vps.example.com:18789" />
                    <span className="field-help">{t("接続先gatewayのWebSocket URLです。Remote運用時だけ必要です。", "WebSocket URL of the remote gateway. Required only for remote setups.")}</span>
                  </label>
                  <label className="full-row">
                    Remote Token
                    <div className="input-with-button">
                      <input
                        className="form-control"
                        type={showGatewayRemoteToken ? "text" : "password"}
                        value={gatewayRemoteToken}
                        onChange={(e) => { setGatewayRemoteToken(e.target.value); markConfigDirty(); }}
                      />
                      <button type="button" className="toggle-visibility" onClick={() => setShowGatewayRemoteToken((v) => !v)}>
                        {showGatewayRemoteToken ? "Hide" : "Show"}
                      </button>
                    </div>
                    <span className="field-help">{t("Remote gatewayへ接続するための認証値です。接続先側と同じ値を入れます。", "Secret used to authenticate to the remote gateway. It must match the remote side.")}</span>
                  </label>
                </>
              )}
            </div>
            </details>
          </article>

          <article className="panel">
            <div className="panel-head">
              <h2>Apply</h2>
              <button type="button" onClick={onApplyConfig}>Apply Config</button>
            </div>
            <p className="panel-subtitle">
              {t("画面上のドラフト設定をOpenClawが読むファイルへ保存します。Runの前に実行してください。", "Writes the draft settings into files that OpenClaw reads. Run this before starting.")}
            </p>
            <p className={`apply-status ${configAppliedAt ? "done" : "pending"}`}>
              {configAppliedAt
                ? t(`設定は適用済みです。次はRunでStartします。`, `Configuration is applied. Next, open Run and press Start.`)
                : t("まだ現在のドラフトはApplyされていません。", "The current draft has not been applied yet.")}
            </p>
            <details className="apply-details">
              <summary>{t("保存先の詳細を表示", "Show file details")}</summary>
              <p className="path-line">{t("保存先", "Config path")}: <code>{resolvedConfigPath || "(resolving...)"}</code></p>
              <p className="path-line">{t("環境変数", "Env file")}: <code>{resolvedEnvPath || "(resolving...)"}</code></p>
              <p className="path-line">Exec Approvals: <code>{resolvedApprovalsPath || "(resolving...)"}</code></p>
              <p className="rule-note">{t("決定ルール", "Resolution rule")}: `OPENCLAW_CONFIG_PATH` → `OPENCLAW_STATE_DIR/openclaw.json` → `~/.openclaw/openclaw.json`</p>
            </details>
          </article>
        </section>
      )}

      {showModelForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Model Editor">
          <div className="modal-card">
            <div className="modal-head"><h3>{editingModelId ? t("モデルを編集", "Edit Model") : t("モデルを追加", "Add Model")}</h3><button type="button" onClick={onCloseModelModal}>{t("閉じる", "Close")}</button></div>
            <form onSubmit={onCreateProvider} className="form-grid">
              <label className="full-row">
                Provider
                <select
                  className="form-select"
                  value={providerType}
                  onChange={(e) => selectProviderType(e.target.value as ProviderType)}
                >
                  {providerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value === "compatible" ? t("OpenAI互換", option.label) : option.label}
                    </option>
                  ))}
                </select>
                <span className="field-help">{providerTypeHelp(providerType)}</span>
              </label>
              {providerType === "open_ai" && (
                <label className="full-row">
                  {t("認証方式", "Auth Mode")}
                  <select
                    className="form-select"
                    value={openAiAuthMode}
                    onChange={(e) => {
                      const next = e.target.value as OpenAiAuthMode;
                      setProviderModelCandidatesDynamic([]);
                      setOpenAiAuthMode(next);
                      setProviderModel(next === "oauth" ? openAiOauthDefaultModel : openAiApiDefaultModel);
                      if (!providerNeedsApiKey(providerType, next)) {
                        setProviderApiKey("");
                      }
                    }}
                  >
                    <option value="api_key">API Key</option>
                    <option value="oauth">{t("OAuth (ChatGPT Pro / Codex)", "OAuth (ChatGPT Pro / Codex)")}</option>
                  </select>
                  <span className="field-help">{openAiAuthModeHelp(openAiAuthMode)}</span>
                </label>
              )}
              <label className="full-row">
                Base URL
                <input className="form-control" value={providerBaseUrl} onChange={(e) => setProviderBaseUrl(e.target.value)} placeholder={providerBaseUrlPlaceholder || t("compatibleは入力必須", "required for compatible provider")} />
                <span className="field-help">
                  {providerType === "compatible"
                    ? t("OpenAI互換サーバーのURLです。例: http://localhost:1234/v1", "URL of the OpenAI-compatible server. Example: http://localhost:1234/v1")
                    : t("空欄なら標準の接続先を使います。LM Studio/OllamaではローカルURLを指定できます。", "Leave empty to use the standard endpoint. For LM Studio/Ollama, set the local URL if needed.")}
                </span>
              </label>
              {useModelDropdown ? (
                <>
                  <div className="model-candidate-toolbar full-row">
                    <span>
                      {t("Model候補", "Model candidates")}
                      <small className="inline-help">{t("候補更新でOpenClawから利用可能モデルを取得します。", "Refresh asks OpenClaw for available models.")}</small>
                    </span>
                    <button
                      type="button"
                      className="table-action-btn action-probe"
                      onClick={refreshProviderModelCandidates}
                      disabled={providerModelCandidatesLoading}
                    >
                      {providerModelCandidatesLoading
                        ? <BusyIndicator label={t("取得中", "Loading")} />
                        : t("候補更新", "Refresh candidates")}
                    </button>
                  </div>
                  <label className="full-row">
                    Model Name
                    <select
                      className="form-select"
                      value={selectedModelOption}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "__custom__") {
                          setProviderModel("");
                          return;
                        }
                        setProviderModel(value);
                      }}
                    >
                      {modelCandidates.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                      <option value="__custom__">{t("カスタム入力", "Custom input")}</option>
                    </select>
                    <span className="field-help">{t("Agentが実際に使うモデルIDです。候補にない場合はカスタム入力を選びます。", "Model ID the agent will actually use. Choose custom input if it is not in the list.")}</span>
                  </label>
                  {selectedModelOption === "__custom__" && (
                    <label className="full-row">
                      {t("カスタムModel Name", "Custom Model Name")}
                      <input className="form-control" value={providerModel} onChange={(e) => setProviderModel(e.target.value)} placeholder={providerModelPlaceholder} />
                      <span className="field-help">{t("Provider側で受け付ける正確なモデルIDを入力してください。", "Enter the exact model ID accepted by the provider.")}</span>
                    </label>
                  )}
                </>
              ) : (
                <label className="full-row">
                  Model Name
                  <input className="form-control" value={providerModel} onChange={(e) => setProviderModel(e.target.value)} placeholder={providerModelPlaceholder} />
                  <span className="field-help">{t("ローカルProvider側でロード済み、またはpull済みのモデル名を入力します。", "Enter a model name loaded or pulled in the local provider.")}</span>
                </label>
              )}
              {providerNeedsApiKey(providerType, openAiAuthMode) && (
                <label className="full-row">
                  {t("API Key (任意)", "API Key (optional)")}
                  <div className="input-with-button">
                    <input className="form-control" value={providerApiKey} onChange={(e) => setProviderApiKey(e.target.value)} type={showProviderApiKey ? "text" : "password"} />
                    <button type="button" className="toggle-visibility" onClick={() => setShowProviderApiKey((v) => !v)}>
                      {showProviderApiKey ? "Hide" : "Show"}
                    </button>
                  </div>
                  <span className="field-help">{t("外部APIへ接続する場合に使います。LM Studio/OllamaやOpenAI OAuthでは不要です。", "Used for external APIs. Not needed for LM Studio/Ollama or OpenAI OAuth.")}</span>
                </label>
              )}
              <div className="modal-actions"><button type="submit">{editingModelId ? t("モデルを更新", "Update Model") : t("モデルを追加", "Add Model")}</button><button type="button" onClick={onCloseModelModal}>Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {showChannelForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Channel Editor">
          <div className="modal-card">
            <div className="modal-head"><h3>{editingChannelId ? t("チャンネルを編集", "Edit Channel") : t("チャンネルを追加", "Add Channel")}</h3><button type="button" onClick={onCloseChannelModal}>{t("閉じる", "Close")}</button></div>
            <form onSubmit={onCreateChannel} className="form-grid">
              <label className="full-row">
                Channel Type
                <select className="form-select" value={channelType} onChange={(e) => resetChannelForm(e.target.value as ChannelType)}>
                  <option value="slack">Slack</option><option value="discord">Discord</option><option value="telegram">Telegram</option>
                </select>
                <span className="field-help">{channelTypeHelp(channelType)}</span>
              </label>
              <label className="full-row">
                Account ID
                <input className="form-control" value={channelAccountId} onChange={(e) => setChannelAccountId(e.target.value.toLowerCase())} placeholder={nextChannelAccountId(channelType)} />
                <span className="field-help">{t("easy-openclaw内で見分けるための名前です。SlackのチャンネルIDとは別です。", "A local name used inside easy-openclaw. This is not the Slack channel ID.")}</span>
              </label>
              {channelType === "slack" && (
                <>
                  <div className="channel-help full-row">
                    <h4>{t("Slack 設定チェック", "Slack Setup Checklist")}</h4>
                    <ol>
                      <li>{t("`https://api.slack.com/apps` にアクセスし、対象Appを開く。", "Open `https://api.slack.com/apps` and select your app.")}</li>
                      <li>{t("`Socket Mode` を開いて `Enable Socket Mode` を ON にする。", "Open `Socket Mode` and turn `Enable Socket Mode` ON.")}</li>
                      <li>{t("`Event Subscriptions` を開いて ON にし、Bot Events に `app_mention` / `message.channels` / `message.groups` を追加する。", "Open `Event Subscriptions`, enable it, and add `app_mention` / `message.channels` / `message.groups` to Bot Events.")}</li>
                      <li>{t("`OAuth & Permissions` で Bot Token Scopes に `app_mentions:read` / `channels:history` / `groups:history` / `chat:write` を追加する。", "In `OAuth & Permissions`, add `app_mentions:read` / `channels:history` / `groups:history` / `chat:write` to Bot Token Scopes.")}</li>
                      <li>{t("`Install App` または `Reinstall to Workspace` を実行して権限変更を反映する。", "Run `Install App` or `Reinstall to Workspace` to apply scope changes.")}</li>
                      <li>{t("Slack画面で対象チャンネルに bot を `/invite` する。", "Invite the bot to your target channel with `/invite` in Slack.")}</li>
                      <li>{t("チャンネルIDは Slack のチャンネル詳細か URL 末尾の `C...` を使う。", "Use the channel ID from Slack details or the URL suffix `C...`.")}</li>
                    </ol>
                  </div>
                  <label className="full-row">
                    Slack Channels (allowlist)
                    <input className="form-control" value={channelSlackChannels} onChange={(e) => setChannelSlackChannels(e.target.value)} placeholder="C0123456789, C0987654321" />
                    <span className="field-help">{t("Agentが反応するSlackチャンネルIDです。複数ある場合はカンマで区切ります。", "Slack channel IDs the agent should respond to. Separate multiple IDs with commas.")}</span>
                  </label>
                  <label className="full-row">
                    Slack Bot Token
                    <div className="input-with-button">
                      <input className="form-control" value={channelSlackBotToken} onChange={(e) => setChannelSlackBotToken(e.target.value)} type={showChannelSlackBotToken ? "text" : "password"} placeholder="xoxb-..." />
                      <button type="button" className="toggle-visibility" onClick={() => setShowChannelSlackBotToken((v) => !v)}>
                        {showChannelSlackBotToken ? "Hide" : "Show"}
                      </button>
                    </div>
                    <span className="field-help">{t("Slackへ投稿・履歴取得するBot User OAuth Tokenです。通常は xoxb- で始まります。", "Bot User OAuth Token used to post and read Slack history. Usually starts with xoxb-.")}</span>
                  </label>
                  <label className="full-row">
                    Slack App Token
                    <div className="input-with-button">
                      <input className="form-control" value={channelSlackAppToken} onChange={(e) => setChannelSlackAppToken(e.target.value)} type={showChannelSlackAppToken ? "text" : "password"} placeholder="xapp-..." />
                      <button type="button" className="toggle-visibility" onClick={() => setShowChannelSlackAppToken((v) => !v)}>
                        {showChannelSlackAppToken ? "Hide" : "Show"}
                      </button>
                    </div>
                    <span className="field-help">{t("Socket ModeでSlackからイベントを受け取るApp-Level Tokenです。通常は xapp- で始まります。", "App-level token used by Socket Mode to receive Slack events. Usually starts with xapp-.")}</span>
                  </label>
                </>
              )}
              {channelType === "discord" && (
                <label className="full-row">
                  Discord Bot Token
                  <div className="input-with-button">
                    <input className="form-control" value={channelDiscordBotToken} onChange={(e) => setChannelDiscordBotToken(e.target.value)} type={showChannelDiscordBotToken ? "text" : "password"} />
                    <button type="button" className="toggle-visibility" onClick={() => setShowChannelDiscordBotToken((v) => !v)}>
                      {showChannelDiscordBotToken ? "Hide" : "Show"}
                    </button>
                  </div>
                  <span className="field-help">{t("Discord Developer Portalで作成したBot Tokenです。", "Bot token created in the Discord Developer Portal.")}</span>
                </label>
              )}
              {channelType === "telegram" && (
                <label className="full-row">
                  Telegram Bot Token
                  <div className="input-with-button">
                    <input className="form-control" value={channelTelegramBotToken} onChange={(e) => setChannelTelegramBotToken(e.target.value)} type={showChannelTelegramBotToken ? "text" : "password"} />
                    <button type="button" className="toggle-visibility" onClick={() => setShowChannelTelegramBotToken((v) => !v)}>
                      {showChannelTelegramBotToken ? "Hide" : "Show"}
                    </button>
                  </div>
                  <span className="field-help">{t("BotFatherで発行したTelegram Bot Tokenです。", "Telegram bot token issued by BotFather.")}</span>
                </label>
              )}
              <div className="modal-actions"><button type="submit">{editingChannelId ? "Update Channel" : "Save Channel"}</button><button type="button" onClick={onCloseChannelModal}>Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {showAgentForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Agent Editor">
          <div className="modal-card">
            <div className="modal-head"><h3>{editingAgentId ? t("エージェントを編集", "Edit Agent") : t("エージェントを追加", "Add Agent")}</h3><button type="button" onClick={onCloseAgentModal}>{t("閉じる", "Close")}</button></div>
            <form onSubmit={onSaveAgent} className="form-grid">
              <label className="full-row">
                Agent ID
                <input className="form-control" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent-main" />
                <span className="field-help">{t("OpenClaw設定内でAgentを識別する名前です。英数字とハイフン中心の短い名前がおすすめです。", "Name used to identify this agent in OpenClaw config. A short alphanumeric/hyphen name is recommended.")}</span>
              </label>
              <p className="rule-note full-row">{t("Save Agentでドラフトに保存します。設定ファイルへの保存は最後に Apply を実行してください。", "Save Agent writes to draft state. Run Apply to write files.")}</p>
              <label className="full-row">
                Model
                <select className="form-select" value={agentModelId} onChange={(e) => setAgentModelId(e.target.value)}>
                  <option value="">Select Model</option>
                  {modelOptions.map((m) => (<option key={m.id} value={m.id}>{m.model_name}</option>))}
                </select>
                <span className="field-help">{t("このAgentが返答に使うAIモデルです。Modelsで追加したものから選びます。", "AI model this agent uses for replies. Choose one added in Models.")}</span>
              </label>
              <label className="full-row">
                Channel
                <select className="form-select" value={agentChannelId} onChange={(e) => setAgentChannelId(e.target.value)}>
                  <option value="">No Channel</option>
                  {channelOptions.map((c) => (<option key={c.id} value={c.id}>{c.account_id}</option>))}
                </select>
                <span className="field-help">{t("外部チャットと紐づける場合だけ選びます。No ChannelならRun後にDashboard等から使います。", "Choose only when linking this agent to external chat. No Channel can still be used after Run, such as from Dashboard.")}</span>
              </label>
              <label className="full-row">
                Workspace
                <div className="input-with-button">
                  <input className="form-control" value={agentWorkspacePath} onChange={(e) => setAgentWorkspacePath(e.target.value)} />
                  <button type="button" onClick={onPickWorkspace}>Browse...</button>
                </div>
                <span className="field-help">{t("Agentが読み書きする作業フォルダです。空や . の場合は標準workspaceへ正規化されます。", "Workspace folder the agent reads and writes. Empty or . is normalized to the default workspace.")}</span>
              </label>
              <div className="full-row channel-help">
                <h4>Security</h4>
                <p className="rule-note">{t("デフォルトは次の安全設定（1-6）です: workspace外 write禁止 / workspace外 read許可 / 破壊操作は確認 / 秘密ファイル保護 / git push禁止 / system領域書き込み禁止。", "Default safety profile (1-6): block writes outside workspace / allow reads outside workspace / ask before destructive operations / protect secret files / deny git push / deny system writes.")}</p>
                <div className="form-grid security-form-grid">
                  <label>
                    Exec Security
                    <select className="form-select" value={agentExecSecurity} onChange={(e) => setAgentExecSecurity(e.target.value as AgentSecuritySettings["exec_security"])}>
                      <option value="allowlist">{t("allowlist (推奨)", "allowlist (recommended)")}</option>
                      <option value="deny">deny</option>
                      <option value="full">{t("full (危険)", "full (dangerous)")}</option>
                    </select>
                    <span className="field-help">{t("コマンド実行の許可方式です。allowlistは許可リスト内だけ実行できます。", "Controls command execution. allowlist permits only listed commands.")}</span>
                  </label>
                  <label>
                    Exec Ask
                    <select className="form-select" value={agentExecAsk} onChange={(e) => setAgentExecAsk(e.target.value as AgentSecuritySettings["exec_ask"])}>
                      <option value="on-miss">{t("on-miss (推奨)", "on-miss (recommended)")}</option>
                      <option value="always">always</option>
                      <option value="off">off</option>
                    </select>
                    <span className="field-help">{t("許可リストにない操作を確認するかを決めます。on-missは不足時だけ確認します。", "Controls confirmation for commands outside the allowlist. on-miss asks only when needed.")}</span>
                  </label>
                  <label className="full-row">
                    Agent Exec Allowlist
                    <textarea
                      className="form-control allowlist-textarea"
                      value={agentExecAllowlist}
                      onChange={(e) => setAgentExecAllowlist(e.target.value)}
                      placeholder={"/opt/homebrew/bin/rg\n/opt/homebrew/bin/git\n/bin/sh"}
                    />
                    <span className="field-help">{t("Agentが実行できるコマンドのパスです。1行に1つずつ書きます。", "Command paths the agent may run. Enter one command per line.")}</span>
                  </label>
                </div>
                <div className="form-grid">
                  <label className="checkbox-row"><input type="checkbox" checked={agentAllowWorkspaceOutsideRead} onChange={(e) => setAgentAllowWorkspaceOutsideRead(e.target.checked)} /><span>{t("Workspace外のreadを許可", "Allow reads outside workspace")}<small>{t("参照だけ許可します。書き込みは別項目です。", "Allows reading only. Writing is controlled separately.")}</small></span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentAllowWorkspaceOutsideWrite} onChange={(e) => setAgentAllowWorkspaceOutsideWrite(e.target.checked)} /><span>{t("Workspace外のwriteを許可", "Allow writes outside workspace")}<small>{t("作業フォルダ外へ変更できるため、通常はOFFです。", "Usually off because it allows changes outside the workspace.")}</small></span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentRequireAskForDestructive} onChange={(e) => setAgentRequireAskForDestructive(e.target.checked)} /><span>{t("破壊操作は常に確認", "Always ask for destructive operations")}<small>{t("削除や上書きなどの前に確認します。", "Asks before deletion, overwrite, and similar actions.")}</small></span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentProtectSecretFiles} onChange={(e) => setAgentProtectSecretFiles(e.target.checked)} /><span>{t("秘密ファイルを保護 (.env/.ssh)", "Protect secret files (.env/.ssh)")}<small>{t("認証情報を含むファイルへの不用意なアクセスを抑えます。", "Reduces accidental access to files containing secrets.")}</small></span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentAllowGitPush} onChange={(e) => setAgentAllowGitPush(e.target.checked)} /><span>{t("git push を許可", "Allow git push")}<small>{t("リモートリポジトリへ送信できるため、必要時だけONにします。", "Enable only when needed because it can publish to remotes.")}</small></span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentAllowSystemWrite} onChange={(e) => setAgentAllowSystemWrite(e.target.checked)} /><span>{t("system領域 write を許可 (/usr /etc)", "Allow system writes (/usr /etc)")}<small>{t("OS領域を変更できるため、通常はOFFです。", "Usually off because it can modify OS-level locations.")}</small></span></label>
                </div>
                <h4>{t("Browser (Chrome 固定)", "Browser (Chrome only)")}</h4>
                <div className="form-grid">
                  <label className="checkbox-row"><input type="checkbox" checked={agentBrowserEnabled} onChange={(e) => setAgentBrowserEnabled(e.target.checked)} /><span>{t("Browser ツールを有効化", "Enable browser tool")}<small>{t("AgentがChromeを使ってWebページを操作できるようにします。", "Allows the agent to operate web pages through Chrome.")}</small></span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentBrowserAskBeforeNavigation} onChange={(e) => setAgentBrowserAskBeforeNavigation(e.target.checked)} /><span>{t("ページ遷移の前に確認する", "Ask before page navigation")}<small>{t("新しいURLへ移動する前に確認します。", "Asks before navigating to a new URL.")}</small></span></label>
                  <label className="full-row">
                    {t("Allowed Domains (1行1ドメイン / 空なら制限なし)", "Allowed Domains (one per line / empty = no restriction)")}
                    <textarea
                      className="form-control allowlist-textarea"
                      value={agentBrowserAllowedDomains}
                      onChange={(e) => setAgentBrowserAllowedDomains(e.target.value)}
                      placeholder={"openai.com\nslack.com\ngithub.com"}
                    />
                    <span className="field-help">{t("Browserツールで開けるドメインを制限します。空欄なら制限しません。", "Limits domains the browser tool may open. Empty means unrestricted.")}</span>
                  </label>
                </div>
              </div>
              <div className="full-row channel-help">
                <h4>Skills</h4>
                <p className="rule-note">Workspace: <code>{agentWorkspacePath || "."}</code></p>
                <p className="rule-note">{t("このWorkspaceでAgentが使える追加機能です。必要になった時だけ追加します。", "Additional abilities available to this agent in the workspace. Add them only when needed.")}</p>
                <table className="list-table">
                  <thead>
                    <tr>
                      <th>Skill</th>
                      <th>Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentWorkspaceSkills.length === 0 ? (
                      <tr>
                        <td colSpan={2}>{t("現在のスキルはありません。", "No skills installed.")}</td>
                      </tr>
                    ) : (
                      agentWorkspaceSkills.map((skill) => (
                        <tr key={skill.slug}>
                          <td><span className="skill-label">{skill.slug}</span></td>
                          <td><code>{skill.path}</code></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="inline-row">
                  <button type="button" onClick={onToggleSkillSearchPanel}>
                    {showSkillSearchPanel ? t("検索を閉じる", "Close Search") : t("スキル検索・追加", "Search & Add Skills")}
                  </button>
                  <button type="button" onClick={() => refreshAgentWorkspaceSkills(agentWorkspacePath || ".")}>
                    {t("再読込", "Reload")}
                  </button>
                </div>
                {showSkillSearchPanel && (
                  <div className="skills-search-panel">
                    <div className="inline-row">
                      <input
                        className="form-control"
                        value={skillSearchQuery}
                        onChange={(e) => setSkillSearchQuery(e.target.value)}
                        placeholder="clawhubで検索 (例: slack, github, summarize)"
                      />
                      <button type="button" onClick={onSearchSkills} disabled={skillSearchLoading}>
                        {skillSearchLoading ? t("検索中...", "Searching...") : t("検索", "Search")}
                      </button>
                    </div>
                    {skillSearchResults.length === 0 ? (
                      <p className="rule-note">{t("検索結果はまだありません。キーワードを入力して検索してください。", "No search results yet. Enter a keyword and search.")}</p>
                    ) : (
                      <div className="skills-search-results">
                        {skillSearchResults.map((skill) => (
                          <div key={skill.slug} className="skills-search-item">
                            <div>
                              <strong>{skill.title || skill.slug}</strong>
                              <p className="rule-note"><code>{skill.slug}</code> {skill.summary ? `- ${skill.summary}` : ""}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => onInstallSkill(skill.slug)}
                              disabled={installingSkillSlug === skill.slug}
                            >
                              {installingSkillSlug === skill.slug ? t("インストール中...", "Installing...") : t("追加", "Add")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="submit">{editingAgentId ? t("Agentを更新", "Update Agent") : t("Agentを保存", "Save Agent")}</button>
                <button type="button" onClick={onCloseAgentModal}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === "run" && (
        <section className="tab-panel">
          <article className="panel">
            <h2>Run</h2>
            <div className="inline-row run-toolbar">
              <label className="run-mode-field">
                Mode
                <select className="form-select run-mode-select" value={runMode} onChange={(e) => setRunMode(e.target.value as RunMode)}>
                  <option value="a">{t("App Parent (推奨)", "App Parent (recommended)")}</option>
                  <option value="b">{t("External Gateway (手動起動済み)", "External Gateway (already started manually)")}</option>
                </select>
                <span className="field-help">{runModeHelp(runMode)}</span>
              </label>
              <button className="run-action-btn run-start-btn" onClick={onStart} disabled={!snapshot.run_status.can_start} title={snapshot.run_status.start_disabled_reason ?? ""}>
                Start
              </button>
              <button className="run-action-btn run-stop-btn" onClick={onStop} disabled={runStopping || !snapshot.run_status.can_stop} title={snapshot.run_status.stop_disabled_reason ?? ""}>
                {runStopping ? t("Stopping...", "Stopping...") : "Stop"}
              </button>
              <button className="run-action-btn" onClick={onOpenDashboard}>Open Dashboard</button>
              <button className="run-action-btn secondary-action-btn" onClick={onCopyDashboardUrl}>{t("Dashboard URLをコピー", "Copy Dashboard URL")}</button>
            </div>
            <p className="rule-note">{t("推奨: App Parent（easy-openclawが親プロセスとしてgateway起動）", "Recommended: App Parent (easy-openclaw starts gateway as parent process)")}</p>
            <p className="path-line">{t("Gateway設定", "Gateway setting")}: <code>{snapshot.gateway.mode === "remote" ? `remote: ${snapshot.gateway.remote_url ?? "(unset)"}` : `local: ${snapshot.gateway.bind ?? "loopback"}:${snapshot.gateway.port ?? 18789}`}</code></p>
            <p className="path-line">{t("読取設定", "Read config")}: <code>{resolvedConfigPath || "(resolving...)"}</code></p>
            <p className="rule-note">{t("決定ルール", "Resolution rule")}: `OPENCLAW_CONFIG_PATH` → `OPENCLAW_STATE_DIR/openclaw.json` → `~/.openclaw/openclaw.json`</p>
            <p>
              Health: <strong>{snapshot.run_status.health}</strong> / PID: {snapshot.run_status.pid ?? "-"} / PortInUse:{" "}
              {snapshot.run_status.port_in_use ? "yes" : "no"}
            </p>
          </article>
          <article className="panel">
            <h2>Logs</h2>
            <div className="log-box">
              {logs.length === 0 ? (
                <div className="log-empty">(no logs)</div>
              ) : (
                logs.map((line, index) => (
                  <div key={`${line.ts}-${line.level}-${index}`} className={`log-line log-${logLevelClass(line.level)}`}>
                    <span className="log-ts">[{line.ts}]</span>
                    <span className="log-level">{line.level}</span>
                    <span className="log-message">{line.message}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      )}

      {activeTab === "diagnostics" && (
        <section className="tab-panel">
          <article className="panel">
            <h2>TCC Experiment</h2>
            <form onSubmit={onRecordExperiment} className="form-grid">
              <label>Case ID<input className="form-control" value={experimentCaseId} onChange={(e) => setExperimentCaseId(e.target.value)} /></label>
              <label>Mode<select className="form-select" value={experimentMode} onChange={(e) => setExperimentMode(e.target.value as RunMode)}><option value="a">Case A</option><option value="b">Case B</option></select></label>
              <label>Result<select className="form-select" value={experimentResult} onChange={(e) => setExperimentResult(e.target.value)}><option value="success">success</option><option value="failed">failed</option></select></label>
              <label>Note<textarea className="form-control" rows={2} value={experimentNote} onChange={(e) => setExperimentNote(e.target.value)} /></label>
              <button type="submit">Save Record</button>
            </form>
          </article>
          <article className="panel"><h2>Saved Records</h2><ul>{experiments.map((item) => (<li key={item.id}><span>{item.case_id} / {item.mode} / {item.result} / {item.recorded_at}</span></li>))}</ul></article>
        </section>
      )}

      {activeTab === "maintenance" && (
        <section className="tab-panel">
          <article className="panel">
            <div className="panel-head">
              <h2>{t("OpenClaw / Clawhub 更新確認", "OpenClaw / Clawhub Update Check")}</h2>
            </div>
            <p className="rule-note">
              {t(
                "OpenClaw / Clawhub は easy-openclaw の依存として導入されます。ここでは npm の最新版と現在のバージョンを比較します。",
                "OpenClaw / Clawhub are installed as easy-openclaw dependencies. This view compares the current version with the latest npm version.",
              )}
            </p>
            {maintenanceBusyCommand && (
              <div className="install-progress">
                <BusyIndicator
                  label={
                    maintenanceBusyCommand === "check_openclaw_update"
                      ? t("OpenClaw の更新確認中", "Checking OpenClaw updates")
                      : t("Clawhub の更新確認中", "Checking Clawhub updates")
                  }
                />
              </div>
            )}
            <table className="list-table">
              <thead>
                <tr>
                  <th>{t("ソフトウェア", "Software")}</th>
                  <th>{t("説明", "Description")}</th>
                  <th>{t("現在のバージョン", "Current Version")}</th>
                  <th>{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>OpenClaw</td>
                  <td>{t("エージェント実行とGateway連携の本体CLI", "Core CLI for agent runtime and gateway integration")}</td>
                  <td>
                    {maintenanceBusyCommand === "check_openclaw_update"
                      ? (
                        <BusyIndicator label={t("更新確認中", "Checking")} />
                      )
                      : maintenanceStatusLoading || !maintenanceStatus
                      ? t("確認中", "Checking...")
                      : maintenanceStatus?.openclaw.installed
                      ? (maintenanceStatus?.openclaw.version ?? "installed")
                      : t("未検出", "Not detected")}
                  </td>
                  <td className="action-cell">
                    <button
                      type="button"
                      className="table-action-btn action-edit"
                      disabled={maintenanceBusy}
                      onClick={() => onRunMaintenanceCommand("check_openclaw_update")}
                    >
                      {maintenanceBusyCommand === "check_openclaw_update"
                        ? (
                          <BusyIndicator label={t("確認中", "Checking")} />
                        )
                        : t("更新確認", "Check Update")}
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>Clawhub</td>
                  <td>{t("スキル検索・配布連携を行うCLI", "CLI for skill discovery and distribution integration")}</td>
                  <td>
                    {maintenanceBusyCommand === "check_clawhub_update"
                      ? (
                        <BusyIndicator label={t("更新確認中", "Checking")} />
                      )
                      : maintenanceStatusLoading || !maintenanceStatus
                      ? t("確認中", "Checking...")
                      : maintenanceStatus?.clawhub.installed
                      ? (maintenanceStatus?.clawhub.version ?? "installed")
                      : t("未検出", "Not detected")}
                  </td>
                  <td className="action-cell">
                    <button
                      type="button"
                      className="table-action-btn action-edit"
                      disabled={maintenanceBusy}
                      onClick={() => onRunMaintenanceCommand("check_clawhub_update")}
                    >
                      {maintenanceBusyCommand === "check_clawhub_update"
                        ? (
                          <BusyIndicator label={t("確認中", "Checking")} />
                        )
                        : t("更新確認", "Check Update")}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="rule-note"><code>npm view openclaw version</code> / <code>npm view clawhub version</code></p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={async () => {
                  setMaintenanceStatusLoading(true);
                  try {
                    const status = await invoke<MaintenanceStatusResult>("get_maintenance_status");
                    setMaintenanceStatus(status);
                  } catch {
                    setMaintenanceStatus(null);
                  } finally {
                    setMaintenanceStatusLoading(false);
                  }
                }}
                disabled={maintenanceBusy}
              >
                {t("バージョン再読込", "Reload Versions")}
              </button>
            </div>
          </article>
        </section>
      )}

      {exitConfirmVisible && (
        <div className="exit-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title">
          <div className="exit-confirm-card">
            <h2 id="exit-confirm-title">{t("OpenClawも停止しますか？", "Stop OpenClaw too?")}</h2>
            <p>
              {t(
                "OpenClaw gateway が起動中、または起動中の可能性があります。easy-openclawを閉じる前に、OpenClaw gatewayも停止できます。",
                "OpenClaw gateway is running or may still be running. You can stop it before closing easy-openclaw.",
              )}
            </p>
            <div className="exit-confirm-status">
              <span>Health: <strong>{snapshot.run_status.health}</strong></span>
              <span>PID: <strong>{snapshot.run_status.pid ?? "-"}</strong></span>
              <span>PortInUse: <strong>{snapshot.run_status.port_in_use ? "yes" : "no"}</strong></span>
            </div>
            <div className="exit-confirm-actions">
              <button type="button" className="run-stop-btn" onClick={() => closeAppAfterDecision(true)} disabled={exitBusy}>
                {exitBusy ? t("停止して終了中...", "Stopping and closing...") : t("OpenClawも停止して閉じる", "Stop OpenClaw and Close")}
              </button>
              <button type="button" className="secondary-action-btn" onClick={() => closeAppAfterDecision(false)} disabled={exitBusy}>
                {t("easy-openclawだけ閉じる", "Close easy-openclaw Only")}
              </button>
              <button type="button" className="secondary-action-btn" onClick={cancelExitConfirm} disabled={exitBusy}>
                {t("キャンセル", "Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="ec-toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => (
          <div key={item.id} className={`ec-toast ec-toast-${toastLevelClass(item.level)}`}>
            <span className="ec-toast-level">{item.level}</span>
            <span className="ec-toast-message">{item.message}</span>
            <button
              type="button"
              className="ec-toast-close"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== item.id))}
              aria-label="dismiss notification"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
