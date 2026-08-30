"use client";

import { Fragment, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BracketsCurly,
  Check,
  ClipboardText,
  Code,
  GithubLogo,
  GlobeHemisphereWest,
  Lightning,
  Moon,
  Play,
  ShieldCheck,
  Sun,
  TerminalWindow,
  XLogo,
} from "@phosphor-icons/react";
import { BrowserLogo } from "./components/BrowserLogo";

type Theme = "dark" | "light";
type DocId = "overview" | "installation" | "quickstart" | "providers" | "routing" | "sessions" | "agents" | "mcp" | "reference" | "machine" | "security";
type Operation = "markdown" | "session" | "screenshot" | "extract";
type Snippet = "session" | "render" | "agent";

const providers = [
  { id: "browserbase", name: "Browserbase", note: "sessions + identity", marker: "01", phase: "default" },
  { id: "cloudflare", name: "Cloudflare Run", note: "edge actions + CDP", marker: "02", phase: "default" },
  { id: "browserless", name: "Browserless", note: "rendering APIs", marker: "03", phase: "default" },
  { id: "steel", name: "Steel", note: "agent browsers", marker: "04", phase: "default" },
  { id: "local", name: "Local", note: "last line of defense", marker: "05", phase: "default" },
  { id: "anchor", name: "Anchor Browser", note: "auth + proxy sessions", marker: "06", phase: "extended" },
  { id: "hyperbrowser", name: "Hyperbrowser", note: "stealth + profiles", marker: "07", phase: "extended" },
  { id: "browser-use", name: "Browser Use Cloud", note: "country proxy + recording", marker: "08", phase: "extended" },
] as const;

const routeData: Record<Operation, string[]> = {
  markdown: ["browserbase", "cloudflare-browser-run", "browserless", "steel", "local"],
  session: ["browserbase", "cloudflare-browser-run", "browserless", "steel", "local"],
  screenshot: ["cloudflare-browser-run", "browserless", "steel", "local"],
  extract: ["cloudflare-browser-run"],
};

const operationLabels: Record<Operation, string> = {
  markdown: "Read a page",
  session: "Start a session",
  screenshot: "Capture a screenshot",
  extract: "Extract JSON",
};

const codeSnippets: Record<Snippet, string> = {
  session: `import { fromEnv } from "browser-sdk";
import { chromium } from "playwright-core";

const browser = fromEnv();

await browser.withSession({}, async (session) => {
  const remote = await chromium.connectOverCDP(session.connectUrl!);
  const page = remote.contexts()[0].pages()[0];
  await page.goto("https://app.example.com");
  await remote.close();
});`,
  render: `const page = await browser.markdown(
  "https://docs.example.com",
  { waitForSelector: "main", maxChars: 20_000 },
);

console.log(page.markdown);
console.log(page.provider);
console.log(page.failedOverFrom);`,
  agent: `import { createBrowserTools } from "browser-sdk/agent-tools";

const tools = createBrowserTools(browser);

// Give your model a small, typed surface:
// markdown, extract, links, and route preview.
// Provider credentials stay outside the tool output.`,
};

