#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { fromEnv } from "./from-env.js";

const args = process.argv.slice(2);
const first = args[0];
const isUrl = typeof first === "string" && (first.startsWith("http://") || first.startsWith("https://"));
const command = isUrl ? "markdown" : first;
const target = isUrl ? first : args[1];

if (!command || command === "help" || command === "--help") {
  console.log(`browser-sdk <url> | <command>\n\nCommands:\n  <url>                   Return rendered Markdown (shorthand)\n  route <operation>       Show the configured provider runway\n  doctor                  Check configured providers without making a request\n  skill                   Print the agent-skill install command\n  content <url>           Return rendered HTML\n  markdown <url>          Return rendered Markdown\n  links <url>             Return discovered links\n  screenshot <url> <out>  Save a screenshot\n  pdf <url> <out>         Save a PDF\n\nProvider keys stay in environment variables. See /llms.txt for the machine-readable docs.`);
  process.exit(0);
}

if (command === "skill") {
  console.log("npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk");
  process.exit(0);
}

const client = fromEnv();

try {
  if (command === "route") {
    console.log(JSON.stringify(client.routePreview(target as Parameters<typeof client.routePreview>[0]), null, 2));
    process.exit(0);
  }
  if (command === "doctor") {
    console.log(JSON.stringify({
      providers: client.providers(),
      environment: {
        browserbase: Boolean(process.env.BROWSERBASE_API_KEY),
        cloudflare: Boolean((process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN) && (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID)),
        browserless: Boolean(process.env.BROWSERLESS_API_KEY ?? process.env.BROWSERLESS_TOKEN),
        steel: Boolean(process.env.STEEL_API_KEY),
        anchor: Boolean(process.env.ANCHOR_API_KEY),
        hyperbrowser: Boolean(process.env.HYPERBROWSER_API_KEY),
        browserUse: Boolean(process.env.BROWSER_USE_API_KEY),
        extendedProviders: process.env.BROWSER_SDK_EXTENDED_PROVIDERS === "true",
        local: true,
      },
      note: "No provider request made.",
    }, null, 2));
    process.exit(0);
  }
  if (!target && command !== "route") throw new Error(`${command} requires a URL.`);
  if (command === "content") console.log((await client.content(target!)).content);
  else if (command === "markdown") console.log((await client.markdown(target!)).markdown);
  else if (command === "links") console.log(JSON.stringify(await client.links(target!), null, 2));
  else if (command === "screenshot") {
    const out = args[2] ?? "screenshot.png";
    const result = await client.screenshot(target!, { fullPage: true });
    await writeFile(out, result.data);
    console.log(`Saved ${out} via ${result.provider}.`);
  } else if (command === "pdf") {
    const out = args[2] ?? "page.pdf";
    const result = await client.pdf(target!, { printBackground: true });
    await writeFile(out, result.data);
    console.log(`Saved ${out} via ${result.provider}.`);
  } else {
    throw new Error(`Unknown command ${command}. Run browser-sdk help.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
