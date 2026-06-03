#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(rootDir, "..");

function fail(message) {
  console.error(`[E2E][NG] ${message}`);
  process.exit(1);
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7) : line;
    const idx = normalized.indexOf("=");
    if (idx <= 0) continue;
    const key = normalized.slice(0, idx).trim();
    if (!key || process.env[key]) continue;
    let value = normalized.slice(idx + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function needVar(name) {
  if (!process.env[name]?.trim()) {
    fail(`missing env: ${name}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(bin, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function main() {
  loadDotEnv(path.join(projectRoot, ".env"));

  needVar("OPENCLAW_GATEWAY_BIN");
  needVar("LMSTUDIO_BASE_URL");
  needVar("SLACK_BOT_USER_OAUTH_TOKEN");
  needVar("SLACK_CHANNEL_ID");

  const openclawBin = process.env.OPENCLAW_GATEWAY_BIN;
  const nodeDir = path.dirname(openclawBin);
  process.env.PATH = `${nodeDir}${path.delimiter}${process.env.PATH ?? ""}`;

  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(projectRoot, ".openclaw-state");
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH?.trim() || path.join(stateDir, "openclaw.json");
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || "easyclaw-test-token";
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  fs.mkdirSync(stateDir, { recursive: true });

  console.log(`[E2E] node: ${process.version}`);

  const lmstudioBase = process.env.LMSTUDIO_BASE_URL.replace(/\/+$/, "");
  const lmstudioResponse = await fetch(`${lmstudioBase}/models`);
  if (lmstudioResponse.status !== 200) {
    fail(`LMStudio HTTP status ${lmstudioResponse.status}`);
  }
  console.log("[E2E] LMStudio: ok");

  const slackReadUrl = new URL("https://slack.com/api/conversations.history");
  slackReadUrl.searchParams.set("channel", process.env.SLACK_CHANNEL_ID);
  slackReadUrl.searchParams.set("limit", "1");
  const slackReadResponse = await fetch(slackReadUrl, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_USER_OAUTH_TOKEN}`,
    },
  });
  const slackRead = await slackReadResponse.json().catch(() => ({}));
  if (!slackRead?.ok) {
    fail("Slack read failed");
  }
  console.log("[E2E] Slack read: ok");

  const slackWriteResponse = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_USER_OAUTH_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: process.env.SLACK_CHANNEL_ID,
      text: "[EasyClaw] e2e smoke test",
    }),
  });
  const slackWrite = await slackWriteResponse.json().catch(() => ({}));
  if (!slackWrite?.ok) {
    fail("Slack write failed");
  }
  console.log("[E2E] Slack write: ok");

  const logPath = path.join(os.tmpdir(), "easyclaw-e2e-gateway.log");
  const outFd = fs.openSync(logPath, "a");
  const gateway = spawn(openclawBin, ["gateway", "--allow-unconfigured"], {
    env: process.env,
    stdio: ["ignore", outFd, outFd],
  });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (!gateway.killed) {
      gateway.kill();
    }
    fs.closeSync(outFd);
  };
  process.on("exit", cleanup);

  await sleep(8000);

  const health = await runCommand(openclawBin, ["health", "--json"]);
  const healthText = `${health.stdout}\n${health.stderr}`;
  if (!/"ok"\s*:\s*true/.test(healthText)) {
    fail("gateway health failed");
  }
  console.log("[E2E] gateway health: ok");

  cleanup();
  console.log("[E2E] smoke test: ok");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
}
