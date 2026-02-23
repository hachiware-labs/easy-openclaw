#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [, , targetKey, sourcePath] = process.argv;
if (!targetKey || !sourcePath) {
  console.error("Usage: node ./scripts/package_native.mjs <target-key> <source-path>");
  process.exit(1);
}

const rootDir = process.cwd();
const absoluteSource = path.resolve(rootDir, sourcePath);
if (!fs.existsSync(absoluteSource)) {
  console.error(`Source not found: ${absoluteSource}`);
  process.exit(1);
}

const destinationRoot = path.join(rootDir, "bin", "native", targetKey);
fs.mkdirSync(destinationRoot, { recursive: true });

const sourceStat = fs.statSync(absoluteSource);
if (sourceStat.isDirectory()) {
  const destinationPath = path.join(destinationRoot, path.basename(absoluteSource));
  fs.rmSync(destinationPath, { recursive: true, force: true });
  fs.cpSync(absoluteSource, destinationPath, { recursive: true });
  console.log(`Copied directory: ${absoluteSource} -> ${destinationPath}`);
} else {
  const destinationPath = path.join(destinationRoot, path.basename(absoluteSource));
  fs.copyFileSync(absoluteSource, destinationPath);
  console.log(`Copied file: ${absoluteSource} -> ${destinationPath}`);
}
