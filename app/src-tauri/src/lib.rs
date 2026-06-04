use rand::distr::{Alphanumeric, SampleString};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use thiserror::Error;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ProviderType {
    OpenAi,
    Anthropic,
    Google,
    OpenRouter,
    Together,
    Groq,
    Compatible,
    Ollama,
    LmStudio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum OpenAiAuthMode {
    ApiKey,
    Oauth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ChannelType {
    Slack,
    Discord,
    Telegram,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RunMode {
    A,
    B,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum GatewayMode {
    Local,
    Remote,
}

fn default_true() -> bool {
    true
}

fn default_exec_security() -> String {
    "allowlist".into()
}

fn default_exec_ask() -> String {
    "on-miss".into()
}

fn default_execution_allowlist() -> Vec<String> {
    vec![
        "/opt/homebrew/bin/rg".into(),
        "/usr/bin/rg".into(),
        "/opt/homebrew/bin/git".into(),
        "/usr/bin/git".into(),
        "/bin/sh".into(),
        "/bin/bash".into(),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GatewaySettings {
    mode: GatewayMode,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    bind: Option<String>,
    #[serde(default)]
    auth_mode: Option<String>,
    #[serde(default)]
    auth_token: Option<String>,
    #[serde(default)]
    remote_url: Option<String>,
    #[serde(default)]
    remote_token: Option<String>,
    #[serde(default)]
    tailscale_mode: Option<String>,
}

impl Default for GatewaySettings {
    fn default() -> Self {
        Self {
            mode: GatewayMode::Local,
            port: Some(18789),
            bind: Some("loopback".into()),
            auth_mode: Some("token".into()),
            auth_token: None,
            remote_url: None,
            remote_token: None,
            tailscale_mode: Some("off".into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExecutionPolicySettings {
    host: String,
    security: String,
    ask: String,
    #[serde(default)]
    node: Option<String>,
}

impl Default for ExecutionPolicySettings {
    fn default() -> Self {
        Self {
            host: "gateway".into(),
            security: "allowlist".into(),
            ask: "on-miss".into(),
            node: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelCatalogItem {
    id: String,
    provider_type: ProviderType,
    base_url: Option<String>,
    #[serde(alias = "default_model")]
    model_name: String,
    #[serde(default)]
    openai_auth_mode: Option<OpenAiAuthMode>,
    api_key_ref: Option<String>,
    connection_options: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Channel {
    id: String,
    #[serde(default)]
    account_id: String,
    #[serde(default)]
    slack_channels: Vec<String>,
    #[serde(default)]
    display_name: Option<String>,
    channel_type: ChannelType,
    #[serde(default)]
    slack_bot_token_ref: Option<String>,
    #[serde(default)]
    slack_app_token_ref: Option<String>,
    #[serde(default)]
    slack_signing_secret_ref: Option<String>,
    #[serde(default)]
    discord_bot_token_ref: Option<String>,
    #[serde(default)]
    telegram_bot_token_ref: Option<String>,
    #[serde(default, alias = "credential_ref")]
    legacy_credential_ref: Option<String>,
    owner_agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentSecuritySettings {
    #[serde(default = "default_exec_security")]
    exec_security: String,
    #[serde(default = "default_exec_ask")]
    exec_ask: String,
    #[serde(default)]
    exec_allowlist: Vec<String>,
    #[serde(default = "default_true")]
    allow_workspace_outside_read: bool,
    #[serde(default)]
    allow_workspace_outside_write: bool,
    #[serde(default = "default_true")]
    require_ask_for_destructive: bool,
    #[serde(default = "default_true")]
    protect_secret_files: bool,
    #[serde(default)]
    allow_git_push: bool,
    #[serde(default)]
    allow_system_write: bool,
    #[serde(default = "default_true")]
    browser_enabled: bool,
    #[serde(default)]
    browser_allowed_domains: Vec<String>,
    #[serde(default = "default_true")]
    browser_ask_before_navigation: bool,
}

impl Default for AgentSecuritySettings {
    fn default() -> Self {
        Self {
            exec_security: default_exec_security(),
            exec_ask: default_exec_ask(),
            exec_allowlist: vec![],
            allow_workspace_outside_read: true,
            allow_workspace_outside_write: false,
            require_ask_for_destructive: true,
            protect_secret_files: true,
            allow_git_push: false,
            allow_system_write: false,
            browser_enabled: true,
            browser_allowed_domains: vec![],
            browser_ask_before_navigation: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Agent {
    id: String,
    display_name: String,
    #[serde(alias = "provider_id")]
    model_id: String,
    model_override: Option<String>,
    #[serde(alias = "channel_id")]
    channel_id: Option<String>,
    #[serde(default)]
    workspace_path: Option<String>,
    #[serde(default)]
    security: AgentSecuritySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BindingRule {
    agent_id: String,
    channel_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExperimentRecord {
    id: String,
    case_id: String,
    mode: RunMode,
    result: String,
    observed_error: Option<String>,
    note: Option<String>,
    recorded_at: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct PersistedState {
    #[serde(default, alias = "providers")]
    models: Vec<ModelCatalogItem>,
    channels: Vec<Channel>,
    agents: Vec<Agent>,
    #[serde(default)]
    bindings: Vec<BindingRule>,
    experiments: Vec<ExperimentRecord>,
    #[serde(default)]
    gateway: GatewaySettings,
    #[serde(default)]
    execution_policy: ExecutionPolicySettings,
    #[serde(default = "default_execution_allowlist")]
    execution_allowlist: Vec<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct SecretStore {
    items: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LogLine {
    ts: String,
    level: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RunStatus {
    mode: RunMode,
    running: bool,
    pid: Option<u32>,
    health: String,
    dashboard_url: String,
    port_in_use: bool,
    can_start: bool,
    can_stop: bool,
    start_disabled_reason: Option<String>,
    stop_disabled_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Snapshot {
    models: Vec<ModelCatalogItem>,
    channels: Vec<Channel>,
    agents: Vec<Agent>,
    bindings: Vec<BindingRule>,
    gateway: GatewaySettings,
    execution_policy: ExecutionPolicySettings,
    execution_allowlist: Vec<String>,
    run_status: RunStatus,
}

#[derive(Debug, Serialize)]
struct ChannelSecretValues {
    slack_bot_token: Option<String>,
    slack_app_token: Option<String>,
    slack_signing_secret: Option<String>,
    discord_bot_token: Option<String>,
    telegram_bot_token: Option<String>,
}

#[derive(Debug, Serialize)]
struct OpenAiOauthLoginResult {
    summary: String,
}

#[derive(Debug, Serialize)]
struct MaintenanceCommandResult {
    summary: String,
}

#[derive(Debug, Serialize)]
struct MaintenanceToolStatus {
    installed: bool,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
struct MaintenanceStatusResult {
    openclaw: MaintenanceToolStatus,
    clawhub: MaintenanceToolStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum MaintenanceCommand {
    CheckOpenclawUpdate,
    CheckClawhubUpdate,
}

#[derive(Debug, Deserialize)]
struct OpenClawModelsListJson {
    #[serde(default)]
    models: Vec<OpenClawModelListItem>,
}

#[derive(Debug, Deserialize)]
struct OpenClawModelListItem {
    key: String,
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(not(target_os = "windows"))]
fn sh_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "windows")]
fn cmd_double_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn apply_command_platform_flags(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

#[derive(Debug, Deserialize)]
struct CreateModelInput {
    provider_type: ProviderType,
    base_url: Option<String>,
    model_name: String,
    openai_auth_mode: Option<OpenAiAuthMode>,
    api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateModelInput {
    id: String,
    provider_type: ProviderType,
    base_url: Option<String>,
    model_name: String,
    openai_auth_mode: Option<OpenAiAuthMode>,
    api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateChannelInput {
    channel_type: ChannelType,
    account_id: Option<String>,
    #[serde(default)]
    slack_channels: Option<Vec<String>>,
    display_name: Option<String>,
    slack_bot_token: Option<String>,
    slack_app_token: Option<String>,
    slack_signing_secret: Option<String>,
    discord_bot_token: Option<String>,
    telegram_bot_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateChannelInput {
    id: String,
    channel_type: ChannelType,
    account_id: Option<String>,
    #[serde(default)]
    slack_channels: Option<Vec<String>>,
    display_name: Option<String>,
    slack_bot_token: Option<String>,
    slack_app_token: Option<String>,
    slack_signing_secret: Option<String>,
    discord_bot_token: Option<String>,
    telegram_bot_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpsertAgentInput {
    id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(alias = "provider_id")]
    model_id: String,
    model_override: Option<String>,
    channel_id: Option<String>,
    workspace_path: Option<String>,
    #[serde(default)]
    security: Option<AgentSecuritySettings>,
    #[serde(alias = "force_reassign")]
    force_rebind: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ApplyConfigInput {
    target_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SetGatewayConfigInput {
    mode: GatewayMode,
    port: Option<u16>,
    bind: Option<String>,
    auth_mode: Option<String>,
    auth_token: Option<String>,
    remote_url: Option<String>,
    remote_token: Option<String>,
    tailscale_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SetExecutionPolicyInput {
    host: String,
    security: String,
    ask: String,
    node: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SetExecutionAllowlistInput {
    #[serde(default)]
    patterns: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ApplyConfigResult {
    config_path: String,
    env_path: String,
    approvals_path: String,
}

#[derive(Debug, Serialize)]
struct ResolvedConfigPaths {
    config_path: String,
    env_path: String,
    approvals_path: String,
}

#[derive(Debug, Deserialize)]
struct StartGatewayInput {
    mode: RunMode,
    health_timeout_sec: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct WorkspaceSkillsInput {
    workspace_path: String,
}

#[derive(Debug, Deserialize)]
struct SearchClawhubSkillsInput {
    query: String,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct InstallWorkspaceSkillInput {
    workspace_path: String,
    slug: String,
}

#[derive(Debug, Deserialize)]
struct ExperimentInput {
    case_id: String,
    mode: RunMode,
    result: String,
    observed_error: Option<String>,
    note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct WorkspaceSkillItem {
    slug: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
struct ClawhubSkillItem {
    slug: String,
    title: String,
    summary: String,
}

struct RunState {
    child: Option<Child>,
    mode: RunMode,
    dashboard_url: String,
    health: String,
}

impl Default for RunState {
    fn default() -> Self {
        Self {
            child: None,
            mode: RunMode::A,
            dashboard_url: default_dashboard_url(),
            health: "stopped".to_string(),
        }
    }
}

struct AppState {
    persisted: Mutex<PersistedState>,
    secrets: Mutex<SecretStore>,
    run_state: Mutex<RunState>,
    logs: Arc<Mutex<VecDeque<LogLine>>>,
    data_dir: PathBuf,
}

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Serialize)]
struct CommandError {
    code: String,
    message: String,
}

impl From<AppError> for CommandError {
    fn from(value: AppError) -> Self {
        Self {
            code: "ERR-ECLAW-0000".into(),
            message: value.to_string(),
        }
    }
}

fn err(code: &str, message: &str) -> CommandError {
    CommandError {
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn strip_ansi_sequences(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            while let Some(next) = chars.next() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }
        if ch == '\r' {
            continue;
        }
        if ch.is_control() && ch != '\n' && ch != '\t' {
            continue;
        }
        out.push(ch);
    }
    out
}

fn extract_cli_error_detail(stdout: &str, stderr: &str) -> Option<String> {
    let stdout_clean = strip_ansi_sequences(stdout);
    let stderr_clean = strip_ansi_sequences(stderr);
    for source in [&stderr_clean, &stdout_clean] {
        if let Some(line) = source
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .rev()
            .find(|line| line.starts_with("Error:"))
        {
            return Some(line.to_string());
        }
    }
    for source in [&stderr_clean, &stdout_clean] {
        if let Some(line) = source
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .rev()
            .next()
        {
            return Some(line.to_string());
        }
    }
    None
}

fn now_ts() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    format!("{}", d.as_secs())
}

fn gen_id(prefix: &str) -> String {
    let mut rng = rand::rng();
    let rand = Alphanumeric.sample_string(&mut rng, 8).to_lowercase();
    format!("{}-{}-{}", prefix, now_ts(), rand)
}

fn default_dashboard_url() -> String {
    std::env::var("OPENCLAW_DASHBOARD_URL").unwrap_or_else(|_| "http://127.0.0.1:18789".into())
}

fn dashboard_url_from_gateway(gateway: &GatewaySettings) -> String {
    if let Ok(v) = std::env::var("OPENCLAW_DASHBOARD_URL") {
        if !v.trim().is_empty() {
            return v;
        }
    }

    match gateway.mode {
        GatewayMode::Local => format!("http://127.0.0.1:{}", gateway.port.unwrap_or(18789)),
        GatewayMode::Remote => {
            if let Some(url) = gateway
                .remote_url
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                if let Ok(parsed) = Url::parse(url) {
                    let scheme = match parsed.scheme() {
                        "wss" => "https",
                        "ws" => "http",
                        other => other,
                    };
                    let host = parsed.host_str().unwrap_or("127.0.0.1");
                    let mut out = format!("{scheme}://{host}");
                    if let Some(port) = parsed.port() {
                        out.push(':');
                        out.push_str(&port.to_string());
                    }
                    return out;
                }
            }
            "http://127.0.0.1:18789".into()
        }
    }
}

fn data_dir() -> PathBuf {
    if let Ok(v) = std::env::var("EASY_OPENCLAW_DATA_DIR") {
        return PathBuf::from(v);
    }
    if let Ok(v) = std::env::var("EASYCLAW_DATA_DIR") {
        return PathBuf::from(v);
    }
    if let Ok(v) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(v).join("easy-openclaw");
    }
    if let Ok(v) = std::env::var("APPDATA") {
        return PathBuf::from(v).join("easy-openclaw");
    }
    if let Ok(v) = std::env::var("USERPROFILE") {
        return PathBuf::from(v).join(".easy-openclaw-data");
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".easy-openclaw-data");
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".easy-openclaw-data")
}

fn state_file(root: &Path) -> PathBuf {
    root.join("state.json")
}

fn secret_file(root: &Path) -> PathBuf {
    root.join("secrets.json")
}

fn default_workspace_dir() -> PathBuf {
    data_dir().join("workspace")
}

fn parse_env_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let without_export = trimmed.strip_prefix("export ").unwrap_or(trimmed);
    let (key_raw, value_raw) = without_export.split_once('=')?;
    let key = key_raw.trim();
    if key.is_empty() {
        return None;
    }

    let mut value = value_raw.trim().to_string();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value = value[1..value.len() - 1].to_string();
    }

    Some((key.to_string(), value))
}

fn load_env_file(path: &Path) -> HashMap<String, String> {
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };

    text.lines().filter_map(parse_env_line).collect()
}

fn write_atomic(path: &Path, content: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::Message(format!("failed to create dir: {e}")))?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| AppError::Message(format!("failed to create temp file: {e}")))?;
        f.write_all(content.as_bytes())
            .map_err(|e| AppError::Message(format!("failed to write temp file: {e}")))?;
        f.sync_all()
            .map_err(|e| AppError::Message(format!("failed to sync temp file: {e}")))?;
    }
    fs::rename(&tmp, path)
        .map_err(|e| AppError::Message(format!("failed to rename temp file: {e}")))?;
    Ok(())
}

fn workspace_path_from_agent(agent: &Agent) -> PathBuf {
    let raw = agent
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(".");
    if raw == "." {
        return default_workspace_dir();
    }
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn resolve_workspace_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "." {
        return default_workspace_dir();
    }
    let path = PathBuf::from(if trimmed.is_empty() { "." } else { trimmed });
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn check_clawhub_installed() -> Result<(), CommandError> {
    let bin = clawhub_bin();
    let mut cmd = Command::new(bin);
    cmd.arg("--cli-version");
    apply_command_platform_flags(&mut cmd);
    let output = cmd
        .output()
        .map_err(|_| err("ERR-ECLAW-0100", "clawhub の確認に失敗しました。"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(err(
            "ERR-ECLAW-0100",
            "clawhub が見つかりません。easy-openclaw を再インストールしてください。",
        ))
    }
}

fn list_workspace_skills_internal(workspace_path: &Path) -> Result<Vec<WorkspaceSkillItem>, CommandError> {
    let skill_root = workspace_path.join("skills");
    if !skill_root.exists() {
        return Ok(vec![]);
    }
    let entries = fs::read_dir(&skill_root)
        .map_err(|_| err("ERR-ECLAW-0101", "skills ディレクトリを読み込めません。"))?;
    let mut items = vec![];
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }
        let slug = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("unknown")
            .to_string();
        items.push(WorkspaceSkillItem {
            slug,
            path: path.display().to_string(),
        });
    }
    items.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(items)
}

fn parse_clawhub_search_stdout(stdout: &str) -> Vec<ClawhubSkillItem> {
    let mut out = vec![];
    let mut seen = HashSet::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("search")
            || lower.starts_with("found")
            || lower.starts_with("results")
            || lower.starts_with("use ")
            || lower.starts_with("tip:")
        {
            continue;
        }
        let token = trimmed
            .trim_start_matches(|c: char| c == '-' || c == '*' || c.is_ascii_digit() || c == '.' || c == ')')
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_matches(|c: char| c == '`' || c == ':' || c == ',');
        if token.is_empty() {
            continue;
        }
        if !token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            continue;
        }
        if !seen.insert(token.to_string()) {
            continue;
        }
        out.push(ClawhubSkillItem {
            slug: token.to_string(),
            title: token.to_string(),
            summary: trimmed.to_string(),
        });
    }
    out
}

fn ensure_workspace_bootstrap_files(persisted: &PersistedState) -> Result<Vec<String>, AppError> {
    let mut created = vec![];
    let mut visited = HashSet::new();
    let bootstrap_text = r#"# BOOTSTRAP.md

This workspace was initialized by easy-openclaw.

1. Confirm your agent setup and tool access.
2. Keep secrets in environment variables, not markdown files.
3. Remove this file after onboarding if you no longer need it.
"#;

    for agent in &persisted.agents {
        let workspace = workspace_path_from_agent(agent);
        let key = workspace.display().to_string();
        if visited.contains(&key) {
            continue;
        }
        visited.insert(key.clone());

        let bootstrap_path = workspace.join("BOOTSTRAP.md");
        if bootstrap_path.exists() {
            continue;
        }

        fs::create_dir_all(&workspace)
            .map_err(|e| AppError::Message(format!("failed to create workspace dir {key}: {e}")))?;
        fs::write(&bootstrap_path, bootstrap_text)
            .map_err(|e| AppError::Message(format!("failed to write BOOTSTRAP.md for workspace {key}: {e}")))?;
        if bootstrap_path.exists() {
            created.push(bootstrap_path.display().to_string());
        }
    }
    Ok(created)
}

fn persist(state: &AppState) -> Result<(), AppError> {
    let persisted = state
        .persisted
        .lock()
        .map_err(|_| AppError::Message("state lock poisoned".into()))?
        .clone();
    let secrets = state
        .secrets
        .lock()
        .map_err(|_| AppError::Message("secret lock poisoned".into()))?
        .clone();

    let persisted_json = serde_json::to_string_pretty(&persisted)
        .map_err(|e| AppError::Message(format!("failed to serialize state: {e}")))?;
    let secrets_json = serde_json::to_string_pretty(&secrets)
        .map_err(|e| AppError::Message(format!("failed to serialize secret: {e}")))?;

    write_atomic(&state_file(&state.data_dir), &persisted_json)?;
    write_atomic(&secret_file(&state.data_dir), &secrets_json)?;
    Ok(())
}

fn load_or_default(root: &Path) -> (PersistedState, SecretStore) {
    let _ = fs::create_dir_all(root);

    let legacy_roots = std::env::current_dir()
        .map(|v| vec![v.join(".easyclaw-data"), v.join(".easy-openclaw-data")])
        .unwrap_or_default();
    for legacy_root in legacy_roots {
        if legacy_root != root {
            let legacy_state = state_file(&legacy_root);
            let legacy_secret = secret_file(&legacy_root);
            let target_state = state_file(root);
            let target_secret = secret_file(root);

            if !target_state.exists() && legacy_state.exists() {
                let _ = fs::create_dir_all(root);
                let _ = fs::copy(&legacy_state, &target_state);
            }
            if !target_secret.exists() && legacy_secret.exists() {
                let _ = fs::create_dir_all(root);
                let _ = fs::copy(&legacy_secret, &target_secret);
            }
        }
    }

    let persisted = fs::read_to_string(state_file(root))
        .ok()
        .and_then(|v| serde_json::from_str::<PersistedState>(&v).ok())
        .unwrap_or_default();

    let secrets = fs::read_to_string(secret_file(root))
        .ok()
        .and_then(|v| serde_json::from_str::<SecretStore>(&v).ok())
        .unwrap_or_default();

    let (mut persisted, secrets) = load_from_openclaw_files(persisted, secrets);
    if persisted.execution_allowlist.is_empty() {
        persisted.execution_allowlist = default_execution_allowlist();
    }
    for agent in &mut persisted.agents {
        if agent.security.exec_security.trim().is_empty() {
            agent.security.exec_security = persisted.execution_policy.security.clone();
        }
        if agent.security.exec_ask.trim().is_empty() {
            agent.security.exec_ask = persisted.execution_policy.ask.clone();
        }
        if agent.security.exec_allowlist.is_empty() {
            agent.security.exec_allowlist = persisted.execution_allowlist.clone();
        }
    }
    (persisted, secrets)
}

fn parse_json_like_file(path: &Path) -> Option<serde_json::Value> {
    let text = fs::read_to_string(path).ok()?;
    json5::from_str(&text)
        .or_else(|_| serde_json::from_str(&text))
        .ok()
}

fn sanitize_id_fragment(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn parse_provider_type_from_key(provider_key: &str) -> ProviderType {
    let key = provider_key.to_ascii_lowercase();
    if key.starts_with("openai") {
        ProviderType::OpenAi
    } else if key.starts_with("anthropic") {
        ProviderType::Anthropic
    } else if key.starts_with("google") {
        ProviderType::Google
    } else if key.starts_with("openrouter") {
        ProviderType::OpenRouter
    } else if key.starts_with("together") {
        ProviderType::Together
    } else if key.starts_with("groq") {
        ProviderType::Groq
    } else if key.starts_with("ollama") {
        ProviderType::Ollama
    } else if key.starts_with("lmstudio") {
        ProviderType::LmStudio
    } else {
        ProviderType::Compatible
    }
}

fn parse_env_ref(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.starts_with("${") && trimmed.ends_with('}') && trimmed.len() >= 4 {
        Some(trimmed[2..trimmed.len() - 1].to_string())
    } else {
        None
    }
}

fn load_from_openclaw_files(
    fallback_persisted: PersistedState,
    fallback_secrets: SecretStore,
) -> (PersistedState, SecretStore) {
    let (config_path, env_path) = resolve_apply_paths(None);
    if !config_path.exists() {
        return (fallback_persisted, fallback_secrets);
    }

    let Some(config) = parse_json_like_file(&config_path) else {
        return (fallback_persisted, fallback_secrets);
    };
    let env_vars = load_env_file(&env_path);
    let approvals_path = resolve_approvals_path(&config_path);
    let approvals = parse_json_like_file(&approvals_path);
    let fallback_agent_security: HashMap<String, AgentSecuritySettings> = fallback_persisted
        .agents
        .iter()
        .map(|a| (a.id.clone(), a.security.clone()))
        .collect();

    let mut persisted = PersistedState::default();
    let mut secrets = SecretStore::default();

    if let Some(gateway) = config.get("gateway") {
        let mode = gateway
            .get("mode")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("local");
        persisted.gateway = if mode == "remote" {
            GatewaySettings {
                mode: GatewayMode::Remote,
                port: None,
                bind: None,
                auth_mode: None,
                auth_token: None,
                remote_url: gateway
                    .pointer("/remote/url")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                remote_token: gateway
                    .pointer("/remote/token")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                tailscale_mode: None,
            }
        } else {
            GatewaySettings {
                mode: GatewayMode::Local,
                port: gateway
                    .get("port")
                    .and_then(serde_json::Value::as_u64)
                    .map(|v| v as u16)
                    .or(Some(18789)),
                bind: gateway
                    .get("bind")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .or(Some("loopback".into())),
                auth_mode: gateway
                    .pointer("/auth/mode")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .or(Some("token".into())),
                auth_token: gateway
                    .pointer("/auth/token")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                remote_url: None,
                remote_token: None,
                tailscale_mode: gateway
                    .pointer("/tailscale/mode")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .or(Some("off".into())),
            }
        };
    }

    if let Some(exec) = config.pointer("/tools/exec") {
        let host = exec
            .get("host")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("gateway");
        let security = exec
            .get("security")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("allowlist");
        let ask = exec
            .get("ask")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("on-miss");
        persisted.execution_policy = ExecutionPolicySettings {
            host: host.to_string(),
            security: security.to_string(),
            ask: ask.to_string(),
            node: exec
                .get("node")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
        };
    }

    if let Some(main_allowlist) = approvals
        .as_ref()
        .and_then(|v| v.pointer("/agents/main/allowlist"))
        .and_then(serde_json::Value::as_array)
    {
        persisted.execution_allowlist = main_allowlist
            .iter()
            .filter_map(|entry| {
                if let Some(pattern) = entry.get("pattern").and_then(serde_json::Value::as_str) {
                    return Some(pattern.to_string());
                }
                entry.as_str().map(str::to_string)
            })
            .collect();
    }

    let mut agent_security_map: HashMap<String, AgentSecuritySettings> = HashMap::new();
    if let Some(agent_entries) = approvals
        .as_ref()
        .and_then(|v| v.get("agents"))
        .and_then(serde_json::Value::as_object)
    {
        for (agent_id, raw) in agent_entries {
            if agent_id == "main" {
                continue;
            }
            let Some(obj) = raw.as_object() else {
                continue;
            };
            let mut security = AgentSecuritySettings::default();
            security.exec_security = obj
                .get("security")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("allowlist")
                .to_string();
            security.exec_ask = obj
                .get("ask")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("on-miss")
                .to_string();
            security.exec_allowlist = obj
                .get("allowlist")
                .and_then(serde_json::Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|entry| {
                            if let Some(pattern) =
                                entry.get("pattern").and_then(serde_json::Value::as_str)
                            {
                                return Some(pattern.to_string());
                            }
                            entry.as_str().map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            agent_security_map.insert(agent_id.to_string(), security);
        }
    }

    let mut model_ref_to_id: HashMap<String, String> = HashMap::new();
    if let Some(providers) = config
        .pointer("/models/providers")
        .and_then(serde_json::Value::as_object)
    {
        for (provider_key, provider_val) in providers {
            let provider_type = parse_provider_type_from_key(provider_key);
            let base_url = provider_val
                .get("baseUrl")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            let model_name = provider_val
                .pointer("/models/0/id")
                .or_else(|| provider_val.pointer("/models/0/name"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown-model")
                .to_string();

            let model_id = format!("model-import-{}", sanitize_id_fragment(provider_key));
            let mut model = ModelCatalogItem {
                id: model_id.clone(),
                provider_type: provider_type.clone(),
                base_url,
                model_name: model_name.clone(),
                openai_auth_mode: if provider_key
                    .to_ascii_lowercase()
                    .starts_with("openai-codex")
                {
                    Some(OpenAiAuthMode::Oauth)
                } else {
                    normalize_openai_auth_mode(&provider_type, None)
                },
                api_key_ref: None,
                connection_options: HashMap::new(),
            };

            if let Some(api_key_raw) = provider_val.get("apiKey").and_then(serde_json::Value::as_str)
            {
                let resolved = parse_env_ref(api_key_raw)
                    .and_then(|env_key| env_vars.get(&env_key).cloned())
                    .or_else(|| {
                        if api_key_raw.starts_with("${") {
                            None
                        } else {
                            Some(api_key_raw.to_string())
                        }
                    });
                if let Some(api_key) = resolved {
                    let ref_key = format!("secret-provider-{}", model_id);
                    secrets.items.insert(ref_key.clone(), api_key);
                    model.api_key_ref = Some(ref_key);
                }
            }

            model_ref_to_id.insert(format!("{provider_key}/{model_name}"), model_id.clone());
            persisted.models.push(model);
        }
    }

    if let Some(accounts) = config
        .pointer("/channels/slack/accounts")
        .and_then(serde_json::Value::as_object)
    {
        for (account_id_raw, account_val) in accounts {
            let account_id = account_id_raw.to_ascii_lowercase();
            let channel_id = format!("channel-slack-{}", sanitize_id_fragment(&account_id));
            let slack_channels = account_val
                .get("channels")
                .and_then(serde_json::Value::as_object)
                .map(|obj| obj.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            let mut channel = Channel {
                id: channel_id.clone(),
                account_id: account_id.clone(),
                slack_channels,
                display_name: None,
                channel_type: ChannelType::Slack,
                slack_bot_token_ref: None,
                slack_app_token_ref: None,
                slack_signing_secret_ref: None,
                discord_bot_token_ref: None,
                telegram_bot_token_ref: None,
                legacy_credential_ref: None,
                owner_agent_id: None,
            };
            if let Some(bot) = account_val.get("botToken").and_then(serde_json::Value::as_str) {
                let key = channel_secret_ref(&channel_id, "slack_bot");
                secrets.items.insert(key.clone(), bot.to_string());
                channel.slack_bot_token_ref = Some(key);
            }
            if let Some(app) = account_val.get("appToken").and_then(serde_json::Value::as_str) {
                let key = channel_secret_ref(&channel_id, "slack_app");
                secrets.items.insert(key.clone(), app.to_string());
                channel.slack_app_token_ref = Some(key);
            }
            if let Some(sign) = account_val
                .get("signingSecret")
                .and_then(serde_json::Value::as_str)
            {
                let key = channel_secret_ref(&channel_id, "slack_signing");
                secrets.items.insert(key.clone(), sign.to_string());
                channel.slack_signing_secret_ref = Some(key);
            }
            persisted.channels.push(channel);
        }
    }

    if let Some(accounts) = config
        .pointer("/channels/discord/accounts")
        .and_then(serde_json::Value::as_object)
    {
        for (account_id_raw, account_val) in accounts {
            let account_id = account_id_raw.to_ascii_lowercase();
            let channel_id = format!("channel-discord-{}", sanitize_id_fragment(&account_id));
            let mut channel = Channel {
                id: channel_id.clone(),
                account_id: account_id.clone(),
                slack_channels: vec![],
                display_name: None,
                channel_type: ChannelType::Discord,
                slack_bot_token_ref: None,
                slack_app_token_ref: None,
                slack_signing_secret_ref: None,
                discord_bot_token_ref: None,
                telegram_bot_token_ref: None,
                legacy_credential_ref: None,
                owner_agent_id: None,
            };
            if let Some(token) = account_val.get("botToken").and_then(serde_json::Value::as_str) {
                let key = channel_secret_ref(&channel_id, "discord_bot");
                secrets.items.insert(key.clone(), token.to_string());
                channel.discord_bot_token_ref = Some(key);
            }
            persisted.channels.push(channel);
        }
    }

    if let Some(accounts) = config
        .pointer("/channels/telegram/accounts")
        .and_then(serde_json::Value::as_object)
    {
        for (account_id_raw, account_val) in accounts {
            let account_id = account_id_raw.to_ascii_lowercase();
            let channel_id = format!("channel-telegram-{}", sanitize_id_fragment(&account_id));
            let mut channel = Channel {
                id: channel_id.clone(),
                account_id: account_id.clone(),
                slack_channels: vec![],
                display_name: None,
                channel_type: ChannelType::Telegram,
                slack_bot_token_ref: None,
                slack_app_token_ref: None,
                slack_signing_secret_ref: None,
                discord_bot_token_ref: None,
                telegram_bot_token_ref: None,
                legacy_credential_ref: None,
                owner_agent_id: None,
            };
            if let Some(token) = account_val.get("botToken").and_then(serde_json::Value::as_str) {
                let key = channel_secret_ref(&channel_id, "telegram_bot");
                secrets.items.insert(key.clone(), token.to_string());
                channel.telegram_bot_token_ref = Some(key);
            }
            persisted.channels.push(channel);
        }
    }

    if let Some(agent_list) = config
        .pointer("/agents/list")
        .and_then(serde_json::Value::as_array)
    {
        for agent_val in agent_list {
            let id = agent_val
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("agent")
                .to_string();
            let display_name = agent_val
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&id)
                .to_string();
            let model_ref = agent_val
                .get("model")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string();
            let model_id = model_ref_to_id
                .get(&model_ref)
                .cloned()
                .or_else(|| persisted.models.first().map(|m| m.id.clone()))
                .unwrap_or_else(|| "model-missing".into());
            let workspace_path = agent_val
                .get("workspace")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);

            let mut security = fallback_agent_security
                .get(&id)
                .cloned()
                .unwrap_or_else(AgentSecuritySettings::default);
            if let Some(imported) = agent_security_map.get(&id) {
                security.exec_security = imported.exec_security.clone();
                security.exec_ask = imported.exec_ask.clone();
                security.exec_allowlist = imported.exec_allowlist.clone();
            } else {
                security.exec_security = persisted.execution_policy.security.clone();
                security.exec_ask = persisted.execution_policy.ask.clone();
                security.exec_allowlist = persisted.execution_allowlist.clone();
            }

            persisted.agents.push(Agent {
                id: id.clone(),
                display_name,
                model_id,
                model_override: None,
                channel_id: None,
                workspace_path,
                security,
            });
        }
    }

    if let Some(bindings) = config
        .get("bindings")
        .and_then(serde_json::Value::as_array)
    {
        for binding in bindings {
            let Some(agent_id) = binding.get("agentId").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let Some(channel_type) = binding
                .pointer("/match/channel")
                .and_then(serde_json::Value::as_str)
            else {
                continue;
            };
            let Some(account_id) = binding
                .pointer("/match/accountId")
                .and_then(serde_json::Value::as_str)
            else {
                continue;
            };
            let normalized_account = account_id.to_ascii_lowercase();
            let target_type = match channel_type {
                "slack" => ChannelType::Slack,
                "discord" => ChannelType::Discord,
                "telegram" => ChannelType::Telegram,
                _ => continue,
            };
            if let Some(channel) = persisted
                .channels
                .iter()
                .find(|c| c.channel_type == target_type && c.account_id == normalized_account)
            {
                persisted.bindings.push(BindingRule {
                    agent_id: agent_id.to_string(),
                    channel_id: channel.id.clone(),
                });
            }
        }
    }

    for agent in &mut persisted.agents {
        if let Some(binding) = persisted.bindings.iter().find(|b| b.agent_id == agent.id) {
            agent.channel_id = Some(binding.channel_id.clone());
        }
    }
    for channel in &mut persisted.channels {
        if let Some(binding) = persisted.bindings.iter().find(|b| b.channel_id == channel.id) {
            channel.owner_agent_id = Some(binding.agent_id.clone());
        }
    }

    // Keep local experiment history.
    persisted.experiments = fallback_persisted.experiments;

    (persisted, secrets)
}

fn health_ok(status: StatusCode) -> bool {
    status == StatusCode::OK || status == StatusCode::NO_CONTENT
}

fn listener_pids_on_port(port: u16) -> Vec<String> {
    let target = format!("tcp:{port}");
    let output = Command::new("lsof")
        .args(["-ti", &target, "-sTCP:LISTEN"])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .collect()
}

fn is_port_listening(port: u16) -> bool {
    !listener_pids_on_port(port).is_empty()
}

fn provider_api_env_var(provider_type: &ProviderType) -> Option<&'static str> {
    match provider_type {
        ProviderType::OpenAi => Some("OPENAI_API_KEY"),
        ProviderType::Anthropic => Some("ANTHROPIC_API_KEY"),
        ProviderType::Google => Some("GOOGLE_API_KEY"),
        ProviderType::OpenRouter => Some("OPENROUTER_API_KEY"),
        ProviderType::Together => Some("TOGETHER_API_KEY"),
        ProviderType::Groq => Some("GROQ_API_KEY"),
        _ => None,
    }
}

fn normalize_openai_auth_mode(
    provider_type: &ProviderType,
    openai_auth_mode: Option<OpenAiAuthMode>,
) -> Option<OpenAiAuthMode> {
    if !matches!(provider_type, ProviderType::OpenAi) {
        return None;
    }
    Some(openai_auth_mode.unwrap_or(OpenAiAuthMode::ApiKey))
}

fn is_openai_oauth_model(model: &ModelCatalogItem) -> bool {
    matches!(model.provider_type, ProviderType::OpenAi)
        && matches!(model.openai_auth_mode, Some(OpenAiAuthMode::Oauth))
}

fn provider_api_env_var_for_model(model: &ModelCatalogItem) -> Option<&'static str> {
    if is_openai_oauth_model(model) {
        None
    } else {
        provider_api_env_var(&model.provider_type)
    }
}

fn provider_default_base_url(provider_type: &ProviderType) -> Option<&'static str> {
    match provider_type {
        ProviderType::OpenAi => Some("https://api.openai.com/v1"),
        ProviderType::Anthropic => Some("https://api.anthropic.com/v1"),
        ProviderType::Google => Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        ProviderType::OpenRouter => Some("https://openrouter.ai/api/v1"),
        ProviderType::Together => Some("https://api.together.xyz/v1"),
        ProviderType::Groq => Some("https://api.groq.com/openai/v1"),
        ProviderType::Ollama => Some("http://localhost:11434/v1"),
        ProviderType::LmStudio => Some("http://localhost:1234/v1"),
        ProviderType::Compatible => None,
    }
}

fn provider_builtin_key(provider_type: &ProviderType) -> Option<&'static str> {
    match provider_type {
        ProviderType::OpenAi => Some("openai"),
        ProviderType::Anthropic => Some("anthropic"),
        ProviderType::Google => Some("google"),
        ProviderType::OpenRouter => Some("openrouter"),
        ProviderType::Together => Some("together"),
        ProviderType::Groq => Some("groq"),
        ProviderType::Ollama => Some("ollama"),
        ProviderType::LmStudio => Some("lmstudio"),
        ProviderType::Compatible => None,
    }
}

fn provider_builtin_key_for_model(model: &ModelCatalogItem) -> Option<&'static str> {
    if is_openai_oauth_model(model) {
        Some("openai-codex")
    } else {
        provider_builtin_key(&model.provider_type)
    }
}

fn provider_model_catalog_prefix(
    provider_type: &ProviderType,
    openai_auth_mode: Option<&OpenAiAuthMode>,
) -> Option<&'static str> {
    match provider_type {
        ProviderType::OpenAi => match openai_auth_mode {
            Some(OpenAiAuthMode::Oauth) => Some("openai-codex/"),
            _ => Some("openai/"),
        },
        ProviderType::Anthropic => Some("anthropic/"),
        ProviderType::Google => Some("google/"),
        ProviderType::OpenRouter => Some("openrouter/"),
        ProviderType::Together => Some("together/"),
        ProviderType::Groq => Some("groq/"),
        ProviderType::Compatible | ProviderType::Ollama | ProviderType::LmStudio => None,
    }
}

fn normalize_base_url(base_url: Option<String>) -> Option<String> {
    let trimmed = base_url.as_deref().map(str::trim).unwrap_or_default();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn validate_model_input(
    provider_type: &ProviderType,
    base_url: Option<&str>,
    model_name: &str,
) -> Result<(), CommandError> {
    if model_name.trim().is_empty() {
        return Err(err("ERR-ECLAW-0001", "必須項目を入力してください。"));
    }

    let required = matches!(provider_type, ProviderType::Compatible);
    if required && base_url.unwrap_or_default().trim().is_empty() {
        return Err(err("ERR-ECLAW-0001", "必須項目を入力してください。"));
    }

    if let Some(url) = base_url.filter(|u| !u.trim().is_empty()) {
        if Url::parse(url).is_err() {
            return Err(err("ERR-ECLAW-0002", "base_url の形式が不正です。"));
        }
    }
    Ok(())
}

fn numeric_tokens_desc_key(name: &str) -> Vec<u64> {
    let mut nums: Vec<u64> = vec![];
    let mut buf = String::new();
    for ch in name.chars() {
        if ch.is_ascii_digit() {
            buf.push(ch);
        } else if !buf.is_empty() {
            if let Ok(v) = buf.parse::<u64>() {
                nums.push(v);
            }
            buf.clear();
        }
    }
    if !buf.is_empty() {
        if let Ok(v) = buf.parse::<u64>() {
            nums.push(v);
        }
    }
    nums
}

fn sort_and_trim_numeric_top(models: &mut Vec<String>, limit: usize) {
    models.sort_by(|a, b| {
        let ka = numeric_tokens_desc_key(a);
        let kb = numeric_tokens_desc_key(b);
        kb.cmp(&ka).then_with(|| a.cmp(b))
    });
    if models.len() > limit {
        models.truncate(limit);
    }
}

fn run_model_list_command_with_timeout(mut cmd: Command) -> Result<std::process::Output, CommandError> {
    let timeout = Duration::from_secs(8);
    let started = SystemTime::now();
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            err(
                "ERR-ECLAW-0024",
                "モデル一覧の取得に失敗しました。openclaw コマンドを確認してください。",
            )
        })?;

    loop {
        if let Some(status) = child.try_wait().map_err(|_| {
            err(
                "ERR-ECLAW-0024",
                "モデル一覧の取得状態を確認できませんでした。",
            )
        })? {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            if let Some(mut out) = child.stdout.take() {
                let _ = out.read_to_end(&mut stdout);
            }
            if let Some(mut err_out) = child.stderr.take() {
                let _ = err_out.read_to_end(&mut stderr);
            }
            return Ok(std::process::Output {
                status,
                stdout,
                stderr,
            });
        }

        if started.elapsed().unwrap_or_default() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(err(
                "ERR-ECLAW-0024",
                "モデル一覧の取得がタイムアウトしました。固定候補を使ってください。",
            ));
        }

        std::thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
fn list_provider_model_candidates(
    provider_type: ProviderType,
    openai_auth_mode: Option<OpenAiAuthMode>,
) -> Result<Vec<String>, CommandError> {
    let Some(prefix) = provider_model_catalog_prefix(&provider_type, openai_auth_mode.as_ref()) else {
        return Ok(vec![]);
    };

    let bin = openclaw_bin();
    let mut cmd = Command::new(bin);
    cmd.args(["models", "list", "--all", "--json"]);

    let (resolved_config, _) = resolve_apply_paths(None);
    if resolved_config.exists() {
        cmd.env("OPENCLAW_CONFIG_PATH", &resolved_config);
        if let Some(parent) = resolved_config.parent() {
            cmd.env("OPENCLAW_STATE_DIR", parent);
        }
    }

    let output = run_model_list_command_with_timeout(cmd)?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = extract_cli_error_detail(&stdout, &stderr)
            .unwrap_or_else(|| "openclaw models list の実行に失敗しました。".to_string());
        return Err(err(
            "ERR-ECLAW-0024",
            &format!("モデル一覧の取得に失敗しました: {detail}"),
        ));
    }

    let parsed: OpenClawModelsListJson = serde_json::from_slice(&output.stdout)
        .map_err(|_| err("ERR-ECLAW-0024", "モデル一覧のJSON解析に失敗しました。"))?;
    let mut seen: HashSet<String> = HashSet::new();
    let mut models: Vec<String> = vec![];
    for item in parsed.models {
        if let Some(stripped) = item.key.strip_prefix(prefix) {
            let name = stripped.trim();
            if name.is_empty() {
                continue;
            }
            if seen.insert(name.to_string()) {
                models.push(name.to_string());
            }
        }
    }
    if matches!(provider_type, ProviderType::OpenAi)
        && matches!(openai_auth_mode, Some(OpenAiAuthMode::Oauth))
    {
        let allowed = ["gpt-5.2", "gpt-5.3-codex", "gpt-5.3-codex-spark"];
        let set: HashSet<&str> = models.iter().map(String::as_str).collect();
        let filtered: Vec<String> = allowed
            .iter()
            .filter(|name| set.contains(**name))
            .map(|name| (*name).to_string())
            .collect();
        if !filtered.is_empty() {
            return Ok(filtered);
        }
    }

    sort_and_trim_numeric_top(&mut models, 5);
    Ok(models)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn validate_gateway_config(input: &SetGatewayConfigInput) -> Result<GatewaySettings, CommandError> {
    match input.mode {
        GatewayMode::Local => {
            let bind =
                normalize_optional_text(input.bind.clone()).unwrap_or_else(|| "loopback".into());
            let allowed_bind = ["loopback", "lan", "tailnet", "auto", "custom"];
            if !allowed_bind.contains(&bind.as_str()) {
                return Err(err(
                    "ERR-ECLAW-0022",
                    "Gateway bind は loopback/lan/tailnet/auto/custom のいずれかを指定してください。",
                ));
            }
            let auth_mode =
                normalize_optional_text(input.auth_mode.clone()).unwrap_or_else(|| "token".into());
            let allowed_auth = ["token", "password"];
            if !allowed_auth.contains(&auth_mode.as_str()) {
                return Err(err(
                    "ERR-ECLAW-0022",
                    "Gateway auth mode は token/password のいずれかを指定してください。",
                ));
            }
            if auth_mode == "token" && normalize_optional_text(input.auth_token.clone()).is_none() {
                return Err(err("ERR-ECLAW-0022", "Gateway token を入力してください。"));
            }
            Ok(GatewaySettings {
                mode: GatewayMode::Local,
                port: input.port.or(Some(18789)),
                bind: Some(bind),
                auth_mode: Some(auth_mode),
                auth_token: normalize_optional_text(input.auth_token.clone()),
                remote_url: None,
                remote_token: None,
                tailscale_mode: normalize_optional_text(input.tailscale_mode.clone())
                    .or(Some("off".into())),
            })
        }
        GatewayMode::Remote => {
            let remote_url = normalize_optional_text(input.remote_url.clone())
                .ok_or_else(|| err("ERR-ECLAW-0022", "VPS接続URLを入力してください。"))?;
            if Url::parse(&remote_url).is_err() {
                return Err(err("ERR-ECLAW-0022", "VPS接続URLの形式が不正です。"));
            }
            if normalize_optional_text(input.remote_token.clone()).is_none() {
                return Err(err("ERR-ECLAW-0022", "VPS接続トークンを入力してください。"));
            }
            Ok(GatewaySettings {
                mode: GatewayMode::Remote,
                port: None,
                bind: None,
                auth_mode: None,
                auth_token: None,
                remote_url: Some(remote_url),
                remote_token: normalize_optional_text(input.remote_token.clone()),
                tailscale_mode: None,
            })
        }
    }
}

fn validate_execution_policy(
    input: &SetExecutionPolicyInput,
) -> Result<ExecutionPolicySettings, CommandError> {
    let host = input.host.trim().to_string();
    let security = input.security.trim().to_string();
    let ask = input.ask.trim().to_string();
    let node = normalize_optional_text(input.node.clone());

    if !["sandbox", "gateway", "node"].contains(&host.as_str()) {
        return Err(err(
            "ERR-ECLAW-0023",
            "Execution host は sandbox/gateway/node のいずれかを指定してください。",
        ));
    }
    if !["deny", "allowlist", "full"].contains(&security.as_str()) {
        return Err(err(
            "ERR-ECLAW-0023",
            "Execution security は deny/allowlist/full のいずれかを指定してください。",
        ));
    }
    if !["off", "on-miss", "always"].contains(&ask.as_str()) {
        return Err(err(
            "ERR-ECLAW-0023",
            "Execution ask は off/on-miss/always のいずれかを指定してください。",
        ));
    }
    if host == "node" && node.is_none() {
        return Err(err(
            "ERR-ECLAW-0023",
            "Execution host=node の場合は Node ID が必要です。",
        ));
    }

    Ok(ExecutionPolicySettings {
        host,
        security,
        ask,
        node,
    })
}

fn validate_agent_security(
    input: Option<AgentSecuritySettings>,
    default_security: &str,
    default_ask: &str,
    default_allowlist: &[String],
) -> Result<AgentSecuritySettings, CommandError> {
    let mut security = input.unwrap_or_else(|| AgentSecuritySettings {
        exec_security: default_security.to_string(),
        exec_ask: default_ask.to_string(),
        exec_allowlist: default_allowlist.to_vec(),
        ..AgentSecuritySettings::default()
    });
    security.exec_security = security.exec_security.trim().to_string();
    security.exec_ask = security.exec_ask.trim().to_string();
    security.exec_allowlist = security
        .exec_allowlist
        .iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect();
    security.browser_allowed_domains = security
        .browser_allowed_domains
        .iter()
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .collect();
    if security.exec_allowlist.is_empty() {
        security.exec_allowlist = default_allowlist.to_vec();
    }

    if !["deny", "allowlist", "full"].contains(&security.exec_security.as_str()) {
        return Err(err(
            "ERR-ECLAW-0023",
            "Agent security は deny/allowlist/full のいずれかを指定してください。",
        ));
    }
    if !["off", "on-miss", "always"].contains(&security.exec_ask.as_str()) {
        return Err(err(
            "ERR-ECLAW-0023",
            "Agent ask は off/on-miss/always のいずれかを指定してください。",
        ));
    }
    Ok(security)
}

fn model_provider_key(model: &ModelCatalogItem) -> String {
    let built_in = provider_builtin_key_for_model(model).unwrap_or("compatible");
    if model.base_url.is_some() || built_in == "compatible" {
        format!("{}_{}", built_in, model.id.replace('-', "_"))
    } else {
        built_in.to_string()
    }
}

fn model_effective_base_url(model: &ModelCatalogItem) -> Option<String> {
    model
        .base_url
        .clone()
        .or_else(|| provider_default_base_url(&model.provider_type).map(str::to_string))
}

fn model_api_kind(provider_type: &ProviderType) -> &'static str {
    match provider_type {
        ProviderType::Anthropic => "anthropic",
        ProviderType::Google => "openai-completions",
        ProviderType::Compatible => "openai-completions",
        ProviderType::OpenAi => "openai-completions",
        ProviderType::OpenRouter => "openai-completions",
        ProviderType::Together => "openai-completions",
        ProviderType::Groq => "openai-completions",
        ProviderType::Ollama => "openai-completions",
        ProviderType::LmStudio => "openai-completions",
    }
}

fn ensure_model_probe_url(model: &ModelCatalogItem) -> Result<String, CommandError> {
    if let Some(url) = model_effective_base_url(model) {
        return Ok(url);
    }
    Err(err(
        "ERR-ECLAW-0003",
        "このProviderは base_url 未指定のため疎通確認できません。",
    ))
}

fn validate_base_url_string(base_url: &str) -> Result<(), CommandError> {
    if Url::parse(base_url).is_err() {
        return Err(err("ERR-ECLAW-0002", "base_url の形式が不正です。"));
    }
    Ok(())
}

fn channel_type_label(channel_type: &ChannelType) -> &'static str {
    match channel_type {
        ChannelType::Slack => "slack",
        ChannelType::Discord => "discord",
        ChannelType::Telegram => "telegram",
    }
}

fn next_channel_account_id(channels: &[Channel], channel_type: &ChannelType) -> String {
    let prefix = format!("{}-", channel_type_label(channel_type));
    let max_seq = channels
        .iter()
        .filter(|c| &c.channel_type == channel_type)
        .filter_map(|c| c.account_id.strip_prefix(&prefix))
        .filter_map(|tail| tail.parse::<u32>().ok())
        .max()
        .unwrap_or(0);
    format!("{}{max:03}", prefix, max = max_seq + 1)
}

fn resolve_account_id_for_create(
    channels: &[Channel],
    channel_type: &ChannelType,
    account_id: Option<String>,
) -> String {
    let v = account_id.as_deref().map(str::trim).unwrap_or_default();
    if v.is_empty() || v.eq_ignore_ascii_case("default") {
        next_channel_account_id(channels, channel_type)
    } else {
        v.to_ascii_lowercase()
    }
}

fn channel_secret_ref(channel_id: &str, key: &str) -> String {
    format!("secret-channel-{}-{}", channel_id, key)
}

fn validate_channel_input(input: &CreateChannelInput) -> Result<(), CommandError> {
    match input.channel_type {
        ChannelType::Slack => {
            if input
                .slack_bot_token
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
                || input
                    .slack_app_token
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or_default()
                    .is_empty()
            {
                return Err(err("ERR-ECLAW-0004", "Channel必須情報を入力してください。"));
            }
        }
        ChannelType::Discord => {
            if input
                .discord_bot_token
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
            {
                return Err(err("ERR-ECLAW-0004", "Channel必須情報を入力してください。"));
            }
        }
        ChannelType::Telegram => {
            if input
                .telegram_bot_token
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
            {
                return Err(err("ERR-ECLAW-0004", "Channel必須情報を入力してください。"));
            }
        }
    }
    Ok(())
}

fn apply_channel_secrets(
    channel_id: &str,
    account_id: String,
    input: &CreateChannelInput,
    secrets: &mut SecretStore,
) -> Channel {
    let slack_channels = input
        .slack_channels
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();

    let mut channel = Channel {
        id: channel_id.to_string(),
        account_id,
        slack_channels,
        display_name: input
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        channel_type: input.channel_type.clone(),
        slack_bot_token_ref: None,
        slack_app_token_ref: None,
        slack_signing_secret_ref: None,
        discord_bot_token_ref: None,
        telegram_bot_token_ref: None,
        legacy_credential_ref: None,
        owner_agent_id: None,
    };

    if let Some(v) = input
        .slack_bot_token
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let key = channel_secret_ref(channel_id, "slack_bot");
        secrets.items.insert(key.clone(), v.to_string());
        channel.slack_bot_token_ref = Some(key);
    }
    if let Some(v) = input
        .slack_app_token
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let key = channel_secret_ref(channel_id, "slack_app");
        secrets.items.insert(key.clone(), v.to_string());
        channel.slack_app_token_ref = Some(key);
    }
    if let Some(v) = input
        .slack_signing_secret
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let key = channel_secret_ref(channel_id, "slack_signing");
        secrets.items.insert(key.clone(), v.to_string());
        channel.slack_signing_secret_ref = Some(key);
    }
    if let Some(v) = input
        .discord_bot_token
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let key = channel_secret_ref(channel_id, "discord_bot");
        secrets.items.insert(key.clone(), v.to_string());
        channel.discord_bot_token_ref = Some(key);
    }
    if let Some(v) = input
        .telegram_bot_token
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let key = channel_secret_ref(channel_id, "telegram_bot");
        secrets.items.insert(key.clone(), v.to_string());
        channel.telegram_bot_token_ref = Some(key);
    }

    channel
}

fn token_value_from_refs(
    primary_ref: Option<&String>,
    fallback_ref: Option<&String>,
    secrets: &SecretStore,
) -> Option<String> {
    primary_ref
        .and_then(|k| secrets.items.get(k))
        .cloned()
        .or_else(|| fallback_ref.and_then(|k| secrets.items.get(k)).cloned())
}

fn enforce_channel_assignment(
    persisted: &mut PersistedState,
    requested_agent_id: Option<&str>,
    channel_id: Option<&str>,
    force_reassign: bool,
) -> Result<(), CommandError> {
    let Some(channel_id) = channel_id else {
        return Ok(());
    };

    let idx = persisted
        .channels
        .iter()
        .position(|c| c.id == channel_id)
        .ok_or_else(|| {
            err(
                "ERR-ECLAW-0008",
                "Channelが見つかりません。再選択してください。",
            )
        })?;

    if let Some(owner) = persisted.channels[idx].owner_agent_id.clone() {
        let current_id = requested_agent_id.unwrap_or_default();
        if owner != current_id && !force_reassign {
            return Err(err(
                "ERR-ECLAW-0009",
                "この再割当で既存のチャネル割当は解除されます。",
            ));
        }

        if owner != current_id {
            if let Some(old) = persisted.agents.iter_mut().find(|a| a.id == owner) {
                old.channel_id = None;
            }
        }
    }

    Ok(())
}

fn env_key_for(ref_key: &str) -> String {
    ref_key.replace('-', "_").to_uppercase()
}

fn secret_value_by_refs(
    secrets: &SecretStore,
    primary_ref: Option<&String>,
    legacy_ref: Option<&String>,
) -> Option<String> {
    if let Some(k) = primary_ref {
        if let Some(v) = secrets.items.get(k) {
            return Some(v.clone());
        }
    }
    if let Some(k) = legacy_ref {
        if let Some(v) = secrets.items.get(k) {
            return Some(v.clone());
        }
    }
    None
}

fn build_gateway_json(gateway: &GatewaySettings) -> serde_json::Value {
    match gateway.mode {
        GatewayMode::Local => {
            let mut obj = serde_json::Map::new();
            obj.insert("mode".into(), serde_json::json!("local"));
            if let Some(port) = gateway.port {
                obj.insert("port".into(), serde_json::json!(port));
            }
            if let Some(bind) = gateway
                .bind
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                obj.insert("bind".into(), serde_json::json!(bind));
            }
            let auth_mode = gateway
                .auth_mode
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .unwrap_or("token");
            let mut auth = serde_json::Map::new();
            auth.insert("mode".into(), serde_json::json!(auth_mode));
            if let Some(token) = gateway
                .auth_token
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                auth.insert("token".into(), serde_json::json!(token));
            }
            obj.insert("auth".into(), serde_json::Value::Object(auth));

            let mut tailscale = serde_json::Map::new();
            tailscale.insert(
                "mode".into(),
                serde_json::json!(
                    gateway
                        .tailscale_mode
                        .as_deref()
                        .map(str::trim)
                        .filter(|v| !v.is_empty())
                        .unwrap_or("off")
                ),
            );
            tailscale.insert("resetOnExit".into(), serde_json::json!(false));
            obj.insert("tailscale".into(), serde_json::Value::Object(tailscale));
            serde_json::Value::Object(obj)
        }
        GatewayMode::Remote => {
            let mut obj = serde_json::Map::new();
            obj.insert("mode".into(), serde_json::json!("remote"));
            let mut remote = serde_json::Map::new();
            if let Some(url) = gateway
                .remote_url
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                remote.insert("url".into(), serde_json::json!(url));
            }
            if let Some(token) = gateway
                .remote_token
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                remote.insert("token".into(), serde_json::json!(token));
            }
            obj.insert("remote".into(), serde_json::Value::Object(remote));
            serde_json::Value::Object(obj)
        }
    }
}

fn merge_json(existing: &mut serde_json::Value, incoming: serde_json::Value) {
    match (existing, incoming) {
        (serde_json::Value::Object(dst), serde_json::Value::Object(src)) => {
            for (k, v) in src {
                if let Some(cur) = dst.get_mut(&k) {
                    merge_json(cur, v);
                } else {
                    dst.insert(k, v);
                }
            }
        }
        (dst, src) => {
            *dst = src;
        }
    }
}

fn merge_openclaw_config(
    mut existing: serde_json::Value,
    generated: serde_json::Value,
) -> serde_json::Value {
    let generated_for_merge = generated.clone();
    merge_json(&mut existing, generated_for_merge);

    // Keep unmanaged top-level fields, but make easy-openclaw-managed sections authoritative.
    for key in ["agents", "channels", "bindings", "gateway"] {
        if let Some(v) = existing.get_mut(key) {
            if let Some(gv) = generated.get(key) {
                *v = gv.clone();
            }
        } else if let Some(gv) = generated.get(key) {
            if let Some(obj) = existing.as_object_mut() {
                obj.insert(key.to_string(), gv.clone());
            }
        }
    }
    if let Some(generated_models_providers) = generated.pointer("/models/providers") {
        if existing.get("models").is_none() {
            if let Some(obj) = existing.as_object_mut() {
                obj.insert("models".into(), serde_json::json!({}));
            }
        }
        if let Some(models_obj) = existing
            .get_mut("models")
            .and_then(serde_json::Value::as_object_mut)
        {
            models_obj.insert("providers".into(), generated_models_providers.clone());
        }
    }

    if let Some(generated_exec) = generated.pointer("/tools/exec") {
        if existing.get("tools").is_none() {
            if let Some(obj) = existing.as_object_mut() {
                obj.insert("tools".into(), serde_json::json!({}));
            }
        }
        if let Some(tools_obj) = existing
            .get_mut("tools")
            .and_then(serde_json::Value::as_object_mut)
        {
            tools_obj.insert("exec".into(), generated_exec.clone());
        }
    }
    existing
}

fn normalize_openclaw_config(config: &mut serde_json::Value) {
    if let Some(providers) = config
        .pointer_mut("/models/providers")
        .and_then(serde_json::Value::as_object_mut)
    {
        for provider in providers.values_mut() {
            if let Some(obj) = provider.as_object_mut() {
                if obj.get("apiKey").is_some_and(serde_json::Value::is_null) {
                    obj.remove("apiKey");
                }
            }
        }
    }
}

fn backup_existing_file(path: &Path) -> Result<Option<PathBuf>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let ts = now_ts();
    let stem = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("openclaw");
    let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("json");
    let backup = parent.join(format!("{stem}.backup-{ts}.{ext}"));
    fs::copy(path, &backup).map_err(|e| AppError::Message(format!("failed to backup file: {e}")))?;
    Ok(Some(backup))
}

fn build_output_files(
    persisted: &PersistedState,
    secrets: &SecretStore,
) -> Result<(String, String), CommandError> {
    if persisted.agents.is_empty() {
        return Err(err(
            "ERR-ECLAW-0010",
            "設定が不足しています。入力を確認してください。",
        ));
    }

    let model_by_id: HashMap<String, ModelCatalogItem> = persisted
        .models
        .iter()
        .cloned()
        .map(|m| (m.id.clone(), m))
        .collect();

    let mut providers = serde_json::Map::new();
    let mut default_models = serde_json::Map::new();
    let mut provider_env_overrides: HashMap<String, String> = HashMap::new();

    for model in &persisted.models {
        let provider_key = model_provider_key(model);
        let model_ref = format!("{}/{}", provider_key, model.model_name);
        default_models.insert(
            model_ref.clone(),
            serde_json::json!({
                "alias": model.model_name,
            }),
        );

        let api_key = model
            .api_key_ref
            .as_ref()
            .map(|k| format!("${{{}}}", env_key_for(k)))
            .or_else(|| {
                if matches!(model.provider_type, ProviderType::LmStudio | ProviderType::Ollama) {
                    Some("dummy".to_string())
                } else {
                    None
                }
            });

        let should_emit_provider =
            model.base_url.is_some() || provider_builtin_key_for_model(model).is_none();
        if should_emit_provider {
            let base_url = model_effective_base_url(model)
                .ok_or_else(|| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;
            let mut provider = serde_json::Map::new();
            provider.insert(
                "api".into(),
                serde_json::json!(model_api_kind(&model.provider_type)),
            );
            provider.insert("baseUrl".into(), serde_json::json!(base_url));
            if let Some(key) = api_key {
                provider.insert("apiKey".into(), serde_json::json!(key));
            }
            provider.insert(
                "models".into(),
                serde_json::json!([{
                    "id": model.model_name,
                    "name": model.model_name
                }]),
            );
            providers.insert(provider_key.clone(), serde_json::Value::Object(provider));
        } else if let (Some(var_name), Some(secret_ref)) = (
            provider_api_env_var_for_model(model),
            model.api_key_ref.as_ref(),
        ) {
            if let Some(secret_value) = secrets.items.get(secret_ref) {
                provider_env_overrides.insert(var_name.to_string(), secret_value.clone());
            }
        }
    }

    let mut agents = vec![];
    for agent in &persisted.agents {
        let model = model_by_id
            .get(&agent.model_id)
            .ok_or_else(|| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;
        let provider_key = model_provider_key(model);
        let model_ref = format!(
            "{}/{}",
            provider_key,
            agent
                .model_override
                .clone()
                .unwrap_or_else(|| model.model_name.clone())
        );
        agents.push(serde_json::json!({
            "id": agent.id,
            "name": agent.display_name,
            "workspace": workspace_path_from_agent(agent).display().to_string(),
            "model": model_ref,
        }));
    }

    let mut slack_accounts = serde_json::Map::new();
    let mut discord_accounts = serde_json::Map::new();
    let mut telegram_accounts = serde_json::Map::new();
    for channel in &persisted.channels {
        let account_key = channel.account_id.to_ascii_lowercase();
        match channel.channel_type {
            ChannelType::Slack => {
                let bot = token_value_from_refs(
                    channel.slack_bot_token_ref.as_ref(),
                    channel.legacy_credential_ref.as_ref(),
                    secrets,
                )
                    .ok_or_else(|| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;
                let app = token_value_from_refs(
                    channel.slack_app_token_ref.as_ref(),
                    channel.legacy_credential_ref.as_ref(),
                    secrets,
                )
                    .ok_or_else(|| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;
                let mut obj = serde_json::Map::new();
                obj.insert("enabled".into(), serde_json::json!(true));
                obj.insert("requireMention".into(), serde_json::json!(false));
                obj.insert("replyToMode".into(), serde_json::json!("off"));
                obj.insert("botToken".into(), serde_json::json!(bot));
                obj.insert("appToken".into(), serde_json::json!(app));
                if let Some(signing) = token_value_from_refs(
                    channel.slack_signing_secret_ref.as_ref(),
                    channel.legacy_credential_ref.as_ref(),
                    secrets,
                ) {
                    obj.insert("signingSecret".into(), serde_json::json!(signing));
                }
                if !channel.slack_channels.is_empty() {
                    let channels_obj = channel
                        .slack_channels
                        .iter()
                        .map(|channel_id| {
                            (
                                channel_id.clone(),
                                serde_json::json!({
                                    "enabled": true,
                                }),
                            )
                        })
                        .collect::<serde_json::Map<String, serde_json::Value>>();
                    obj.insert("channels".into(), serde_json::Value::Object(channels_obj));
                }
                slack_accounts.insert(account_key, serde_json::Value::Object(obj));
            }
            ChannelType::Discord => {
                let token = token_value_from_refs(
                    channel.discord_bot_token_ref.as_ref(),
                    channel.legacy_credential_ref.as_ref(),
                    secrets,
                )
                    .ok_or_else(|| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;
                discord_accounts.insert(
                    account_key,
                    serde_json::json!({ "enabled": true, "botToken": token }),
                );
            }
            ChannelType::Telegram => {
                let token = token_value_from_refs(
                    channel.telegram_bot_token_ref.as_ref(),
                    channel.legacy_credential_ref.as_ref(),
                    secrets,
                )
                    .ok_or_else(|| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;
                telegram_accounts.insert(
                    account_key,
                    serde_json::json!({ "enabled": true, "botToken": token }),
                );
            }
        }
    }

    let bindings: Vec<serde_json::Value> = persisted
        .bindings
        .iter()
        .filter_map(|binding| {
            let channel = persisted
                .channels
                .iter()
                .find(|c| c.id == binding.channel_id)?;
            let account_id = channel.account_id.to_ascii_lowercase();
            Some(serde_json::json!({
                "agentId": binding.agent_id,
                "match": {
                    "channel": channel.channel_type,
                    "accountId": account_id
                }
            }))
        })
        .collect();

    let mut exec_obj = serde_json::Map::new();
    exec_obj.insert(
        "host".into(),
        serde_json::json!(persisted.execution_policy.host),
    );
    exec_obj.insert(
        "security".into(),
        serde_json::json!(persisted.execution_policy.security),
    );
    exec_obj.insert(
        "ask".into(),
        serde_json::json!(persisted.execution_policy.ask),
    );
    if let Some(node_id) = &persisted.execution_policy.node {
        exec_obj.insert("node".into(), serde_json::json!(node_id));
    }

    let openclaw = serde_json::json!({
        "$schema": "https://openclaw.ai/schemas/config.schema.json",
        "agents": {
            "defaults": { "models": default_models },
            "list": agents
        },
        "models": {
            "mode": "merge",
            "providers": providers
        },
        "gateway": build_gateway_json(&persisted.gateway),
        "channels": {
            "slack": {
                "enabled": true,
                "mode": "socket",
                "groupPolicy": "allowlist",
                "userTokenReadOnly": true,
                "replyToMode": "off",
                "webhookPath": "/slack/events",
                "accounts": slack_accounts
            },
            "discord": {
                "enabled": true,
                "groupPolicy": "allowlist",
                "accounts": discord_accounts
            },
            "telegram": {
                "enabled": true,
                "groupPolicy": "allowlist",
                "dmPolicy": "pairing",
                "accounts": telegram_accounts
            }
        },
        "bindings": bindings,
        "tools": {
            "exec": exec_obj
        }
    });
    let config_text = serde_json::to_string_pretty(&openclaw)
        .map_err(|_| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;

    let mut env_lines = vec![];
    for (k, v) in &secrets.items {
        env_lines.push(format!("{}={}", env_key_for(k), v));
    }
    for (k, v) in provider_env_overrides {
        env_lines.push(format!("{}={}", k, v));
    }
    Ok((config_text, env_lines.join("\n")))
}

fn validate_experiment_input(case_id: &str, result: &str) -> Result<(), CommandError> {
    if case_id.trim().is_empty() || result.trim().is_empty() {
        return Err(err(
            "ERR-ECLAW-0018",
            "実験記録の必須項目が不足しています。",
        ));
    }
    Ok(())
}

fn run_status_from(run: &RunState, gateway: &GatewaySettings) -> RunStatus {
    let managed_running = run.child.is_some();
    let (port_in_use, port) = match gateway.mode {
        GatewayMode::Local => {
            let p = gateway.port.unwrap_or(18789);
            (is_port_listening(p), Some(p))
        }
        GatewayMode::Remote => (false, None),
    };

    let running = managed_running || port_in_use;
    let (can_start, start_disabled_reason) = if managed_running {
        (false, Some("easy-openclaw が起動した gateway が稼働中です。".into()))
    } else if port_in_use {
        (
            false,
            Some(format!(
                "ポート {} が使用中のため Start できません。",
                port.unwrap_or(18789)
            )),
        )
    } else {
        (true, None)
    };
    let (can_stop, stop_disabled_reason) = if running {
        (true, None)
    } else {
        (false, Some("停止対象の gateway が見つかりません。".into()))
    };

    RunStatus {
        mode: run.mode.clone(),
        running,
        pid: run.child.as_ref().map(Child::id),
        health: run.health.clone(),
        dashboard_url: run.dashboard_url.clone(),
        port_in_use,
        can_start,
        can_stop,
        start_disabled_reason,
        stop_disabled_reason,
    }
}

fn push_log(state: &AppState, level: &str, message: impl Into<String>) {
    if let Ok(mut logs) = state.logs.lock() {
        if logs.len() > 500 {
            logs.pop_front();
        }
        logs.push_back(LogLine {
            ts: now_ts(),
            level: level.to_string(),
            message: message.into(),
        });
    }
}

fn default_openclaw_state_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".openclaw");
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".openclaw")
}

fn legacy_openclaw_state_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".openclaw-state");
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".openclaw-state")
}

fn maybe_migrate_legacy_openclaw_files(config_path: &Path, env_path: &Path) -> Result<(), AppError> {
    let default_config = default_openclaw_state_dir().join("openclaw.json");
    if config_path != default_config || config_path.exists() {
        return Ok(());
    }

    let legacy_dir = legacy_openclaw_state_dir();
    let legacy_config = legacy_dir.join("openclaw.json");
    let legacy_env = legacy_dir.join(".env");

    if legacy_config.exists() {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::Message(format!("failed to create dir: {e}")))?;
        }
        fs::copy(&legacy_config, config_path)
            .map_err(|e| AppError::Message(format!("failed to migrate config: {e}")))?;
    }
    if !env_path.exists() && legacy_env.exists() {
        if let Some(parent) = env_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::Message(format!("failed to create dir: {e}")))?;
        }
        fs::copy(&legacy_env, env_path)
            .map_err(|e| AppError::Message(format!("failed to migrate env: {e}")))?;
    }
    Ok(())
}

fn resolve_apply_paths(target_dir: Option<String>) -> (PathBuf, PathBuf) {
    let trimmed_target = target_dir.as_deref().map(str::trim).unwrap_or_default();
    if !trimmed_target.is_empty() {
        let dir = PathBuf::from(trimmed_target);
        return (dir.join("openclaw.json"), dir.join(".env"));
    }

    if let Ok(config_path) = std::env::var("OPENCLAW_CONFIG_PATH") {
        let trimmed = config_path.trim();
        if !trimmed.is_empty() {
            let cfg = PathBuf::from(trimmed);
            let env_dir = cfg
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."));
            return (cfg, env_dir.join(".env"));
        }
    }

    if let Ok(state_dir) = std::env::var("OPENCLAW_STATE_DIR") {
        let trimmed = state_dir.trim();
        if !trimmed.is_empty() {
            let dir = PathBuf::from(trimmed);
            return (dir.join("openclaw.json"), dir.join(".env"));
        }
    }

    let dir = default_openclaw_state_dir();
    (dir.join("openclaw.json"), dir.join(".env"))
}

fn resolve_approvals_path(config_path: &Path) -> PathBuf {
    config_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("exec-approvals.json")
}

fn build_exec_approvals_json(persisted: &PersistedState) -> serde_json::Value {
    let default_allowlist = persisted
        .execution_allowlist
        .iter()
        .map(|pattern| serde_json::json!({ "pattern": pattern }))
        .collect::<Vec<_>>();

    let mut agents_obj = serde_json::Map::new();
    agents_obj.insert(
        "main".into(),
        serde_json::json!({
            "security": persisted.execution_policy.security,
            "ask": persisted.execution_policy.ask,
            "askFallback": "deny",
            "autoAllowSkills": false,
            "allowlist": default_allowlist
        }),
    );
    for agent in &persisted.agents {
        let allowlist = agent
            .security
            .exec_allowlist
            .iter()
            .map(|pattern| serde_json::json!({ "pattern": pattern }))
            .collect::<Vec<_>>();
        agents_obj.insert(
            agent.id.clone(),
            serde_json::json!({
                "security": agent.security.exec_security,
                "ask": agent.security.exec_ask,
                "askFallback": "deny",
                "autoAllowSkills": false,
                "allowlist": allowlist
            }),
        );
    }

    serde_json::json!({
        "version": 1,
        "defaults": {
            "security": persisted.execution_policy.security,
            "ask": persisted.execution_policy.ask,
            "askFallback": "deny",
            "autoAllowSkills": false
        },
        "agents": agents_obj
    })
}

fn merge_exec_approvals(
    mut existing: serde_json::Value,
    generated: serde_json::Value,
) -> serde_json::Value {
    merge_json(&mut existing, generated.clone());

    if let Some(defaults) = generated.get("defaults") {
        if let Some(obj) = existing.as_object_mut() {
            obj.insert("defaults".into(), defaults.clone());
        }
    }

    if let Some(agents) = generated.get("agents") {
        if let Some(obj) = existing.as_object_mut() {
            obj.insert("agents".into(), agents.clone());
        }
    }

    existing
}

#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, CommandError> {
    let persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?
        .clone();
    let run_state = state
        .run_state
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "run lock poisoned"))?;

    let PersistedState {
        models,
        channels,
        agents,
        bindings,
        experiments: _,
        gateway,
        execution_policy,
        execution_allowlist,
    } = persisted;

    let run_status = run_status_from(&run_state, &gateway);

    Ok(Snapshot {
        models,
        channels,
        agents,
        bindings,
        gateway,
        execution_policy,
        execution_allowlist,
        run_status,
    })
}

#[tauri::command]
fn get_resolved_config_paths() -> ResolvedConfigPaths {
    let (config_path, env_path) = resolve_apply_paths(None);
    let approvals_path = resolve_approvals_path(&config_path);
    ResolvedConfigPaths {
        config_path: config_path.display().to_string(),
        env_path: env_path.display().to_string(),
        approvals_path: approvals_path.display().to_string(),
    }
}

#[tauri::command]
fn get_channel_secret_values(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<ChannelSecretValues, CommandError> {
    let persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    let channel = persisted
        .channels
        .iter()
        .find(|c| c.id == channel_id)
        .cloned()
        .ok_or_else(|| err("ERR-ECLAW-0008", "Channelが見つかりません。"))?;
    drop(persisted);

    let secrets = state
        .secrets
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?;

    Ok(ChannelSecretValues {
        slack_bot_token: secret_value_by_refs(
            &secrets,
            channel.slack_bot_token_ref.as_ref(),
            channel.legacy_credential_ref.as_ref(),
        ),
        slack_app_token: secret_value_by_refs(
            &secrets,
            channel.slack_app_token_ref.as_ref(),
            channel.legacy_credential_ref.as_ref(),
        ),
        slack_signing_secret: secret_value_by_refs(
            &secrets,
            channel.slack_signing_secret_ref.as_ref(),
            channel.legacy_credential_ref.as_ref(),
        ),
        discord_bot_token: secret_value_by_refs(
            &secrets,
            channel.discord_bot_token_ref.as_ref(),
            channel.legacy_credential_ref.as_ref(),
        ),
        telegram_bot_token: secret_value_by_refs(
            &secrets,
            channel.telegram_bot_token_ref.as_ref(),
            channel.legacy_credential_ref.as_ref(),
        ),
    })
}

#[tauri::command]
fn list_workspace_skills(input: WorkspaceSkillsInput) -> Result<Vec<WorkspaceSkillItem>, CommandError> {
    let workspace = resolve_workspace_path(&input.workspace_path);
    list_workspace_skills_internal(&workspace)
}

#[tauri::command]
fn ensure_clawhub_available() -> Result<(), CommandError> {
    check_clawhub_installed()
}

#[tauri::command]
fn search_clawhub_skills(
    input: SearchClawhubSkillsInput,
) -> Result<Vec<ClawhubSkillItem>, CommandError> {
    check_clawhub_installed()?;
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(vec![]);
    }
    let limit = input.limit.unwrap_or(20).clamp(1, 50);
    let output = Command::new(clawhub_bin())
        .args(["search", query, "--limit", &limit.to_string()])
        .output()
        .map_err(|_| err("ERR-ECLAW-0102", "clawhub search の実行に失敗しました。"))?;
    if !output.status.success() {
        return Err(err("ERR-ECLAW-0102", "clawhub search の実行に失敗しました。"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_clawhub_search_stdout(&stdout))
}

#[tauri::command]
fn install_workspace_skill(
    input: InstallWorkspaceSkillInput,
) -> Result<Vec<WorkspaceSkillItem>, CommandError> {
    check_clawhub_installed()?;
    let slug = input.slug.trim();
    if slug.is_empty() {
        return Err(err("ERR-ECLAW-0103", "skill slug は必須です。"));
    }
    let workspace = resolve_workspace_path(&input.workspace_path);
    let status = Command::new(clawhub_bin())
        .args([
            "install",
            slug,
            "--workdir",
            &workspace.display().to_string(),
            "--dir",
            "skills",
        ])
        .status()
        .map_err(|_| err("ERR-ECLAW-0103", "clawhub install の実行に失敗しました。"))?;
    if !status.success() {
        return Err(err(
            "ERR-ECLAW-0103",
            "clawhub install に失敗しました。既存フォルダがある場合は削除して再実行してください。",
        ));
    }
    list_workspace_skills_internal(&workspace)
}

#[tauri::command]
fn set_gateway_config(
    input: SetGatewayConfigInput,
    state: State<'_, AppState>,
) -> Result<GatewaySettings, CommandError> {
    let gateway = validate_gateway_config(&input)?;
    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    persisted.gateway = gateway.clone();
    drop(persisted);
    push_log(&state, "info", "gateway draft updated");
    Ok(gateway)
}

#[tauri::command]
fn set_execution_policy(
    input: SetExecutionPolicyInput,
    state: State<'_, AppState>,
) -> Result<ExecutionPolicySettings, CommandError> {
    let execution_policy = validate_execution_policy(&input)?;
    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    persisted.execution_policy = execution_policy.clone();
    drop(persisted);
    push_log(&state, "info", "execution policy draft updated");
    Ok(execution_policy)
}

#[tauri::command]
fn set_execution_allowlist(
    input: SetExecutionAllowlistInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>, CommandError> {
    let normalized = input
        .patterns
        .into_iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();

    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    persisted.execution_allowlist = normalized.clone();
    drop(persisted);
    push_log(&state, "info", "execution allowlist draft updated");
    Ok(normalized)
}

#[tauri::command]
async fn create_model(
    input: CreateModelInput,
    state: State<'_, AppState>,
) -> Result<ModelCatalogItem, CommandError> {
    let base_url = normalize_base_url(input.base_url);
    validate_model_input(&input.provider_type, base_url.as_deref(), &input.model_name)?;
    let provider_type = input.provider_type;
    let openai_auth_mode = normalize_openai_auth_mode(&provider_type, input.openai_auth_mode);

    let model = ModelCatalogItem {
        id: gen_id("model"),
        provider_type,
        base_url,
        model_name: input.model_name.trim().to_string(),
        openai_auth_mode,
        api_key_ref: input.api_key.as_ref().map(|_| gen_id("secret-provider")),
        connection_options: HashMap::new(),
    };

    if let (Some(ref_key), Some(api_key)) = (&model.api_key_ref, input.api_key) {
        state
            .secrets
            .lock()
            .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?
            .items
            .insert(ref_key.clone(), api_key);
    }

    state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?
        .models
        .push(model.clone());

    push_log(&state, "info", format!("model created: {}", model.id));
    Ok(model)
}

#[tauri::command]
fn update_model(
    input: UpdateModelInput,
    state: State<'_, AppState>,
) -> Result<ModelCatalogItem, CommandError> {
    let base_url = normalize_base_url(input.base_url);
    validate_model_input(&input.provider_type, base_url.as_deref(), &input.model_name)?;

    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    let mut secrets = state
        .secrets
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?;

    let model = persisted
        .models
        .iter_mut()
        .find(|m| m.id == input.id)
        .ok_or_else(|| err("ERR-ECLAW-0007", "モデル定義が見つかりません。"))?;

    model.provider_type = input.provider_type;
    model.base_url = base_url;
    model.model_name = input.model_name.trim().to_string();
    model.openai_auth_mode =
        normalize_openai_auth_mode(&model.provider_type, input.openai_auth_mode);

    if let Some(api_key) = input.api_key {
        let ref_key = model
            .api_key_ref
            .clone()
            .unwrap_or_else(|| gen_id("secret-provider"));
        model.api_key_ref = Some(ref_key.clone());
        secrets.items.insert(ref_key, api_key);
    }

    let updated = model.clone();
    drop(persisted);
    drop(secrets);
    push_log(&state, "info", format!("model updated: {}", updated.id));
    Ok(updated)
}

#[tauri::command]
async fn probe_model(model_id: String, state: State<'_, AppState>) -> Result<String, CommandError> {
    let model = {
        let persisted = state
            .persisted
            .lock()
            .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
        persisted
            .models
            .iter()
            .find(|p| p.id == model_id)
            .cloned()
            .ok_or_else(|| err("ERR-ECLAW-0007", "モデル定義が見つかりません。"))?
    };
    if is_openai_oauth_model(&model) {
        return Ok("openai oauth model: skipped".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|_| err("ERR-ECLAW-0003", "Provider疎通がタイムアウトしました。"))?;

    let probe_url = ensure_model_probe_url(&model)?;
    validate_base_url_string(&probe_url)?;
    let req = client.get(probe_url);
    let response = req
        .send()
        .await
        .map_err(|_| err("ERR-ECLAW-0003", "Provider疎通がタイムアウトしました。"))?;

    if !response.status().is_success() {
        return Err(err(
            "ERR-ECLAW-0003",
            "Provider疎通がタイムアウトしました。",
        ));
    }

    Ok("ok".into())
}

fn sync_openai_oauth_models_from_files(state: &AppState) -> Result<usize, CommandError> {
    let fallback_persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?
        .clone();
    let fallback_secrets = state
        .secrets
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?
        .clone();
    let (loaded_persisted, loaded_secrets) =
        load_from_openclaw_files(fallback_persisted, fallback_secrets);

    let imported_models = loaded_persisted
        .models
        .into_iter()
        .filter(is_openai_oauth_model)
        .collect::<Vec<_>>();
    if imported_models.is_empty() {
        return Ok(0);
    }

    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    let mut secrets = state
        .secrets
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?;

    let mut synced = 0usize;
    for imported in imported_models {
        if let Some(existing) = persisted
            .models
            .iter_mut()
            .find(|m| is_openai_oauth_model(m) && m.model_name == imported.model_name)
        {
            existing.provider_type = imported.provider_type.clone();
            existing.base_url = imported.base_url.clone();
            existing.openai_auth_mode = imported.openai_auth_mode.clone();
            existing.connection_options = imported.connection_options.clone();
            if let Some(imported_ref) = imported.api_key_ref.as_ref() {
                if let Some(value) = loaded_secrets.items.get(imported_ref) {
                    let target_ref = existing
                        .api_key_ref
                        .clone()
                        .unwrap_or_else(|| gen_id("secret-provider"));
                    existing.api_key_ref = Some(target_ref.clone());
                    secrets.items.insert(target_ref, value.clone());
                }
            }
            synced += 1;
            continue;
        }

        let mut to_insert = imported.clone();
        if let Some(imported_ref) = imported.api_key_ref.as_ref() {
            if let Some(value) = loaded_secrets.items.get(imported_ref) {
                let target_ref = gen_id("secret-provider");
                to_insert.api_key_ref = Some(target_ref.clone());
                secrets.items.insert(target_ref, value.clone());
            }
        }
        persisted.models.push(to_insert);
        synced += 1;
    }
    Ok(synced)
}

#[tauri::command]
fn sync_openai_oauth_from_files(state: State<'_, AppState>) -> Result<OpenAiOauthLoginResult, CommandError> {
    let synced = sync_openai_oauth_models_from_files(&state)?;
    if synced > 0 {
        push_log(&state, "info", format!("openai oauth models synced: {synced}"));
    }
    Ok(OpenAiOauthLoginResult {
        summary: if synced > 0 {
            format!("OpenAI OAuth設定を再読込しました（{synced}件）。")
        } else {
            "OpenAI OAuth設定の更新はありませんでした。".to_string()
        },
    })
}

fn openai_oauth_onboard_context() -> (PathBuf, PathBuf, PathBuf, String) {
    let (resolved_config, _) = resolve_apply_paths(None);
    let state_dir = resolved_config
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(default_openclaw_state_dir);
    let workspace = state_dir.join("workspace");
    let config_path =
        std::env::temp_dir().join(format!("easy-openclaw-oauth-{}.json", gen_id("cfg")));
    let gateway_token = gen_id("gateway-token");
    (config_path, state_dir, workspace, gateway_token)
}

#[tauri::command]
fn login_openai_oauth(state: State<'_, AppState>) -> Result<OpenAiOauthLoginResult, CommandError> {
    let bin = openclaw_bin();
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut cmd = Command::new(&bin);
        cmd.args(["models", "auth", "login", "--provider", "openai-codex"]);
        cmd
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut cmd = Command::new("/usr/bin/script");
        cmd.args([
            "-q",
            "/dev/null",
            &bin,
            "models",
            "auth",
            "login",
            "--provider",
            "openai-codex",
        ]);
        cmd
    };

    let (resolved_config, _) = resolve_apply_paths(None);
    if resolved_config.exists() {
        cmd.env("OPENCLAW_CONFIG_PATH", &resolved_config);
        if let Some(parent) = resolved_config.parent() {
            cmd.env("OPENCLAW_STATE_DIR", parent);
        }
    }

    apply_command_platform_flags(&mut cmd);
    let output = cmd.output().map_err(|_| {
        err(
            "ERR-ECLAW-0024",
            "OpenAI OAuthログインの実行に失敗しました。openclaw コマンドを確認してください。",
        )
    })?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = extract_cli_error_detail(&stdout, &stderr);
        let msg = if let Some(detail_line) = detail {
            if detail_line.contains("No provider plugins found") {
                "OpenAI OAuthログインに失敗しました: Provider plugin が未導入です。先に「OAuthセットアップを開く」ボタンで対話セットアップを実行してください。".to_string()
            } else {
                format!("OpenAI OAuthログインに失敗しました: {detail_line}")
            }
        } else {
            "OpenAI OAuthログインに失敗しました。".to_string()
        };
        return Err(err("ERR-ECLAW-0024", &msg));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stdout_clean = strip_ansi_sequences(&stdout);
    let summary = if let Some(line) = stdout_clean
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .find(|line| !line.starts_with("OpenClaw "))
    {
        line.to_string()
    } else {
        "OpenAI OAuthログインが完了しました。".to_string()
    };
    let _ = sync_openai_oauth_models_from_files(&state);
    push_log(&state, "info", "openai oauth login done");
    Ok(OpenAiOauthLoginResult { summary })
}

#[tauri::command]
fn launch_openai_oauth_onboard() -> Result<OpenAiOauthLoginResult, CommandError> {
    let (config_path, state_dir, workspace, gateway_token) = openai_oauth_onboard_context();
    let bin = openclaw_bin();
    #[cfg(target_os = "windows")]
    let status = {
        let inner = format!(
            "set \"OPENCLAW_CONFIG_PATH={}\" && set \"OPENCLAW_STATE_DIR={}\" && {} onboard --flow manual --auth-choice openai-codex --mode local --workspace {} --gateway-port 18789 --gateway-bind loopback --gateway-auth token --gateway-token {} --skip-channels --skip-skills --skip-daemon --skip-health --skip-ui --accept-risk",
            config_path.display(),
            state_dir.display(),
            cmd_double_quote(&bin),
            cmd_double_quote(&workspace.display().to_string()),
            cmd_double_quote(&gateway_token)
        );
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", "cmd", "/C", &format!("\"{inner}\"")]);
        apply_command_platform_flags(&mut cmd);
        cmd.status()
            .map_err(|_| err("ERR-ECLAW-0024", "Terminal起動に失敗しました。"))
    }?;
    #[cfg(not(target_os = "windows"))]
    let status = {
        let shell_cmd = format!(
            "export OPENCLAW_CONFIG_PATH={}; export OPENCLAW_STATE_DIR={}; {} onboard --flow manual --auth-choice openai-codex --mode local --workspace {} --gateway-port 18789 --gateway-bind loopback --gateway-auth token --gateway-token {} --skip-channels --skip-skills --skip-daemon --skip-health --skip-ui --accept-risk; exit",
            sh_single_quote(&config_path.display().to_string()),
            sh_single_quote(&state_dir.display().to_string()),
            sh_single_quote(&bin),
            sh_single_quote(&workspace.display().to_string()),
            sh_single_quote(&gateway_token)
        );
        let escaped_shell_cmd = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
        let mut cmd = Command::new("osascript");
        cmd.arg("-e")
            .arg(r#"tell application "Terminal" to activate"#)
            .arg("-e")
            .arg(format!(
                r#"tell application "Terminal" to do script "{}""#,
                escaped_shell_cmd
            ));
        cmd.status()
            .map_err(|_| err("ERR-ECLAW-0024", "Terminal起動に失敗しました。"))
    }?;
    if !status.success() {
        return Err(err(
            "ERR-ECLAW-0024",
            "OpenAI OAuthセットアップを起動できませんでした。手動で onboard を実行してください。",
        ));
    }
    Ok(OpenAiOauthLoginResult {
        summary:
            "OpenAI Codex OAuth setup started in Terminal. Complete the browser sign-in, then return to easy-openclaw."
                .to_string(),
    })
}

#[tauri::command]
fn run_openai_oauth_onboard_auto() -> Result<OpenAiOauthLoginResult, CommandError> {
    launch_openai_oauth_onboard()
}

#[tauri::command]
fn run_openai_oauth_prefer_provider() -> Result<OpenAiOauthLoginResult, CommandError> {
    launch_openai_oauth_onboard()
}

fn npm_command_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn bundled_bin_file_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.cmd")
    } else {
        name.to_string()
    }
}

fn bundled_cli_bin(name: &str) -> Option<String> {
    let root = std::env::var("EASY_OPENCLAW_ROOT").ok()?;
    let path = PathBuf::from(root)
        .join("node_modules")
        .join(".bin")
        .join(bundled_bin_file_name(name));
    if path.exists() {
        Some(path.display().to_string())
    } else {
        None
    }
}

fn resolve_cli_bin(name: &str) -> String {
    bundled_cli_bin(name).unwrap_or_else(|| name.to_string())
}

fn openclaw_bin() -> String {
    std::env::var("OPENCLAW_GATEWAY_BIN").unwrap_or_else(|_| resolve_cli_bin("openclaw"))
}

fn clawhub_bin() -> String {
    resolve_cli_bin("clawhub")
}

fn command_failure_detail(stdout: &str, stderr: &str, fallback: &str) -> String {
    extract_cli_error_detail(stdout, stderr).unwrap_or_else(|| {
        let detail = strip_ansi_sequences(&format!("{stdout}\n{stderr}"));
        let lines = detail
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .rev()
            .take(6)
            .collect::<Vec<_>>();
        if lines.is_empty() {
            fallback.to_string()
        } else {
            lines.into_iter().rev().collect::<Vec<_>>().join("\n")
        }
    })
}

#[tauri::command]
fn run_maintenance_command(command: MaintenanceCommand) -> Result<MaintenanceCommandResult, CommandError> {
    let (package, label, args): (&str, &str, &[&str]) = match command {
        MaintenanceCommand::CheckOpenclawUpdate => ("openclaw", "OpenClaw", &["--version"]),
        MaintenanceCommand::CheckClawhubUpdate => ("clawhub", "Clawhub", &["--cli-version"]),
    };
    let current_bin = match package {
        "openclaw" => openclaw_bin(),
        "clawhub" => clawhub_bin(),
        _ => package.to_string(),
    };
    let installed = detect_cli_version(&current_bin, args);
    let mut cmd = Command::new(npm_command_name());
    cmd.args(["view", package, "version"]);
    apply_command_platform_flags(&mut cmd);
    let output = cmd
        .output()
        .map_err(|_| err("ERR-ECLAW-0024", "更新確認コマンドの実行に失敗しました。"))?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = command_failure_detail(
            &stdout,
            &stderr,
            "npm view の実行に失敗しました。",
        );
        return Err(err("ERR-ECLAW-0024", &detail));
    }
    let latest = strip_ansi_sequences(&String::from_utf8_lossy(&output.stdout))
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("unknown")
        .to_string();
    let summary = match installed.version {
        Some(current) if current == latest => {
            format!("{label} は最新です（{current}）。")
        }
        Some(current) => {
            format!("{label} の更新があります。現在: {current} / 最新: {latest}。更新するには easy-openclaw を再インストールしてください。")
        }
        None => {
            format!("{label} は未検出です。easy-openclaw の依存として同梱されるため、easy-openclaw を再インストールしてください。最新: {latest}。")
        }
    };
    Ok(MaintenanceCommandResult { summary })
}

fn extract_version_token(line: &str) -> Option<String> {
    for raw in line.split(|ch: char| ch.is_whitespace() || [',', ';', '(', ')'].contains(&ch)) {
        let token = raw.trim_matches(|ch: char| ['"', '\'', ':'].contains(&ch));
        if token.is_empty() || token.eq_ignore_ascii_case("installed") {
            continue;
        }
        if token.contains('.') && token.chars().any(|ch| ch.is_ascii_digit()) {
            return Some(token.to_string());
        }
    }
    None
}

fn detect_cli_version(bin: &str, args: &[&str]) -> MaintenanceToolStatus {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    apply_command_platform_flags(&mut cmd);
    let output = match cmd.output() {
        Ok(output) => output,
        Err(_) => {
            return MaintenanceToolStatus {
                installed: false,
                version: None,
            };
        }
    };

    let stdout = strip_ansi_sequences(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_sequences(&String::from_utf8_lossy(&output.stderr));
    let lines = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let version = lines.iter().find_map(|line| extract_version_token(line));
    MaintenanceToolStatus {
        installed: output.status.success() || version.is_some(),
        version,
    }
}

#[tauri::command]
fn get_maintenance_status() -> Result<MaintenanceStatusResult, CommandError> {
    let openclaw_path = openclaw_bin();
    let clawhub_path = clawhub_bin();
    Ok(MaintenanceStatusResult {
        openclaw: detect_cli_version(&openclaw_path, &["--version"]),
        clawhub: detect_cli_version(&clawhub_path, &["--cli-version"]),
    })
}

#[tauri::command]
fn delete_model(model_id: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;

    if let Some(agent) = persisted.agents.iter().find(|a| a.model_id == model_id) {
        let _ = agent;
        return Err(err(
            "ERR-ECLAW-0020",
            "このModelはAgentで使用中のため削除できません。",
        ));
    }

    let before = persisted.models.len();
    persisted.models.retain(|m| m.id != model_id);
    if before == persisted.models.len() {
        return Err(err("ERR-ECLAW-0007", "モデル定義が見つかりません。"));
    }
    drop(persisted);
    push_log(&state, "info", "model deleted from draft");
    Ok(())
}

#[tauri::command]
fn create_channel(
    input: CreateChannelInput,
    state: State<'_, AppState>,
) -> Result<Channel, CommandError> {
    validate_channel_input(&input)?;

    let channel_id = gen_id("channel");
    let account_id = {
        let persisted = state
            .persisted
            .lock()
            .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
        resolve_account_id_for_create(
            &persisted.channels,
            &input.channel_type,
            input.account_id.clone(),
        )
    };
    let mut secrets = state
        .secrets
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?;
    let channel = apply_channel_secrets(&channel_id, account_id, &input, &mut secrets);
    drop(secrets);

    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    persisted.channels.push(channel.clone());
    drop(persisted);

    push_log(&state, "info", format!("channel created: {}", channel.id));
    Ok(channel)
}

#[tauri::command]
fn update_channel(
    input: UpdateChannelInput,
    state: State<'_, AppState>,
) -> Result<Channel, CommandError> {
    let persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    let index = persisted
        .channels
        .iter()
        .position(|c| c.id == input.id)
        .ok_or_else(|| err("ERR-ECLAW-0008", "Channelが見つかりません。"))?;
    let existing = persisted.channels[index].clone();
    let owner = persisted.channels[index].owner_agent_id.clone();
    let fallback_account_id = persisted.channels[index].account_id.to_ascii_lowercase();
    let resolved_account_id = resolve_account_id_for_create(
        &persisted.channels,
        &input.channel_type,
        input.account_id.clone(),
    );
    drop(persisted);

    let mut secrets = state
        .secrets
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?;
    let create_like = CreateChannelInput {
        channel_type: input.channel_type.clone(),
        account_id: input.account_id.clone(),
        slack_channels: input.slack_channels.clone(),
        display_name: input.display_name.clone(),
        slack_bot_token: input.slack_bot_token.clone().or_else(|| {
            secret_value_by_refs(
                &secrets,
                existing.slack_bot_token_ref.as_ref(),
                existing.legacy_credential_ref.as_ref(),
            )
        }),
        slack_app_token: input.slack_app_token.clone().or_else(|| {
            secret_value_by_refs(
                &secrets,
                existing.slack_app_token_ref.as_ref(),
                existing.legacy_credential_ref.as_ref(),
            )
        }),
        slack_signing_secret: input.slack_signing_secret.clone().or_else(|| {
            secret_value_by_refs(
                &secrets,
                existing.slack_signing_secret_ref.as_ref(),
                existing.legacy_credential_ref.as_ref(),
            )
        }),
        discord_bot_token: input.discord_bot_token.clone().or_else(|| {
            secret_value_by_refs(
                &secrets,
                existing.discord_bot_token_ref.as_ref(),
                existing.legacy_credential_ref.as_ref(),
            )
        }),
        telegram_bot_token: input.telegram_bot_token.clone().or_else(|| {
            secret_value_by_refs(
                &secrets,
                existing.telegram_bot_token_ref.as_ref(),
                existing.legacy_credential_ref.as_ref(),
            )
        }),
    };
    validate_channel_input(&create_like)?;

    let account_id = if input
        .account_id
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        fallback_account_id
    } else {
        resolved_account_id
    };
    let mut channel = apply_channel_secrets(&input.id, account_id, &create_like, &mut secrets);
    channel.owner_agent_id = owner;
    drop(secrets);

    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    let idx = persisted
        .channels
        .iter()
        .position(|c| c.id == input.id)
        .ok_or_else(|| err("ERR-ECLAW-0008", "Channelが見つかりません。"))?;
    persisted.channels[idx] = channel.clone();
    drop(persisted);

    push_log(&state, "info", format!("channel updated: {}", channel.id));
    Ok(channel)
}

#[tauri::command]
fn delete_channel(channel_id: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;

    if let Some(agent) = persisted
        .agents
        .iter()
        .find(|a| a.channel_id.as_deref() == Some(channel_id.as_str()))
    {
        let _ = agent;
        return Err(err(
            "ERR-ECLAW-0021",
            "このChannelはAgentで使用中のため削除できません。",
        ));
    }
    if let Some(binding) = persisted
        .bindings
        .iter()
        .find(|b| b.channel_id == channel_id)
    {
        let _ = binding;
        return Err(err(
            "ERR-ECLAW-0021",
            "このChannelはAgentで使用中のため削除できません。",
        ));
    }

    let before = persisted.channels.len();
    persisted.channels.retain(|c| c.id != channel_id);
    if before == persisted.channels.len() {
        return Err(err("ERR-ECLAW-0008", "Channelが見つかりません。"));
    }
    drop(persisted);
    push_log(&state, "info", "channel deleted from draft");
    Ok(())
}

#[tauri::command]
async fn probe_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    let (channel, credential) = {
        let persisted = state
            .persisted
            .lock()
            .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
        let secrets = state
            .secrets
            .lock()
            .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?;
        let ch = persisted
            .channels
            .iter()
            .find(|c| c.id == channel_id)
            .cloned()
            .ok_or_else(|| err("ERR-ECLAW-0008", "Channelが見つかりません。"))?;
        let token_ref = match ch.channel_type {
            ChannelType::Slack => ch
                .slack_bot_token_ref
                .as_ref()
                .or(ch.legacy_credential_ref.as_ref()),
            ChannelType::Discord => ch
                .discord_bot_token_ref
                .as_ref()
                .or(ch.legacy_credential_ref.as_ref()),
            ChannelType::Telegram => ch
                .telegram_bot_token_ref
                .as_ref()
                .or(ch.legacy_credential_ref.as_ref()),
        }
        .ok_or_else(|| err("ERR-ECLAW-0004", "Channel必須情報を入力してください。"))?;
        let token = secrets
            .items
            .get(token_ref)
            .cloned()
            .ok_or_else(|| err("ERR-ECLAW-0004", "Channel必須情報を入力してください。"))?;
        (ch, token)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|_| err("ERR-ECLAW-0006", "チャネル疎通に失敗しました。"))?;

    let res = match channel.channel_type {
        ChannelType::Slack => {
            client
                .get("https://slack.com/api/auth.test")
                .bearer_auth(credential)
                .send()
                .await
        }
        ChannelType::Discord => {
            client
                .get("https://discord.com/api/v10/users/@me")
                .header("Authorization", format!("Bot {}", credential))
                .send()
                .await
        }
        ChannelType::Telegram => {
            client
                .get(format!("https://api.telegram.org/bot{}/getMe", credential))
                .send()
                .await
        }
    }
    .map_err(|_| err("ERR-ECLAW-0006", "チャネル疎通に失敗しました。"))?;

    if !res.status().is_success() {
        return Err(err(
            "ERR-ECLAW-0005",
            "認証に失敗しました。トークンを確認してください。",
        ));
    }

    Ok("ok".into())
}

#[tauri::command]
fn upsert_agent(
    input: UpsertAgentInput,
    state: State<'_, AppState>,
) -> Result<Agent, CommandError> {
    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;

    if !persisted.models.iter().any(|p| p.id == input.model_id) {
        return Err(err(
            "ERR-ECLAW-0007",
            "モデル定義が見つかりません。再選択してください。",
        ));
    }

    enforce_channel_assignment(
        &mut persisted,
        input.id.as_deref(),
        input.channel_id.as_deref(),
        input.force_rebind.unwrap_or(false),
    )?;

    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| gen_id("agent"));
    let display_name = input
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| id.clone());
    let security = validate_agent_security(
        input.security,
        &persisted.execution_policy.security,
        &persisted.execution_policy.ask,
        &persisted.execution_allowlist,
    )?;
    let agent = Agent {
        id: id.clone(),
        display_name,
        model_id: input.model_id,
        model_override: input.model_override,
        channel_id: input.channel_id.clone(),
        workspace_path: input.workspace_path,
        security,
    };

    if let Some(idx) = persisted.agents.iter().position(|a| a.id == id) {
        persisted.agents[idx] = agent.clone();
    } else {
        persisted.agents.push(agent.clone());
    }

    persisted.bindings.retain(|b| b.agent_id != agent.id);
    if let Some(channel_id) = agent.channel_id.clone() {
        if let Some(other) = persisted
            .bindings
            .iter()
            .find(|b| b.channel_id == channel_id && b.agent_id != agent.id)
            .cloned()
        {
            persisted.bindings.retain(|b| b.channel_id != channel_id);
            if let Some(old) = persisted.agents.iter_mut().find(|a| a.id == other.agent_id) {
                old.channel_id = None;
            }
        }
        persisted.bindings.push(BindingRule {
            agent_id: agent.id.clone(),
            channel_id,
        });
    }

    for channel in &mut persisted.channels {
        if channel.owner_agent_id.as_deref() == Some(&agent.id) {
            channel.owner_agent_id = None;
        }
        if agent.channel_id.as_deref() == Some(&channel.id) {
            channel.owner_agent_id = Some(agent.id.clone());
        }
    }

    drop(persisted);
    push_log(&state, "info", format!("agent upserted: {}", agent.id));
    Ok(agent)
}

