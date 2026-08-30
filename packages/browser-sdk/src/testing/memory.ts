import { BrowserSdkError, CapabilityError } from "../errors.js";
import { randomId } from "../utils.js";
import type {
  BrowserCapability,
  BrowserProvider,
  BrowserSessionInfo,
  BrowserSource,
  ContentResult,
  MarkdownResult,
  ProviderContext,
  SessionOptions,
} from "../types.js";

export type MemoryOperation = "createSession" | "getSession" | "listSessions" | "closeSession" | "content" | "markdown";

export interface MemoryProviderCall {
  operation: MemoryOperation;
  provider: string;
  source?: BrowserSource;
}

export interface MemoryProviderOptions {
  name?: string;
  capabilities?: readonly BrowserCapability[];
  content?: string | ((source: BrowserSource) => string);
  markdown?: string | ((source: BrowserSource) => string);
  failures?: Partial<Record<MemoryOperation, Error | (() => Error)>>;
  latencyMs?: number;
}

export interface MemoryProvider extends BrowserProvider {
  readonly calls: readonly MemoryProviderCall[];
  fail(operation: MemoryOperation, error: Error): void;
  reset(): void;
}

export function memoryProvider(options: MemoryProviderOptions = {}): MemoryProvider {
  const name = options.name ?? "memory";
  const calls: MemoryProviderCall[] = [];
  const failures = new Map<MemoryOperation, Error | (() => Error)>();
  const sessions = new Map<string, BrowserSessionInfo>();
  const configuredCapabilities = options.capabilities ?? ["session", "content", "markdown"];
  const before = async (operation: MemoryOperation, context: ProviderContext, source?: BrowserSource) => {
    calls.push({ operation, provider: name, ...(source === undefined ? {} : { source }) });
    if (context.signal?.aborted) throw new BrowserSdkError("ABORTED", "The memory operation was cancelled.", { provider: name });
    if (options.latencyMs) await new Promise<void>((resolve) => setTimeout(resolve, options.latencyMs));
    const failure = failures.get(operation) ?? options.failures?.[operation];
    if (failure) throw typeof failure === "function" ? failure() : failure;
  };
  const provider: MemoryProvider = {
    name,
    capabilities: configuredCapabilities,
    cost: 0,
    get calls() { return calls; },
    fail(operation, error) { failures.set(operation, error); },
    reset() { calls.splice(0); failures.clear(); sessions.clear(); },
    async createSession(options: SessionOptions, context: ProviderContext) {
      await before("createSession", context);
      const id = randomId("memory");
      const session: BrowserSessionInfo = { id, provider: name, status: "ready", ...(options.metadata ? { metadata: options.metadata } : {}) };
      sessions.set(id, session);
      return session;
    },
    async getSession(id: string, context: ProviderContext) {
      await before("getSession", context);
      const session = sessions.get(id);
      if (!session) throw new BrowserSdkError("SESSION_FAILED", `Memory session ${id} is not active.`, { provider: name });
      return session;
    },
    async listSessions(_options, context) {
      await before("listSessions", context);
      return [...sessions.values()];
    },
    async closeSession(id: string, context: ProviderContext) {
      await before("closeSession", context);
      sessions.delete(id);
    },
    async content(source: BrowserSource, _options, context): Promise<ContentResult> {
      await before("content", context, source);
      if (!configuredCapabilities.includes("content")) throw new CapabilityError("content", name);
      const content = typeof options.content === "function" ? options.content(source) : options.content ?? `<html><body><h1>${name}</h1></body></html>`;
      return { source, provider: name, latencyMs: options.latencyMs ?? 0, content, title: name };
    },
    async markdown(source: BrowserSource, _options, context): Promise<MarkdownResult> {
      await before("markdown", context, source);
      if (!configuredCapabilities.includes("markdown")) throw new CapabilityError("markdown", name);
      const markdown = typeof options.markdown === "function" ? options.markdown(source) : options.markdown ?? `# ${name}`;
      return { source, provider: name, latencyMs: options.latencyMs ?? 0, markdown, title: name };
    },
  };
  return provider;
}