function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("browser-sdk-theme");
    if (saved === "light") setTheme("light");
    setHydrated(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (hydrated) window.localStorage.setItem("browser-sdk-theme", theme);
  }, [hydrated, theme]);

  useEffect(() => {
    const elements = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  function openHome(anchor = "top") {
    window.history.replaceState({}, "", anchor === "top" ? "/" : `/#${anchor}`);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(anchor);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function openDocs(nextDoc: DocId = "overview") {
    window.location.assign(nextDoc === "overview" ? "/docs" : `/docs/${nextDoc}`);
  }

  return (
    <div className="app-shell">
      <Header theme={theme} setTheme={setTheme} openHome={openHome} openDocs={openDocs} />
      <Landing openHome={openHome} openDocs={openDocs} />
      <Footer openHome={openHome} openDocs={openDocs} />
    </div>
  );
}

function Header({
  theme,
  setTheme,
  openHome,
  openDocs,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  openHome: (anchor?: string) => void;
  openDocs: (doc?: DocId) => void;
}) {
  return (
    <header className="site-header">
      <button className="wordmark" onClick={() => openHome()} type="button" aria-label="Browser SDK home">
        <BrowserLogo className="logo-mark-svg" size={24} />
        <span>browser-sdk</span>
      </button>
      <nav className="header-links" aria-label="Primary navigation">
        <a href="/docs">Docs <ArrowUpRight size={13} weight="bold" /></a>
        <button onClick={() => openHome("providers")} type="button">Providers</button>
        <button onClick={() => openHome("agents")} type="button">Agents</button>
        <a href="https://github.com/SoulSniper-V2/browser-sdk" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} weight="bold" /></a>
      </nav>
      <div className="header-actions">
        <a className="header-skill-link" href="#agents">npx skills add</a>
        <button className="theme-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? <Sun size={16} weight="bold" /> : <Moon size={16} weight="bold" />}
        </button>
        <button className="header-cta" onClick={() => openDocs("quickstart")} type="button">Get started <ArrowUpRight size={14} weight="bold" /></button>
      </div>
    </header>
  );
}

function Landing({ openHome, openDocs }: { openHome: (anchor?: string) => void; openDocs: (doc?: DocId) => void }) {
  return (
    <main>
      <Hero openDocs={openDocs} />
      <ProviderStrip />
      <Manifesto />
      <RouteSection />
      <SurfaceSection openDocs={openDocs} />
      <AgentSection openDocs={openDocs} />
      <ProofSection openHome={openHome} openDocs={openDocs} />
    </main>
  );
}

function Hero({ openDocs }: { openDocs: (doc?: DocId) => void }) {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-art" aria-hidden="true"><img src="/browser-sdk-ribbon.png" alt="" /></div>
      <div className="hero-grid section-frame">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="status-dot" /> browser infrastructure for agents</div>
          <h1 id="hero-title">Keep browser work <em>moving.</em></h1>
          <p className="hero-lede">One typed API for sessions, rendering, and agent context. Start with Browserbase. Keep going when the provider doesn’t.</p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => openDocs("quickstart")} type="button">Read the quickstart <ArrowUpRight size={15} weight="bold" /></button>
            <a className="button button-quiet" href="https://github.com/SoulSniper-V2/browser-sdk" target="_blank" rel="noreferrer">View source <ArrowRight size={15} weight="bold" /></a>
          </div>
          <div className="hero-install-stack">
            <InstallLine label="package" value="npm install browser-sdk" />
            <InstallLine label="agent skill" value="npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk" />
          </div>
        </div>
        <RouteHero />
      </div>
      <div className="hero-rule section-frame"><span>one contract</span><span>capability-aware</span><span>bounded retries</span><span>observable hops</span></div>
    </section>
  );
}

function InstallLine({ label, value }: { label: string; value: string }) {
  return <div className="install-line"><span className="install-label">{label}</span><code><span>$</span>{value}</code><CopyButton value={value} label="Copy" compact /></div>;
}

function RouteHero() {
  return (
    <div className="hero-route-wrap">
      <div className="hero-route-heading"><span><span className="status-dot" /> live route</span><code>priority</code></div>
      <div className="hero-route-request"><GlobeHemisphereWest size={16} weight="duotone" /><span>https://app.example.com/checkout</span><strong>SESSION</strong></div>
      <div className="hero-route-list">
        <RouteStep number="01" name="Browserbase" detail="preferred · session + identity" state="active" />
        <div className="route-line"><i /></div>
        <RouteStep number="02" name="Cloudflare Run" detail="next · edge CDP" state="next" />
        <div className="route-line muted"><i /></div>
        <RouteStep number="05" name="Local Playwright" detail="last resort · no key" state="last" />
      </div>
      <div className="hero-route-footer"><Check size={15} weight="bold" /><span>same callback, different browser</span><code>deadline: 30s</code></div>
    </div>
  );
}

function RouteStep({ number, name, detail, state }: { number: string; name: string; detail: string; state: "active" | "next" | "last" }) {
  return <div className={`route-step route-step-${state}`}><span className="route-step-number">{number}</span><span className="route-step-marker" /><span className="route-step-copy"><strong>{name}</strong><small>{detail}</small></span><span className="route-step-state">{state === "active" ? "selected" : state === "next" ? "fallback" : "standby"}</span></div>;
}

function ProviderStrip() {
  return (
    <section className="provider-strip" id="providers" aria-labelledby="providers-title" data-reveal>
      <div className="section-frame provider-strip-inner">
        <div className="provider-strip-label"><span className="eyebrow">The runway</span><h2 id="providers-title">Use the browser accounts you already have.</h2><p className="provider-strip-copy">A conservative default path, with a longer tail when your stack needs it.</p></div>
        <div className="provider-strip-list">
          {providers.map((provider, index) => <Fragment key={provider.id}>{index === 5 ? <div className="provider-divider"><span>optional extension runway</span><code>BROWSER_SDK_EXTENDED_PROVIDERS=true</code></div> : null}<div className={`provider-line ${index === 0 ? "is-primary" : ""} ${provider.phase === "extended" ? "is-extended" : ""}`}><span>{provider.marker}</span><strong>{provider.name}</strong><small>{provider.note}</small></div></Fragment>)}
        </div>
      </div>
    </section>
  );
}