#[tauri::command]
fn delete_agent(agent_id: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?;
    let before = persisted.agents.len();
    persisted.agents.retain(|a| a.id != agent_id);
    if before == persisted.agents.len() {
        return Err(err(
            "ERR-ECLAW-0010",
            "設定が不足しています。入力を確認してください。",
        ));
    }
    persisted.bindings.retain(|b| b.agent_id != agent_id);
    for channel in &mut persisted.channels {
        if channel.owner_agent_id.as_deref() == Some(&agent_id) {
            channel.owner_agent_id = None;
        }
    }
    drop(persisted);
    push_log(&state, "info", "agent deleted from draft");
    Ok(())
}

#[tauri::command]
fn apply_config(
    input: ApplyConfigInput,
    state: State<'_, AppState>,
) -> Result<ApplyConfigResult, CommandError> {
    let persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?
        .clone();
    let secrets = state
        .secrets
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "secret lock poisoned"))?
        .clone();

    let (config_path, env_path) = resolve_apply_paths(input.target_dir);
    let approvals_path = resolve_approvals_path(&config_path);
    maybe_migrate_legacy_openclaw_files(&config_path, &env_path)
        .map_err(|_| err("ERR-ECLAW-0011", "設定ファイルの保存に失敗しました。"))?;

    let (generated_config_text, env_text) = build_output_files(&persisted, &secrets)?;
    let generated_config_value: serde_json::Value = serde_json::from_str(&generated_config_text)
        .map_err(|_| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;

    let config_value = if config_path.exists() {
        backup_existing_file(&config_path)
            .map_err(|_| err("ERR-ECLAW-0011", "設定ファイルの保存に失敗しました。"))?;
        let text = fs::read_to_string(&config_path)
            .map_err(|_| err("ERR-ECLAW-0012", "既存設定の読み込みに失敗しました。"))?;
        let existing: serde_json::Value = json5::from_str(&text)
            .or_else(|_| serde_json::from_str(&text))
            .map_err(|_| err("ERR-ECLAW-0012", "既存設定の読み込みに失敗しました。"))?;
        merge_openclaw_config(existing, generated_config_value)
    } else {
        generated_config_value
    };

    let mut config_value = config_value;
    normalize_openclaw_config(&mut config_value);

    let config_text = serde_json::to_string_pretty(&config_value)
        .map_err(|_| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;

    let generated_approvals_value = build_exec_approvals_json(&persisted);
    let approvals_value = if approvals_path.exists() {
        backup_existing_file(&approvals_path)
            .map_err(|_| err("ERR-ECLAW-0011", "設定ファイルの保存に失敗しました。"))?;
        let text = fs::read_to_string(&approvals_path)
            .map_err(|_| err("ERR-ECLAW-0012", "既存設定の読み込みに失敗しました。"))?;
        let existing: serde_json::Value = json5::from_str(&text)
            .or_else(|_| serde_json::from_str(&text))
            .map_err(|_| err("ERR-ECLAW-0012", "既存設定の読み込みに失敗しました。"))?;
        merge_exec_approvals(existing, generated_approvals_value)
    } else {
        generated_approvals_value
    };
    let approvals_text = serde_json::to_string_pretty(&approvals_value)
        .map_err(|_| err("ERR-ECLAW-0012", "設定形式の検証に失敗しました。"))?;

    write_atomic(&config_path, &config_text)
        .map_err(|_| err("ERR-ECLAW-0011", "設定ファイルの保存に失敗しました。"))?;
    write_atomic(&env_path, &env_text)
        .map_err(|_| err("ERR-ECLAW-0011", "設定ファイルの保存に失敗しました。"))?;
    write_atomic(&approvals_path, &approvals_text)
        .map_err(|_| err("ERR-ECLAW-0011", "設定ファイルの保存に失敗しました。"))?;
    let created_bootstraps = ensure_workspace_bootstrap_files(&persisted)
        .map_err(|_| err("ERR-ECLAW-0024", "BOOTSTRAP.md の作成に失敗しました。"))?;
    for path in created_bootstraps {
        push_log(&state, "info", format!("bootstrap created: {path}"));
    }

    push_log(&state, "info", "config applied");
    Ok(ApplyConfigResult {
        config_path: config_path.display().to_string(),
        env_path: env_path.display().to_string(),
        approvals_path: approvals_path.display().to_string(),
    })
}

#[tauri::command]
async fn start_gateway(
    input: StartGatewayInput,
    state: State<'_, AppState>,
) -> Result<RunStatus, CommandError> {
    let gateway_cfg = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?
        .gateway
        .clone();

    if input.mode == RunMode::A && gateway_cfg.mode == GatewayMode::Local {
        let port = gateway_cfg.port.unwrap_or(18789);
        if is_port_listening(port) {
            return Err(err(
                "ERR-ECLAW-0015",
                "ポートが使用中のため Start できません。",
            ));
        }
    }

    let health_url = {
        let mut run = state
            .run_state
            .lock()
            .map_err(|_| err("ERR-ECLAW-0000", "run lock poisoned"))?;

        if let Some(child) = run.child.as_mut() {
            if child.try_wait().ok().flatten().is_none() {
                return Err(err("ERR-ECLAW-0015", "既存gatewayが稼働中です。"));
            }
        }
        run.child = None;
        run.mode = input.mode.clone();
        run.dashboard_url = dashboard_url_from_gateway(&gateway_cfg);
        run.health = "starting".into();

        if input.mode == RunMode::A {
            let bin = openclaw_bin();
            let args_line =
                std::env::var("OPENCLAW_GATEWAY_ARGS").unwrap_or_else(|_| "gateway".into());
            let mut cmd = Command::new(bin);
            for arg in args_line.split_whitespace() {
                cmd.arg(arg);
            }
            let (resolved_config, _) = resolve_apply_paths(None);
            let resolved_env = resolved_config
                .parent()
                .map(|p| p.join(".env"))
                .unwrap_or_else(|| PathBuf::from(".env"));
            let _ = maybe_migrate_legacy_openclaw_files(&resolved_config, &resolved_env);
            let env_vars = load_env_file(&resolved_env);
            if resolved_config.exists() {
                cmd.env("OPENCLAW_CONFIG_PATH", &resolved_config);
                if let Some(parent) = resolved_config.parent() {
                    cmd.env("OPENCLAW_STATE_DIR", parent);
                }
            }
            if !env_vars.is_empty() {
                cmd.envs(&env_vars);
            }
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

            let mut child = cmd
                .spawn()
                .map_err(|_| err("ERR-ECLAW-0013", "gateway起動に失敗しました。"))?;

            if let Some(stdout) = child.stdout.take() {
                let logs = Arc::clone(&state.logs);
                std::thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines().map_while(Result::ok) {
                        if let Ok(mut log_buf) = logs.lock() {
                            if log_buf.len() > 500 {
                                log_buf.pop_front();
                            }
                            log_buf.push_back(LogLine {
                                ts: now_ts(),
                                level: "stdout".into(),
                                message: line,
                            });
                        }
                    }
                });
            }

            if let Some(stderr) = child.stderr.take() {
                let logs = Arc::clone(&state.logs);
                std::thread::spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines().map_while(Result::ok) {
                        if let Ok(mut log_buf) = logs.lock() {
                            if log_buf.len() > 500 {
                                log_buf.pop_front();
                            }
                            log_buf.push_back(LogLine {
                                ts: now_ts(),
                                level: "stderr".into(),
                                message: line,
                            });
                        }
                    }
                });
            }

            run.child = Some(child);
        }

        std::env::var("OPENCLAW_HEALTH_URL").unwrap_or_else(|_| match gateway_cfg.mode {
            GatewayMode::Local => {
                let port = gateway_cfg.port.unwrap_or(18789);
                format!("http://127.0.0.1:{port}/health")
            }
            GatewayMode::Remote => format!("{}/health", run.dashboard_url.trim_end_matches('/')),
        })
    };

    let timeout = input.health_timeout_sec.unwrap_or(30).clamp(1, 120);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| err("ERR-ECLAW-0014", "ヘルスチェックがタイムアウトしました。"))?;

    let started = SystemTime::now();
    let mut ok = false;
    while SystemTime::now()
        .duration_since(started)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs()
        < timeout
    {
        if let Ok(r) = client.get(&health_url).send().await {
            if health_ok(r.status()) {
                ok = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let mut run = state
        .run_state
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "run lock poisoned"))?;
    run.health = if ok { "ready".into() } else { "failed".into() };

    if !ok {
        return Err(err(
            "ERR-ECLAW-0014",
            "ヘルスチェックがタイムアウトしました。",
        ));
    }

    push_log(&state, "info", format!("gateway started: {}", run.dashboard_url));
    Ok(run_status_from(&run, &gateway_cfg))
}

