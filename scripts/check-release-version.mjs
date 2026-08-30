import { readFile } from "node:fs/promises";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

if (!tag) {
  throw new Error("Pass the release tag, for example v0.1.0.");
}

const sdk = JSON.parse(await readFile(new URL("../packages/browser-sdk/package.json", import.meta.url), "utf8"));
const mcp = JSON.parse(await readFile(new URL("../packages/browser-sdk-mcp/package.json", import.meta.url), "utf8"));
const expectedTag = `v${sdk.version}`;

if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match SDK version ${sdk.version}; expected ${expectedTag}.`);
}

if (mcp.version !== sdk.version) {
  throw new Error(`Package versions must match: SDK is ${sdk.version}, MCP is ${mcp.version}.`);
}

if (mcp.dependencies?.[sdk.name] !== sdk.version) {
  throw new Error(`MCP must depend on ${sdk.name}@${sdk.version} exactly.`);
}

console.log(`Release manifests are aligned at ${sdk.version}.`);
