# easy-openclaw

easy-openclaw is a Windows-first bootstrap app for OpenClaw. It helps you create an OpenClaw config, start the gateway, and connect an agent to Slack.

## Target Setup

- OS: Windows x64
- Distribution: `npm install -g easy-openclaw`
- Runtime: prebuilt `easy-openclaw.exe`
- Channel: Slack
- Model provider: LM Studio, Ollama, OpenAI-compatible, or OpenAI OAuth

Slack is optional for gateway startup. You can add a model and an agent first, then add Slack later when you are ready to receive messages from a workspace.

## Install

```powershell
npm install -g easy-openclaw
easy-openclaw
```

## Basic Flow

1. Open `easy-openclaw`.
2. Add a model in `Setup > Models`.
3. Add an agent in `Setup > Agents`.
4. Optionally add Slack in `Setup > Channels`.
5. Click `Apply Config`.
6. Open `Run` and click `Start`.

## Slack Setup

Create a Slack app and prepare these values:

- Slack Bot Token: `xoxb-...`
- Slack App Token: `xapp-...`
- Slack channel ID allowlist: for example `C0123456789`

In Slack app settings:

- Enable Socket Mode.
- Add bot scopes such as `app_mentions:read`, `channels:history`, `groups:history`, and `chat:write`.
- Enable Event Subscriptions and add bot events such as `app_mention`, `message.channels`, and `message.groups`.
- Install or reinstall the app to the workspace.
- Invite the bot to the target Slack channel.

Then add the Slack channel in easy-openclaw and assign it to an agent when needed.

## Useful Commands

```powershell
easy-openclaw --version
easy-openclaw --doctor
```

## Development

```powershell
npm run build
npm run build:native:win32-x64
npm pack
npm install -g .\easy-openclaw-0.0.1.tgz
```
