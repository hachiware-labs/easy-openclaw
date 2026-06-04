#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

npm run -s tauri -- build --target x86_64-apple-darwin --bundles app
node ./scripts/package_native.mjs darwin-x64 src-tauri/target/x86_64-apple-darwin/release/bundle/macos/easy-openclaw.app
