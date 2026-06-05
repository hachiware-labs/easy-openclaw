# easy-openclaw

easy-openclaw is a lightweight setup UI for OpenClaw. It turns the hard parts of first-time setup into one guided path: choose a Provider, optionally add a Channel, create an Agent, apply the OpenClaw config, start the Gateway, and reach the Dashboard.

It is designed for users who want to start using OpenClaw without first understanding every OpenClaw config file and routing detail.

## What It Helps With

- Register a model Provider such as LM Studio, Ollama, OpenAI-compatible, or OpenAI OAuth.
- Add a Slack Channel when you want OpenClaw to receive workspace messages.
- Create an Agent that connects a workspace, model, and optional channel.
- Generate OpenClaw-compatible config files without editing JSON by hand.
- Start and stop the OpenClaw Gateway from the app.
- Confirm Gateway health and open the Dashboard after startup.

Slack is not required for Gateway startup. You can first add only a Provider and Agent, confirm that the Gateway and Dashboard work, and add Slack later.

## Target Setup

- OS: Windows x64
- Distribution: `npm install -g easy-openclaw`
- Runtime: prebuilt `easy-openclaw.exe`
- Channel tutorial: Slack
- Model provider: LM Studio, Ollama, OpenAI-compatible, or OpenAI OAuth

## Install

```powershell
npm install -g easy-openclaw
easy-openclaw
```

Useful checks:

```powershell
easy-openclaw --version
easy-openclaw --doctor
```

## Setup Tutorial

This tutorial starts with a model and one agent, then adds Slack only if you want workspace chat integration.

### 1. Prepare a Model Provider

Use one of these:

- LM Studio: start the local server and note the base URL, usually `http://127.0.0.1:1234`.
- Ollama: start Ollama and use the base URL, usually `http://127.0.0.1:11434`.
- OpenAI-compatible: prepare the base URL, model name, and API key.
- OpenAI OAuth: use the OAuth flow from the model setup screen.

In easy-openclaw:

1. Open `Setup`.
2. Go to `Models`.
3. Click `Add Model`.
4. Select the provider from the dropdown.
5. Enter the base URL, model name, and authentication values required by that provider.
6. Save the model.

### 2. Create an Agent

An Agent is the OpenClaw runtime unit that uses a model in a workspace.

1. Go to `Setup > Agents`.
2. Click `Add Agent`.
3. Enter an agent name.
4. Select the model you added.
5. Set the workspace path.
6. Leave Channel empty if you only want to confirm Gateway and Dashboard startup.
7. Save the agent.

### 3. Add Slack Later, If Needed

Create a Slack app and prepare these values:

- Slack Bot Token: `xoxb-...`
- Slack App Token: `xapp-...`
- Slack channel ID allowlist: for example `C0123456789`

In Slack app settings:

1. Enable Socket Mode.
2. Add bot scopes such as `app_mentions:read`, `channels:history`, `groups:history`, and `chat:write`.
3. Enable Event Subscriptions.
4. Add bot events such as `app_mention`, `message.channels`, and `message.groups`.
5. Install or reinstall the app to the workspace.
6. Invite the bot to the target Slack channel.

Then in easy-openclaw:

1. Go to `Setup > Channels`.
2. Click `Add Channel`.
3. Select Slack.
4. Enter the Slack token values and channel allowlist.
5. Save the channel.
6. Edit the Agent and assign the Slack channel.

### 4. Apply the Config

1. Go to `Setup > Apply`.
2. Click `Apply Config`.
3. Confirm that the config files were generated.
4. Stay on the current screen or move to `Run`; the next action is `Start`.

easy-openclaw writes OpenClaw-compatible config from the setup parts. You do not need to manually edit `openclaw.json` for the normal first setup path.

### 5. Start the Gateway and Open the Dashboard

1. Open `Run`.
2. Click `Start`.
3. Wait until the Gateway reaches ready state.
4. easy-openclaw checks the startup log and opens the Dashboard URL in your browser.

If the browser does not come to the front, check the Run notice and Logs. The Dashboard URL is shown there.

### 6. Stop Cleanly

Use `Stop` in the Run screen when you finish. If you close easy-openclaw while the Gateway may still be running, the app asks whether to stop OpenClaw as well.

## Mental Model

- Provider: where the model is served from.
- Channel: where messages come from, such as Slack. This is optional for initial Gateway startup.
- Agent: the runnable OpenClaw unit that binds a workspace and model, and optionally a channel.
- Apply Config: writes the OpenClaw config from the setup parts.
- Gateway: the OpenClaw process that serves the runtime and Dashboard.
- Dashboard: the browser UI used to confirm OpenClaw is running.

## Development

```powershell
npm run build
npm run build:native:win32-x64
npm pack
npm install -g .\easy-openclaw-0.0.1.tgz
```
