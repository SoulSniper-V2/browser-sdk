---
title: Installation
description: Install the package, the optional local browser runtime, and the coding-agent skill.
---

## Install the SDK

```bash
npm install browser-sdk
```

Browser SDK is server-side TypeScript. It expects Node.js 20 or newer. Provider keys are read from environment variables and should not be shipped to a browser bundle.

## Add local browser support

The local adapter can fetch static HTML without another dependency. For local sessions, screenshots, PDFs, and accessibility snapshots, install Playwright and provide a Chromium executable when your environment does not discover one automatically:

```bash
npm install playwright-core
```

## Install the coding-agent skill

```bash
npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk
```

The skill teaches coding agents when to use Browser SDK, how the provider route behaves, how to avoid replaying side effects, and how to verify adapter changes. The hosted raw copy is `/skills/browser-sdk/SKILL.md`.

## Add the MCP server

```bash
npm install browser-sdk-mcp
npx -y browser-sdk-mcp
```

The server uses the same environment variables and default provider order as `fromEnv()`. Set `BROWSER_SDK_EXTENDED_PROVIDERS=true` in the MCP environment to add Anchor Browser, Hyperbrowser, and Browser Use Cloud before local.