function Manifesto() {
  return (
    <section className="manifesto section-frame" aria-label="Product point of view" data-reveal>
      <span className="manifesto-index">/ 01</span>
      <p>Your browser provider should be a detail.<br /><em>The route is the product.</em></p>
      <span className="manifesto-note">A provider can be fast, expensive, limited, or down. Your application still gets one typed call and an honest result.</span>
    </section>
  );
}

function RouteSection() {
  return (
    <section className="section-block route-section" id="route" aria-labelledby="route-title" data-reveal>
      <div className="section-frame">
        <div className="section-heading section-heading-split"><div><span className="eyebrow">/ 02 · routing</span><h2 id="route-title">Failover with a reason attached.</h2></div><p>Capabilities decide who can try. Retryable errors decide when. Every successful result tells you what happened before it arrived.</p></div>
        <div className="route-story">
          <div className="route-story-copy"><span className="story-number">01</span><h3>Retry the request.</h3><p>Rate limits, timeouts, network failures, and 5xx responses get another chance on the same provider.</p><code>retry: 1 · deadline: cumulative</code></div>
          <div className="story-arrow"><ArrowRight size={22} weight="bold" /></div>
          <div className="route-story-copy route-story-highlight"><span className="story-number">02</span><h3>Move down the runway.</h3><p>If the provider still cannot serve the operation, the next capable adapter takes over. The hop is visible.</p><code>failedOverFrom: [{`{ provider, reason }`}]</code></div>
          <div className="story-arrow"><ArrowRight size={22} weight="bold" /></div>
          <div className="route-story-copy"><span className="story-number">03</span><h3>Never replay side effects.</h3><p>Session callbacks are not duplicated automatically after clicks, form submits, or other irreversible work.</p><code>you own the resume policy</code></div>
        </div>
      </div>
    </section>
  );
}

function SurfaceSection({ openDocs }: { openDocs: (doc?: DocId) => void }) {
  const [tab, setTab] = useState<Snippet>("session");
  const tabs: { id: Snippet; label: string }[] = [
    { id: "session", label: "Sessions" },
    { id: "render", label: "Rendering" },
    { id: "agent", label: "Agent tools" },
  ];
  return (
    <section className="section-block surface-section" id="surface" aria-labelledby="surface-title" data-reveal>
      <div className="section-frame surface-grid">
        <div className="surface-copy"><span className="eyebrow">/ 03 · one surface</span><h2 id="surface-title">A small API for a large browser problem.</h2><p>Call the thing you need. The adapter, transport, retry policy, and provider trail stay behind the contract.</p><div className="surface-points"><span><Check size={15} weight="bold" /> Standard CDP when you need a live browser</span><span><Check size={15} weight="bold" /> HTML, Markdown, screenshots, and PDFs</span><span><Check size={15} weight="bold" /> Credentials stay server-side</span></div><button className="text-link" onClick={() => openDocs("reference")} type="button">Read the API reference <ArrowUpRight size={14} weight="bold" /></button></div>
        <div className="code-window"><div className="code-window-top"><span className="window-dots"><i /><i /><i /></span><span>browser.ts</span><span className="code-kind">TypeScript</span></div><div className="code-tabs" role="tablist" aria-label="Code examples">{tabs.map((item) => <button className={tab === item.id ? "is-active" : ""} key={item.id} onClick={() => setTab(item.id)} role="tab" aria-selected={tab === item.id} type="button">{item.label}</button>)}</div><div className="code-body"><pre><code>{codeSnippets[tab]}</code></pre><CopyButton value={codeSnippets[tab]} label="Copy example" compact /></div></div>
      </div>
    </section>
  );
}

function AgentSection({ openDocs }: { openDocs: (doc?: DocId) => void }) {
  return (
    <section className="agent-section" id="agents" aria-labelledby="agent-title" data-reveal>
      <div className="section-frame agent-grid">
        <div className="agent-copy"><span className="eyebrow">/ 04 · for agents</span><h2 id="agent-title">Install the context before you ask for the code.</h2><p>The skill tells coding agents when to use Browser SDK, how the route behaves, what not to replay, and where the machine-readable docs live.</p><button className="text-link" onClick={() => openDocs("agents")} type="button">Read the agent guide <ArrowUpRight size={14} weight="bold" /></button></div>
        <div className="agent-install-panel"><div className="agent-install-top"><span className="agent-install-icon"><TerminalWindow size={17} weight="bold" /></span><div><span>Agent skill</span><strong>browser-sdk</strong></div><span className="agent-install-status"><span className="status-dot" /> ready to install</span></div><div className="agent-command"><span>$</span><code>npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk</code><CopyButton value="npx skills add SoulSniper-V2/browser-sdk --skill browser-sdk" label="Copy" compact /></div><div className="agent-command agent-command-secondary"><span>$</span><code>npx -y browser-sdk-mcp</code><CopyButton value="npx -y browser-sdk-mcp" label="Copy" compact /></div><div className="agent-install-foot"><span><Check size={14} weight="bold" /> SKILL.md</span><span><Check size={14} weight="bold" /> MCP session tools</span><span><Check size={14} weight="bold" /> provider rules</span><a href="/skills/browser-sdk/SKILL.md" target="_blank" rel="noreferrer">View raw skill <ArrowUpRight size={12} /></a></div></div>
      </div>
    </section>
  );
}

