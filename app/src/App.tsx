import { FormEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import crayfishIcon from "./assets/easyclaw-logo.png";
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

type MaintenanceToolStatus = {
  installed: boolean;
  version?: string | null;
};

type MaintenanceStatusResult = {
  openclaw: MaintenanceToolStatus;
  clawhub: MaintenanceToolStatus;
};

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
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatusResult | null>(null);
  const [maintenanceStatusLoading, setMaintenanceStatusLoading] = useState(false);
  const [providerModelCandidatesDynamic, setProviderModelCandidatesDynamic] = useState<string[]>([]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("easyclaw_ui_lang");
    if (saved === "ja" || saved === "en") {
      setUiLang(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("easyclaw_ui_lang", uiLang);
  }, [uiLang]);

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

  useEffect(() => {
    if (!showModelForm || !useModelDropdown) return;
    let alive = true;
    (async () => {
      try {
        const dynamic = await invoke<string[]>("list_provider_model_candidates", {
          providerType,
          openAiAuthMode: providerType === "open_ai" ? openAiAuthMode : null,
        });
        if (!alive) return;
        const normalized = Array.from(new Set((dynamic ?? []).filter((v) => !!v?.trim())));
        setProviderModelCandidatesDynamic(normalized);
      } catch {
        if (!alive) return;
        setProviderModelCandidatesDynamic([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [showModelForm, useModelDropdown, providerType, openAiAuthMode]);

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
      setNotice(t("clawhub が必要です。`npm install -g clawhub` を実行後、再度検索してください。", "clawhub is required. Run `npm install -g clawhub` and retry."));
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

  async function upsertAgentDraft() {
    const candidateId = agentId.trim() || editingAgentId || "";
    if (!candidateId || !agentModelId) return;
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
    } catch (e) {
      handleCommandError(e);
    }
  }

  useEffect(() => {
    if (!showAgentForm) return;
    const candidateId = agentId.trim() || editingAgentId || "";
    if (!candidateId || !agentModelId) return;
    const timer = setTimeout(() => {
      void upsertAgentDraft();
    }, 500);
    return () => clearTimeout(timer);
  }, [
    showAgentForm,
    editingAgentId,
    agentId,
    agentModelId,
    agentChannelId,
    agentWorkspacePath,
    agentExecSecurity,
    agentExecAsk,
    agentExecAllowlist,
    agentAllowWorkspaceOutsideRead,
    agentAllowWorkspaceOutsideWrite,
    agentRequireAskForDestructive,
    agentProtectSecretFiles,
    agentAllowGitPush,
    agentAllowSystemWrite,
    agentBrowserEnabled,
    agentBrowserAllowedDomains,
    agentBrowserAskBeforeNavigation,
  ]);

  async function onDeleteAgent(id: string) {
    setError("");
    setNotice("");
    try {
      await invoke("delete_agent", { agentId: id });
      await refresh();
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
      if (currentModels.channels.length === 0) {
        issues.push({ section: "Channels", message: t("チャンネルを1つ以上追加してください。", "Add at least one channel.") });
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
      const result = await invoke<{ config_path: string; env_path: string; approvals_path: string }>("apply_config", {
        input: { target_dir: null },
      });
      setNotice(t(`設定を出力しました: ${result.config_path} / ${result.approvals_path}`, `Configuration exported: ${result.config_path} / ${result.approvals_path}`));
      setGatewayInitialized(false);
      await refresh();
      await refreshResolvedPaths();
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onStart() {
    setError("");
    setNotice("");
    try {
      await invoke("start_gateway", {
        input: {
          mode: runMode,
          health_timeout_sec: 20,
        },
      });
      await refresh();
      setNotice(t("gatewayを起動しました。", "Gateway started."));
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onStop() {
    setError("");
    setNotice("");
    try {
      await invoke("stop_gateway");
      await refresh();
      setNotice(t("gatewayを停止しました。", "Gateway stopped."));
    } catch (e) {
      handleCommandError(e);
    }
  }

  async function onOpenDashboard() {
    setError("");
    try {
      await openUrl(snapshot.run_status.dashboard_url);
    } catch (e) {
      handleCommandError(e);
    }
  }

  function dashboardUrlWithToken(): string {
    const token =
      (snapshot.gateway.mode === "remote"
        ? snapshot.gateway.remote_token
        : snapshot.gateway.auth_token) ?? "";
    const trimmed = token.trim();
    if (!trimmed) return snapshot.run_status.dashboard_url;
    try {
      const url = new URL(snapshot.run_status.dashboard_url);
      url.hash = `token=${encodeURIComponent(trimmed)}`;
      return url.toString();
    } catch {
      return snapshot.run_status.dashboard_url;
    }
  }

  async function onOpenDashboardWithToken() {
    setError("");
    try {
      await openUrl(dashboardUrlWithToken());
    } catch (e) {
      handleCommandError(e);
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

  async function onRunMaintenanceCommand(command: "install_openclaw" | "install_clawhub") {
    setError("");
    setNotice("");
    setMaintenanceBusy(true);
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
    }
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>EasyClaw</h1>
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
          <img className="brand-icon" src={crayfishIcon} alt="EasyClaw logo" />
        </div>
      </header>

      <nav className="tab-row">
        <button onClick={() => setActiveTab("setup")} className={activeTab === "setup" ? "active" : ""}>{t("設定", "Setup")}</button>
        <button onClick={() => setActiveTab("run")} className={activeTab === "run" ? "active" : ""}>Run</button>
        <button onClick={() => setActiveTab("diagnostics")} className={activeTab === "diagnostics" ? "active" : ""}>{t("診断", "Diagnostics")}</button>
        <button onClick={() => setActiveTab("maintenance")} className={activeTab === "maintenance" ? "active" : ""}>
          {t("インストール", "Install")}
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
          <article className="panel">
            <div className="panel-head">
              <h2>Models</h2>
              <button type="button" onClick={onOpenCreateModel} disabled={isModelEditing}>{t("モデルを追加", "Add Model")}</button>
            </div>
            <p className="rule-note">
              {t("Model変更はドラフトとして保持され、ファイルへの保存はApply時に行います。", "Model changes stay in draft and are written to files on Apply.")}
            </p>
            {modelOptions.length === 0 ? (
              <p className="empty-state">{t("現在のモデルはありません。", "No models configured.")}</p>
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
            {snapshot.channels.length === 0 ? (
              <p className="empty-state">{t("現在のチャンネルはありません。", "No channels configured.")}</p>
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
            {snapshot.agents.length === 0 ? (
              <p className="empty-state">{t("現在のエージェントはありません。", "No agents configured.")}</p>
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
            <div className="form-grid">
              <label>
                Gateway Mode
                <select className="form-select" value={gatewayMode} onChange={(e) => setGatewayMode(e.target.value as GatewayMode)}>
                  <option value="local">{t("Local (この端末で起動)", "Local (run on this device)")}</option>
                  <option value="remote">{t("Remote/VPS (外部gatewayへ接続)", "Remote/VPS (connect to external gateway)")}</option>
                </select>
              </label>
              {gatewayMode === "local" && (
                <>
                  <label>
                    Bind
                    <select className="form-select" value={gatewayBind} onChange={(e) => setGatewayBind(e.target.value)}>
                      <option value="loopback">loopback</option>
                      <option value="lan">lan</option>
                      <option value="tailnet">tailnet</option>
                      <option value="auto">auto</option>
                      <option value="custom">custom</option>
                    </select>
                  </label>
                  <label>
                    Port
                    <input className="form-control" type="number" min={1} max={65535} value={gatewayPort} onChange={(e) => setGatewayPort(e.target.value)} />
                  </label>
                  <label className="full-row">
                    Auth
                    <div className="inline-row">
                      <select className="form-select" value={gatewayAuthMode} onChange={(e) => setGatewayAuthMode(e.target.value)}>
                        <option value="token">token</option>
                        <option value="password">password</option>
                      </select>
                      <div className="input-with-button">
                        <input
                          className="form-control"
                          type={showGatewayAuthToken ? "text" : "password"}
                          value={gatewayAuthToken}
                          onChange={(e) => setGatewayAuthToken(e.target.value)}
                          placeholder={gatewayAuthMode === "token" ? "Gateway Token" : "Gateway Password"}
                        />
                        <button type="button" className="toggle-visibility" onClick={() => setShowGatewayAuthToken((v) => !v)}>
                          {showGatewayAuthToken ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>
                  </label>
                  <label>
                    Tailscale
                    <select className="form-select" value={gatewayTailscaleMode} onChange={(e) => setGatewayTailscaleMode(e.target.value)}>
                      <option value="off">off</option>
                      <option value="serve">serve</option>
                      <option value="funnel">funnel</option>
                    </select>
                  </label>
                </>
              )}
              {gatewayMode === "remote" && (
                <>
                  <label className="full-row">
                    Remote URL (VPS)
                    <input className="form-control" value={gatewayRemoteUrl} onChange={(e) => setGatewayRemoteUrl(e.target.value)} placeholder="ws://vps.example.com:18789" />
                  </label>
                  <label className="full-row">
                    Remote Token
                    <div className="input-with-button">
                      <input
                        className="form-control"
                        type={showGatewayRemoteToken ? "text" : "password"}
                        value={gatewayRemoteToken}
                        onChange={(e) => setGatewayRemoteToken(e.target.value)}
                      />
                      <button type="button" className="toggle-visibility" onClick={() => setShowGatewayRemoteToken((v) => !v)}>
                        {showGatewayRemoteToken ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                </>
              )}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <h2>Apply</h2>
              <button type="button" onClick={onApplyConfig}>Apply Config</button>
            </div>
            <p className="path-line">{t("保存先", "Config path")}: <code>{resolvedConfigPath || "(resolving...)"}</code></p>
            <p className="path-line">{t("環境変数", "Env file")}: <code>{resolvedEnvPath || "(resolving...)"}</code></p>
            <p className="path-line">Exec Approvals: <code>{resolvedApprovalsPath || "(resolving...)"}</code></p>
            <p className="rule-note">{t("決定ルール", "Resolution rule")}: `OPENCLAW_CONFIG_PATH` → `OPENCLAW_STATE_DIR/openclaw.json` → `~/.openclaw/openclaw.json`</p>
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
                <select className="form-select" value={providerType} onChange={(e) => {
                  const next = e.target.value as ProviderType;
                  setProviderModelCandidatesDynamic([]);
                  setProviderType(next);
                  const nextDefault =
                    next === "open_ai"
                      ? (openAiAuthMode === "oauth" ? openAiOauthDefaultModel : openAiApiDefaultModel)
                      : providerModelDefaults[next];
                  setProviderModel(nextDefault);
                  if (next !== "open_ai") setOpenAiAuthMode("api_key");
                  if (!providerNeedsApiKey(next, openAiAuthMode)) setProviderApiKey("");
                }}>
                  <option value="open_ai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google</option>
                  <option value="open_router">OpenRouter</option><option value="together">Together</option><option value="groq">Groq</option>
                  <option value="lm_studio">LMStudio</option><option value="ollama">Ollama</option>
                  <option value="compatible">{t("OpenAI互換", "OpenAI Compatible")}</option>
                </select>
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
                </label>
              )}
              <label className="full-row">Base URL<input className="form-control" value={providerBaseUrl} onChange={(e) => setProviderBaseUrl(e.target.value)} placeholder={providerBaseUrlPlaceholder || t("compatibleは入力必須", "required for compatible provider")} /></label>
              {useModelDropdown ? (
                <>
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
                  </label>
                  {selectedModelOption === "__custom__" && (
                    <label className="full-row">
                      {t("カスタムModel Name", "Custom Model Name")}
                      <input className="form-control" value={providerModel} onChange={(e) => setProviderModel(e.target.value)} placeholder={providerModelPlaceholder} />
                    </label>
                  )}
                </>
              ) : (
                <label className="full-row">Model Name<input className="form-control" value={providerModel} onChange={(e) => setProviderModel(e.target.value)} placeholder={providerModelPlaceholder} /></label>
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
              </label>
              <label className="full-row">Account ID<input className="form-control" value={channelAccountId} onChange={(e) => setChannelAccountId(e.target.value.toLowerCase())} placeholder={nextChannelAccountId(channelType)} /></label>
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
                  <label className="full-row">Slack Channels (allowlist)<input className="form-control" value={channelSlackChannels} onChange={(e) => setChannelSlackChannels(e.target.value)} placeholder="C0123456789, C0987654321" /></label>
                  <label className="full-row">
                    Slack Bot Token
                    <div className="input-with-button">
                      <input className="form-control" value={channelSlackBotToken} onChange={(e) => setChannelSlackBotToken(e.target.value)} type={showChannelSlackBotToken ? "text" : "password"} placeholder="xoxb-..." />
                      <button type="button" className="toggle-visibility" onClick={() => setShowChannelSlackBotToken((v) => !v)}>
                        {showChannelSlackBotToken ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                  <label className="full-row">
                    Slack App Token
                    <div className="input-with-button">
                      <input className="form-control" value={channelSlackAppToken} onChange={(e) => setChannelSlackAppToken(e.target.value)} type={showChannelSlackAppToken ? "text" : "password"} placeholder="xapp-..." />
                      <button type="button" className="toggle-visibility" onClick={() => setShowChannelSlackAppToken((v) => !v)}>
                        {showChannelSlackAppToken ? "Hide" : "Show"}
                      </button>
                    </div>
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
            <div className="form-grid">
              <label className="full-row">Agent ID<input className="form-control" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent-main" /></label>
              <p className="rule-note full-row">{t("この画面の変更は自動で反映されます。設定ファイルへの保存は最後に Apply を実行してください。", "Changes in this dialog are auto-applied to draft state. Run Apply to write files.")}</p>
              <label className="full-row">
                Model
                <select className="form-select" value={agentModelId} onChange={(e) => setAgentModelId(e.target.value)}>
                  <option value="">Select Model</option>
                  {modelOptions.map((m) => (<option key={m.id} value={m.id}>{m.model_name}</option>))}
                </select>
              </label>
              <label className="full-row">
                Channel
                <select className="form-select" value={agentChannelId} onChange={(e) => setAgentChannelId(e.target.value)}>
                  <option value="">No Channel</option>
                  {channelOptions.map((c) => (<option key={c.id} value={c.id}>{c.account_id}</option>))}
                </select>
              </label>
              <label className="full-row">
                Workspace
                <div className="input-with-button">
                  <input className="form-control" value={agentWorkspacePath} onChange={(e) => setAgentWorkspacePath(e.target.value)} />
                  <button type="button" onClick={onPickWorkspace}>Browse...</button>
                </div>
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
                  </label>
                  <label>
                    Exec Ask
                    <select className="form-select" value={agentExecAsk} onChange={(e) => setAgentExecAsk(e.target.value as AgentSecuritySettings["exec_ask"])}>
                      <option value="on-miss">{t("on-miss (推奨)", "on-miss (recommended)")}</option>
                      <option value="always">always</option>
                      <option value="off">off</option>
                    </select>
                  </label>
                  <label className="full-row">
                    Agent Exec Allowlist
                    <textarea
                      className="form-control allowlist-textarea"
                      value={agentExecAllowlist}
                      onChange={(e) => setAgentExecAllowlist(e.target.value)}
                      placeholder={"/opt/homebrew/bin/rg\n/opt/homebrew/bin/git\n/bin/sh"}
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label className="checkbox-row"><input type="checkbox" checked={agentAllowWorkspaceOutsideRead} onChange={(e) => setAgentAllowWorkspaceOutsideRead(e.target.checked)} /> {t("Workspace外のreadを許可", "Allow reads outside workspace")}</label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentAllowWorkspaceOutsideWrite} onChange={(e) => setAgentAllowWorkspaceOutsideWrite(e.target.checked)} /> {t("Workspace外のwriteを許可", "Allow writes outside workspace")}</label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentRequireAskForDestructive} onChange={(e) => setAgentRequireAskForDestructive(e.target.checked)} /> {t("破壊操作は常に確認", "Always ask for destructive operations")}</label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentProtectSecretFiles} onChange={(e) => setAgentProtectSecretFiles(e.target.checked)} /> {t("秘密ファイルを保護 (.env/.ssh)", "Protect secret files (.env/.ssh)")}</label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentAllowGitPush} onChange={(e) => setAgentAllowGitPush(e.target.checked)} /> {t("git push を許可", "Allow git push")}</label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentAllowSystemWrite} onChange={(e) => setAgentAllowSystemWrite(e.target.checked)} /> {t("system領域 write を許可 (/usr /etc)", "Allow system writes (/usr /etc)")}</label>
                </div>
                <h4>{t("Browser (Chrome 固定)", "Browser (Chrome only)")}</h4>
                <div className="form-grid">
                  <label className="checkbox-row"><input type="checkbox" checked={agentBrowserEnabled} onChange={(e) => setAgentBrowserEnabled(e.target.checked)} /> {t("Browser ツールを有効化", "Enable browser tool")}</label>
                  <label className="checkbox-row"><input type="checkbox" checked={agentBrowserAskBeforeNavigation} onChange={(e) => setAgentBrowserAskBeforeNavigation(e.target.checked)} /> {t("ページ遷移の前に確認する", "Ask before page navigation")}</label>
                  <label className="full-row">
                    {t("Allowed Domains (1行1ドメイン / 空なら制限なし)", "Allowed Domains (one per line / empty = no restriction)")}
                    <textarea
                      className="form-control allowlist-textarea"
                      value={agentBrowserAllowedDomains}
                      onChange={(e) => setAgentBrowserAllowedDomains(e.target.value)}
                      placeholder={"openai.com\nslack.com\ngithub.com"}
                    />
                  </label>
                </div>
              </div>
              <div className="full-row channel-help">
                <h4>Skills</h4>
                <p className="rule-note">Workspace: <code>{agentWorkspacePath || "."}</code></p>
                <p className="rule-note">{t("インストール済みスキル一覧", "Installed skills")}</p>
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
            </div>
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
              </label>
              <button className="run-action-btn run-start-btn" onClick={onStart} disabled={!snapshot.run_status.can_start} title={snapshot.run_status.start_disabled_reason ?? ""}>
                Start
              </button>
              <button className="run-action-btn run-stop-btn" onClick={onStop} disabled={!snapshot.run_status.can_stop} title={snapshot.run_status.stop_disabled_reason ?? ""}>
                Stop
              </button>
              <button className="run-action-btn" onClick={onOpenDashboard}>Open Dashboard</button>
              <button className="run-action-btn" onClick={onOpenDashboardWithToken}>Open Dashboard (Token URL)</button>
            </div>
            <p className="rule-note">{t("推奨: App Parent（EasyClawが親プロセスとしてgateway起動）", "Recommended: App Parent (EasyClaw starts gateway as parent process)")}</p>
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
              <h2>{t("OpenClaw / Clawhub インストール", "OpenClaw / Clawhub Install")}</h2>
            </div>
            <p className="rule-note">
              {t(
                "ボタンを押すとTerminalを開いて npm install -g を実行します。",
                "Buttons open Terminal and run npm install -g.",
              )}
            </p>
            <table className="list-table">
              <thead>
                <tr>
                  <th>{t("ソフトウェア", "Software")}</th>
                  <th>{t("説明", "Description")}</th>
                  <th>{t("インストール状況", "Installed Version")}</th>
                  <th>{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>OpenClaw</td>
                  <td>{t("エージェント実行とGateway連携の本体CLI", "Core CLI for agent runtime and gateway integration")}</td>
                  <td>
                    {maintenanceStatusLoading || !maintenanceStatus
                      ? t("確認中", "Checking...")
                      : maintenanceStatus?.openclaw.installed
                      ? (maintenanceStatus?.openclaw.version ?? "installed")
                      : t("未インストール", "Not installed")}
                  </td>
                  <td className="action-cell">
                    <button
                      type="button"
                      className="table-action-btn action-edit"
                      disabled={maintenanceBusy}
                      onClick={() => onRunMaintenanceCommand("install_openclaw")}
                    >
                      {t("インストール/更新", "Install/Update")}
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>Clawhub</td>
                  <td>{t("スキル検索・配布連携を行うCLI", "CLI for skill discovery and distribution integration")}</td>
                  <td>
                    {maintenanceStatusLoading || !maintenanceStatus
                      ? t("確認中", "Checking...")
                      : maintenanceStatus?.clawhub.installed
                      ? (maintenanceStatus?.clawhub.version ?? "installed")
                      : t("未インストール", "Not installed")}
                  </td>
                  <td className="action-cell">
                    <button
                      type="button"
                      className="table-action-btn action-edit"
                      disabled={maintenanceBusy}
                      onClick={() => onRunMaintenanceCommand("install_clawhub")}
                    >
                      {t("インストール/更新", "Install/Update")}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="rule-note"><code>npm install -g openclaw@latest</code> / <code>npm install -g clawhub@latest</code></p>
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
