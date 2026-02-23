#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

npm run -s tauri -- build --target aarch64-apple-darwin --bundles app
node ./scripts/package_native.mjs darwin-arm64 src-tauri/target/aarch64-apple-darwin/release/easyclaw
