#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkgPath = path.join(rootDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log(pkg.version);
  process.exit(0);
}

if (args.includes("--doctor")) {
  const checks = [
    ["node", process.version],
    ["platform", `${process.platform}/${process.arch}`],
    ["OPENCLAW_GATEWAY_BIN", process.env.OPENCLAW_GATEWAY_BIN || "(unset)"],
    ["LMSTUDIO_BASE_URL", process.env.LMSTUDIO_BASE_URL || "(unset)"],
    ["SLACK_BOT_USER_OAUTH_TOKEN", process.env.SLACK_BOT_USER_OAUTH_TOKEN ? "(set)" : "(unset)"],
    ["SLACK_APP_LEVEL_TOKEN", process.env.SLACK_APP_LEVEL_TOKEN ? "(set)" : "(unset)"],
  ];
  for (const [k, v] of checks) {
    console.log(`${k}: ${v}`);
  }
  process.exit(0);
}

const nativeBinaryRelByPlatform = {
  "darwin-x64": "bin/native/darwin-x64/EasyClaw.app/Contents/MacOS/easyclaw",
  "darwin-arm64": "bin/native/darwin-arm64/easyclaw",
  "linux-x64": "bin/native/linux-x64/easyclaw",
  "win32-x64": "bin/native/win32-x64/easyclaw.exe",
};

const platformKey = `${process.platform}-${process.arch}`;
const relPath = nativeBinaryRelByPlatform[platformKey];

if (!relPath) {
  console.error(`Unsupported platform: ${platformKey}`);
  console.error("This package only contains prebuilt binaries for specific platforms.");
  process.exit(1);
}

const nativeBinary = path.join(rootDir, relPath);
if (!existsSync(nativeBinary)) {
  console.error(`Bundled binary was not found: ${nativeBinary}`);
  process.exit(1);
}

const child = spawn(nativeBinary, args, { cwd: rootDir, stdio: "inherit" });

child.on("exit", (code) => process.exit(code ?? 1));