function ProofSection({ openHome, openDocs }: { openHome: (anchor?: string) => void; openDocs: (doc?: DocId) => void }) {
  const [operation, setOperation] = useState<Operation>("markdown");
  const [complete, setComplete] = useState(false);
  const activeRoute = routeData[operation];
  function runDryRoute() {
    setComplete(false);
    window.setTimeout(() => setComplete(true), 500);
  }
  return (
    <section className="proof-section" id="proof" aria-labelledby="proof-title" data-reveal>
      <div className="section-frame proof-frame">
        <div className="proof-heading"><span className="eyebrow">/ 05 · see it work</span><h2 id="proof-title">The decision is inspectable before it is live.</h2><p>Switch the operation. See the capable route. This preview is local and never calls a provider.</p></div>
        <div className="proof-console"><div className="proof-console-top"><span><span className="status-dot" /> route preview</span><code>browser-sdk / dry-run</code></div><div className="proof-console-body"><div className="operation-rail"><span className="control-label">Operation</span>{(Object.keys(operationLabels) as Operation[]).map((item) => <button className={operation === item ? "is-active" : ""} key={item} onClick={() => { setOperation(item); setComplete(false); }} type="button"><span>{operationLabels[item]}</span><ArrowRight size={14} /></button>)}</div><div className="proof-route"><div className="proof-route-head"><span>{operationLabels[operation]}</span><code>{activeRoute.length} capable providers</code></div>{activeRoute.map((provider, index) => <div className={`proof-route-row ${index === 0 ? "is-first" : ""} ${complete && index === 0 ? "is-complete" : ""}`} key={provider}><span className="proof-order">{String(index + 1).padStart(2, "0")}</span><strong>{provider}</strong><span className="proof-status">{complete && index === 0 ? "selected" : index === 0 ? "preferred" : "fallback"}</span><span className="proof-state"><i />{complete && index === 0 ? "ready" : index === 0 ? "waiting" : "standby"}</span></div>)}<div className="proof-route-bottom"><span><Lightning size={14} weight="fill" /> priority</span><button className="button button-primary" onClick={runDryRoute} type="button">{complete ? "Routed" : "Run the route"} {complete ? <Check size={14} weight="bold" /> : <Play size={13} weight="fill" />}</button></div></div></div></div>
        <div className="proof-links"><button onClick={() => openHome("providers")} type="button">Compare the runway <ArrowRight size={14} /></button><button onClick={() => openDocs("machine")} type="button">Read machine docs <ArrowRight size={14} /></button></div>
      </div>
    </section>
  );
}

function CopyButton({ value, label, compact = false }: { value: string; label: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_300);
    } catch {
      setCopied(false);
    }
  }
  return <button className={`copy-button ${compact ? "copy-button-compact" : ""}`} onClick={() => void copy()} type="button">{copied ? <Check size={14} weight="bold" /> : <ClipboardText size={14} />}{copied ? "Copied" : label}</button>;
}

function Footer({ openHome, openDocs }: { openHome: (anchor?: string) => void; openDocs: (doc?: DocId) => void }) {
  return <footer className="site-footer"><div className="section-frame footer-top"><div className="footer-brand"><button className="wordmark" onClick={() => openHome()} type="button"><BrowserLogo className="logo-mark-svg" size={24} /><span>browser-sdk</span></button><p>One typed route for browsers that do more than render.</p></div><div className="footer-actions"><button onClick={() => openDocs("quickstart")} type="button">Quickstart <ArrowUpRight size={12} /></button><button onClick={() => openDocs("agents")} type="button">Agent skill <ArrowUpRight size={12} /></button><a href="/llms.txt">llms.txt <ArrowUpRight size={12} /></a><a href="https://github.com/SoulSniper-V2/browser-sdk" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={12} /></a></div></div><div className="section-frame footer-bottom"><span>MIT licensed · server-side by default</span><span className="footer-social"><a href="https://github.com/SoulSniper-V2/browser-sdk" target="_blank" rel="noreferrer" aria-label="GitHub"><GithubLogo size={17} /></a><a href="https://x.com/SoulSniperV2" target="_blank" rel="noreferrer" aria-label="X"><XLogo size={16} /></a></span></div></footer>;
}

export default App;