#[tauri::command]
fn gateway_stop_command() -> Command {
    let bin = openclaw_bin();
    let args_line =
        std::env::var("OPENCLAW_GATEWAY_STOP_ARGS").unwrap_or_else(|_| "gateway stop".into());
    let mut cmd = Command::new(bin);
    for arg in args_line.split_whitespace() {
        cmd.arg(arg);
    }
    let (resolved_config, _) = resolve_apply_paths(None);
    if resolved_config.exists() {
        cmd.env("OPENCLAW_CONFIG_PATH", &resolved_config);
        if let Some(parent) = resolved_config.parent() {
            cmd.env("OPENCLAW_STATE_DIR", parent);
        }
    }
    apply_command_platform_flags(&mut cmd);
    cmd
}

fn run_gateway_stop_command(wait: bool) {
    if wait {
        let mut cmd = gateway_stop_command();
        if let Ok(mut child) = cmd.spawn() {
            let started = SystemTime::now();
            loop {
                if child.try_wait().ok().flatten().is_some() {
                    break;
                }
                if SystemTime::now()
                    .duration_since(started)
                    .unwrap_or_else(|_| Duration::from_secs(0))
                    >= Duration::from_secs(5)
                {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        return;
    }

    std::thread::spawn(|| {
        let mut cmd = gateway_stop_command();
        let _ = cmd.status();
    });
}

fn stop_gateway_inner(state: &AppState, wait: bool) -> Result<RunStatus, CommandError> {
    let gateway_cfg = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "state lock poisoned"))?
        .gateway
        .clone();

    let child = {
        let mut run = state
            .run_state
            .lock()
            .map_err(|_| err("ERR-ECLAW-0000", "run lock poisoned"))?;
        run.health = "stopped".into();
        run.child.take()
    };

    if let Some(mut child) = child {
        if wait {
            let _ = child.kill();
            let _ = child.wait();
        } else {
            std::thread::spawn(move || {
                let _ = child.kill();
                let _ = child.wait();
            });
        }
    }

    run_gateway_stop_command(wait);

    let run = state
        .run_state
        .lock()
        .map_err(|_| err("ERR-ECLAW-0000", "run lock poisoned"))?;
    push_log(&state, "info", "gateway stopped");
    Ok(run_status_from(&run, &gateway_cfg))
}

#[tauri::command]
fn stop_gateway(state: State<'_, AppState>) -> Result<RunStatus, CommandError> {
    stop_gateway_inner(&state, false)
}

#[tauri::command]
fn stop_gateway_for_exit(state: State<'_, AppState>) -> Result<RunStatus, CommandError> {
    stop_gateway_inner(&state, true)
}

#[tauri::command]
fn get_logs(state: State<'_, AppState>) -> Result<Vec<LogLine>, CommandError> {
    let logs = state.logs.lock().map_err(|_| {
        err(
            "ERR-ECLAW-0016",
            "ログ取得に失敗しました。再接続してください。",
        )
    })?;
    Ok(logs.iter().cloned().collect())
}

#[tauri::command]
fn record_experiment(
    input: ExperimentInput,
    state: State<'_, AppState>,
) -> Result<ExperimentRecord, CommandError> {
    validate_experiment_input(&input.case_id, &input.result)?;

    let record = ExperimentRecord {
        id: gen_id("exp"),
        case_id: input.case_id,
        mode: input.mode,
        result: input.result,
        observed_error: input.observed_error,
        note: input.note,
        recorded_at: now_ts(),
    };

    state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0019", "実験記録を保存できませんでした。"))?
        .experiments
        .push(record.clone());
    persist(&state).map_err(|_| err("ERR-ECLAW-0019", "実験記録を保存できませんでした。"))?;
    Ok(record)
}

#[tauri::command]
fn list_experiments(state: State<'_, AppState>) -> Result<Vec<ExperimentRecord>, CommandError> {
    let persisted = state
        .persisted
        .lock()
        .map_err(|_| err("ERR-ECLAW-0019", "実験記録を保存できませんでした。"))?;
    Ok(persisted.experiments.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = data_dir();
    let (persisted, secrets) = load_or_default(&root);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            persisted: Mutex::new(persisted),
            secrets: Mutex::new(secrets),
            run_state: Mutex::new(RunState::default()),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            data_dir: root,
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_channel_secret_values,
            list_workspace_skills,
            ensure_clawhub_available,
            search_clawhub_skills,
            install_workspace_skill,
            set_gateway_config,
            set_execution_policy,
            set_execution_allowlist,
            create_model,
            update_model,
            probe_model,
            list_provider_model_candidates,
            sync_openai_oauth_from_files,
            login_openai_oauth,
            run_openai_oauth_prefer_provider,
            launch_openai_oauth_onboard,
            run_openai_oauth_onboard_auto,
            get_maintenance_status,
            run_maintenance_command,
            delete_model,
            create_channel,
            update_channel,
            delete_channel,
            probe_channel,
            upsert_agent,
            delete_agent,
            apply_config,
            start_gateway,
            stop_gateway,
            stop_gateway_for_exit,
            get_logs,
            record_experiment,
            list_experiments,
            get_resolved_config_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_generation_has_prefix() {
        let id = gen_id("model");
        assert!(id.starts_with("model-"));
    }

    #[test]
    fn health_status_accepts_200_and_204() {
        assert!(health_ok(StatusCode::OK));
        assert!(health_ok(StatusCode::NO_CONTENT));
        assert!(!health_ok(StatusCode::BAD_REQUEST));
    }

    #[test]
    fn atomic_write_creates_file() {
        let tmp_dir = std::env::temp_dir().join(gen_id("easy-openclaw-test"));
        let _ = fs::create_dir_all(&tmp_dir);
        let path = tmp_dir.join("sample.txt");
        write_atomic(&path, "hello").expect("write should succeed");
        let content = fs::read_to_string(&path).expect("content should exist");
        assert_eq!(content, "hello");
        let _ = fs::remove_dir_all(tmp_dir);
    }

    #[test]
    fn parse_env_line_supports_comments_export_and_quotes() {
        assert_eq!(parse_env_line(""), None);
        assert_eq!(parse_env_line("# comment"), None);
        assert_eq!(
            parse_env_line("export SLACK_BOT_TOKEN=xoxb-123"),
            Some(("SLACK_BOT_TOKEN".into(), "xoxb-123".into()))
        );
        assert_eq!(
            parse_env_line("OPENCLAW_GATEWAY_TOKEN=\"claw\""),
            Some(("OPENCLAW_GATEWAY_TOKEN".into(), "claw".into()))
        );
    }

    #[test]
    fn load_env_file_reads_key_values() {
        let tmp_dir = std::env::temp_dir().join(gen_id("easy-openclaw-env"));
        let _ = fs::create_dir_all(&tmp_dir);
        let env_path = tmp_dir.join(".env");
        fs::write(
            &env_path,
            "# test\nexport A=1\nB=\"two\"\nINVALID\nC='three'\n",
        )
        .expect("must write env file");

        let vars = load_env_file(&env_path);
        assert_eq!(vars.get("A").map(String::as_str), Some("1"));
        assert_eq!(vars.get("B").map(String::as_str), Some("two"));
        assert_eq!(vars.get("C").map(String::as_str), Some("three"));
        assert!(!vars.contains_key("INVALID"));

        let _ = fs::remove_dir_all(tmp_dir);
    }

    #[test]
    fn model_input_validation_checks_url_and_required_fields() {
        let ok = validate_model_input(
            &ProviderType::Compatible,
            Some("http://localhost:1234/v1"),
            "gpt-4o-mini",
        );
        assert!(ok.is_ok());
        assert_eq!(
            validate_model_input(&ProviderType::Compatible, None, "x")
                .expect_err("should fail")
                .code,
            "ERR-ECLAW-0001"
        );
        assert!(validate_model_input(&ProviderType::OpenAi, None, "gpt-4o-mini").is_ok());
        assert_eq!(
            validate_model_input(&ProviderType::Compatible, Some("not-url"), "x")
                .expect_err("should fail")
                .code,
            "ERR-ECLAW-0002"
        );
    }

    #[test]
    fn enforce_channel_assignment_respects_single_owner_rule() {
        let mut state = PersistedState {
            models: vec![],
            channels: vec![Channel {
                id: "channel-1".into(),
                account_id: "default".into(),
                slack_channels: vec!["C0123456789".into()],
                display_name: None,
                channel_type: ChannelType::Slack,
                slack_bot_token_ref: Some("secret".into()),
                slack_app_token_ref: Some("secret".into()),
                slack_signing_secret_ref: None,
                discord_bot_token_ref: None,
                telegram_bot_token_ref: None,
                legacy_credential_ref: None,
                owner_agent_id: Some("agent-old".into()),
            }],
            agents: vec![Agent {
                id: "agent-old".into(),
                display_name: "old".into(),
                model_id: "model-1".into(),
                model_override: None,
                channel_id: Some("channel-1".into()),
                workspace_path: None,
                security: AgentSecuritySettings::default(),
            }],
            bindings: vec![],
            experiments: vec![],
            gateway: GatewaySettings::default(),
            execution_policy: ExecutionPolicySettings::default(),
            execution_allowlist: vec![],
        };

        let blocked =
            enforce_channel_assignment(&mut state, Some("agent-new"), Some("channel-1"), false)
                .expect_err("must block without force");
        assert_eq!(blocked.code, "ERR-ECLAW-0009");

        enforce_channel_assignment(&mut state, Some("agent-new"), Some("channel-1"), true)
            .expect("force reassign should pass");
        let old = state
            .agents
            .iter()
            .find(|a| a.id == "agent-old")
            .expect("old agent must exist");
        assert!(old.channel_id.is_none());
    }

    #[test]
    fn build_output_files_requires_agent_and_includes_secret_refs() {
        let no_agent = PersistedState::default();
        let empty_secret = SecretStore::default();
        let err = build_output_files(&no_agent, &empty_secret).expect_err("agent required");
        assert_eq!(err.code, "ERR-ECLAW-0010");

        let state = PersistedState {
            models: vec![ModelCatalogItem {
                id: "model-1".into(),
                provider_type: ProviderType::LmStudio,
                base_url: Some("http://localhost:1234/v1".into()),
                model_name: "m".into(),
                openai_auth_mode: None,
                api_key_ref: None,
                connection_options: HashMap::new(),
            }],
            channels: vec![Channel {
                id: "channel-1".into(),
                account_id: "Slack-001".into(),
                slack_channels: vec!["C0123456789".into()],
                display_name: None,
                channel_type: ChannelType::Slack,
                slack_bot_token_ref: Some("secret-channel-1-slack_bot".into()),
                slack_app_token_ref: Some("secret-channel-1-slack_app".into()),
                slack_signing_secret_ref: None,
                discord_bot_token_ref: None,
                telegram_bot_token_ref: None,
                legacy_credential_ref: None,
                owner_agent_id: None,
            }],
            agents: vec![Agent {
                id: "agent-1".into(),
                display_name: "main".into(),
                model_id: "model-1".into(),
                model_override: None,
                channel_id: Some("channel-1".into()),
                workspace_path: None,
                security: AgentSecuritySettings::default(),
            }],
            bindings: vec![BindingRule {
                agent_id: "agent-1".into(),
                channel_id: "channel-1".into(),
            }],
            experiments: vec![],
            gateway: GatewaySettings::default(),
            execution_policy: ExecutionPolicySettings::default(),
            execution_allowlist: vec!["/opt/homebrew/bin/rg".into()],
        };
        let mut sec = SecretStore::default();
        sec.items
            .insert("secret-provider-1".into(), "token123".into());
        sec.items
            .insert("secret-channel-1-slack_bot".into(), "xoxb-test".into());
        sec.items
            .insert("secret-channel-1-slack_app".into(), "xapp-test".into());

        let (config, env) = build_output_files(&state, &sec).expect("must build");
        assert!(config.contains("\"bindings\""));
        assert!(config.contains("\"gateway\""));
        assert!(config.contains("\"tools\""));
        assert!(config.contains("\"exec\""));
        assert!(config.contains("\"security\": \"allowlist\""));
        assert!(config.contains("\"ask\": \"on-miss\""));
        assert!(config.contains("\"mode\": \"local\""));
        assert!(config.contains("\"mode\": \"socket\""));
        assert!(config.contains("\"replyToMode\": \"off\""));
        assert!(!config.contains("streamMode"));
        assert!(config.contains("\"slack-001\""));
        assert!(config.contains("\"C0123456789\""));
        assert!(config.contains("xoxb-test"));
        assert!(config.contains("xapp-test"));
        assert!(env.contains("SECRET_PROVIDER_1=token123"));
    }

    #[test]
    fn build_output_files_allows_agent_without_channel() {
        let state = PersistedState {
            models: vec![ModelCatalogItem {
                id: "model-1".into(),
                provider_type: ProviderType::LmStudio,
                base_url: Some("http://localhost:1234/v1".into()),
                model_name: "m".into(),
                openai_auth_mode: None,
                api_key_ref: None,
                connection_options: HashMap::new(),
            }],
            channels: vec![],
            agents: vec![Agent {
                id: "agent-1".into(),
                display_name: "main".into(),
                model_id: "model-1".into(),
                model_override: None,
                channel_id: None,
                workspace_path: None,
                security: AgentSecuritySettings::default(),
            }],
            bindings: vec![],
            experiments: vec![],
            gateway: GatewaySettings::default(),
            execution_policy: ExecutionPolicySettings::default(),
            execution_allowlist: vec![],
        };
        let secrets = SecretStore::default();

        let (config, env) = build_output_files(&state, &secrets).expect("channel is optional");
        let parsed: serde_json::Value = serde_json::from_str(&config).expect("valid json");
        assert_eq!(parsed["agents"]["list"][0]["id"], "agent-1");
        let workspace = parsed["agents"]["list"][0]["workspace"]
            .as_str()
            .expect("workspace emitted");
        assert_eq!(workspace, default_workspace_dir().display().to_string());
        assert_eq!(parsed["bindings"].as_array().map(Vec::len), Some(0));
        assert!(env.is_empty());
    }

    #[test]
    fn ensure_workspace_bootstrap_files_creates_file_without_shell() {
        let tmp_dir = std::env::temp_dir().join(gen_id("easy-openclaw-bootstrap"));
        let state = PersistedState {
            agents: vec![Agent {
                id: "agent-1".into(),
                display_name: "main".into(),
                model_id: "model-1".into(),
                model_override: None,
                channel_id: None,
                workspace_path: Some(tmp_dir.display().to_string()),
                security: AgentSecuritySettings::default(),
            }],
            ..PersistedState::default()
        };

        let created = ensure_workspace_bootstrap_files(&state).expect("bootstrap file created");
        let bootstrap = tmp_dir.join("BOOTSTRAP.md");
        assert_eq!(created.len(), 1);
        assert!(bootstrap.exists());
        let text = fs::read_to_string(&bootstrap).expect("bootstrap readable");
        assert!(text.contains("initialized by easy-openclaw"));
        let _ = fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn openai_oauth_model_outputs_openai_codex_without_openai_api_key() {
        let state = PersistedState {
            models: vec![ModelCatalogItem {
                id: "model-oauth".into(),
                provider_type: ProviderType::OpenAi,
                base_url: None,
                model_name: "gpt-5.3-codex".into(),
                openai_auth_mode: Some(OpenAiAuthMode::Oauth),
                api_key_ref: None,
                connection_options: HashMap::new(),
            }],
            channels: vec![Channel {
                id: "channel-1".into(),
                account_id: "slack-001".into(),
                slack_channels: vec!["C0123456789".into()],
                display_name: None,
                channel_type: ChannelType::Slack,
                slack_bot_token_ref: Some("secret-channel-1-slack_bot".into()),
                slack_app_token_ref: Some("secret-channel-1-slack_app".into()),
                slack_signing_secret_ref: None,
                discord_bot_token_ref: None,
                telegram_bot_token_ref: None,
                legacy_credential_ref: None,
                owner_agent_id: None,
            }],
            agents: vec![Agent {
                id: "agent-main".into(),
                display_name: "main".into(),
                model_id: "model-oauth".into(),
                model_override: None,
                channel_id: Some("channel-1".into()),
                workspace_path: None,
                security: AgentSecuritySettings::default(),
            }],
            bindings: vec![BindingRule {
                agent_id: "agent-main".into(),
                channel_id: "channel-1".into(),
            }],
            experiments: vec![],
            gateway: GatewaySettings::default(),
            execution_policy: ExecutionPolicySettings::default(),
            execution_allowlist: vec![],
        };
        let mut sec = SecretStore::default();
        sec.items
            .insert("secret-channel-1-slack_bot".into(), "xoxb-test".into());
        sec.items
            .insert("secret-channel-1-slack_app".into(), "xapp-test".into());

        let (config, env) = build_output_files(&state, &sec).expect("must build");
        assert!(config.contains("openai-codex/gpt-5.3-codex"));
        assert!(!env.contains("OPENAI_API_KEY="));
    }

    #[test]
    fn experiment_validation_rejects_empty_inputs() {
        assert!(validate_experiment_input("case-a", "success").is_ok());
        let err = validate_experiment_input("", "success").expect_err("must fail");
        assert_eq!(err.code, "ERR-ECLAW-0018");
    }

    #[test]
    fn merge_openclaw_config_preserves_unmanaged_fields_and_replaces_managed_sections() {
        let existing = serde_json::json!({
            "custom": { "keep": true },
            "agents": {
                "defaults": { "models": { "legacy/model": { "alias": "legacy" } } },
                "list": [{ "id": "legacy-agent", "name": "legacy", "model": "legacy/model" }]
            },
            "models": {
                "providers": {
                    "openai": {
                        "api": "openai",
                        "models": [{ "id": "gpt-4o", "name": "gpt-4o" }],
                        "extra": "keep"
                    }
                }
            },
            "channels": {
                "slack": {
                    "enabled": true,
                    "accounts": {
                        "slack-001": { "enabled": true }
                    }
                }
            },
            "bindings": [{
                "agentId": "legacy-agent",
                "match": { "channel": "slack", "accountId": "Slack-999" }
            }]
        });
        let generated = serde_json::json!({
            "agents": {
                "defaults": { "models": { "openai/gpt-4.1-mini": { "alias": "gpt-4.1-mini" } } },
                "list": [{ "id": "agent-main", "name": "agent-main", "model": "openai/gpt-4.1-mini" }]
            },
            "models": {
                "providers": {
                    "openai": {
                        "api": "openai",
                        "models": [{ "id": "gpt-4.1-mini", "name": "gpt-4.1-mini" }]
                    }
                }
            },
            "channels": {
                "slack": {
                    "enabled": true,
                    "accounts": {
                        "Slack-001": { "enabled": true }
                    }
                }
            },
            "bindings": [{
                "agentId": "agent-main",
                "match": { "channel": "slack", "accountId": "Slack-001" }
            }]
        });

        let merged = merge_openclaw_config(existing, generated);
        assert_eq!(merged.pointer("/custom/keep"), Some(&serde_json::json!(true)));
        assert!(merged
            .pointer("/agents/list")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|arr| arr.len() == 1
                && arr[0].get("id") == Some(&serde_json::json!("agent-main"))));
        assert!(merged.pointer("/models/providers/openai/extra").is_none());
        assert!(merged.pointer("/channels/slack/accounts/slack-001").is_none());
        assert!(merged
            .pointer("/channels/slack/accounts/Slack-001")
            .is_some());
        assert!(merged
            .pointer("/bindings")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|arr| arr.len() == 1
                && arr[0]
                    .pointer("/match/accountId")
                    == Some(&serde_json::json!("Slack-001"))));
    }

    #[test]
    fn backup_existing_file_creates_timestamped_copy() {
        let tmp_dir = std::env::temp_dir().join(gen_id("easy-openclaw-backup"));
        let _ = fs::create_dir_all(&tmp_dir);
        let path = tmp_dir.join("openclaw.json");
        fs::write(&path, "{\"a\":1}").expect("must write source");

        let backup = backup_existing_file(&path)
            .expect("backup must succeed")
            .expect("backup path exists");
        assert!(backup.exists());
        assert!(backup
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|name| name.contains(".backup-")));

        let _ = fs::remove_dir_all(tmp_dir);
    }

    #[test]
    fn normalize_openclaw_config_removes_null_provider_api_key() {
        let mut config = serde_json::json!({
            "models": {
                "providers": {
                    "lmstudio_model_1": {
                        "api": "openai",
                        "baseUrl": "http://localhost:1234/v1",
                        "apiKey": null,
                        "models": [{ "id": "qwen", "name": "qwen" }]
                    }
                }
            }
        });
        normalize_openclaw_config(&mut config);
        assert_eq!(
            config.pointer("/models/providers/lmstudio_model_1/apiKey"),
            None
        );
    }
}
