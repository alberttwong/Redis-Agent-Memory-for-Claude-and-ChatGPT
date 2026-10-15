import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function memoryConfigPath(): string {
  return process.env.AGENT_MEMORY_CONFIG_FILE
    ?? join(process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), ".config", "redis-agent-memory"), "connection.json");
}

export async function readMemorySettings(path: string): Promise<NodeJS.ProcessEnv> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Could not read Redis settings. Run memory_setup to configure the connection again.");
  }
}

const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Set up Redis Memory</title>
<style>body{font:16px system-ui;background:#f6f5f1;color:#202722;margin:0}main{max-width:520px;margin:7vh auto;padding:32px;background:white;border-radius:16px}h1{font-size:28px}label{display:block;margin:20px 0 6px}input{box-sizing:border-box;width:100%;font:inherit;padding:12px;border:1px solid #929b96;border-radius:6px}button{margin-top:24px;padding:13px 22px;background:#23573e;color:white;border:0;border-radius:7px;font:inherit;cursor:pointer}small{color:#536158}#status{line-height:1.6}</style>
<main><h1>Set up Redis Memory</h1><p>Connect your assistant to your Redis Agent Memory store.</p><p><small>This form runs on your computer. Settings are saved in a private local file. Your API key is never sent to the chat.</small></p>
<form id="setup"><label for="url">Redis Agent Memory URL</label><input id="url" name="baseUrl" type="url" placeholder="https://your-agent-memory-endpoint" required>
<label for="store">Store ID</label><input id="store" name="storeId" autocomplete="off" required>
<label for="key">API key</label><input id="key" name="apiKey" type="password" autocomplete="off" required>
<details><summary style="margin-top:20px">Project identity (optional)</summary><label for="owner">Owner ID</label><input id="owner" name="ownerId" autocomplete="off"><label for="namespace">Namespace resource ID</label><input id="namespace" name="namespaceId" autocomplete="off"><label for="legacy">Legacy namespace</label><input id="legacy" name="namespace" value="claude-desktop" autocomplete="off"></details>
<button type="submit">Save connection</button></form><p id="status" role="status"></p></main>
<script nonce="NONCE">const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const form=document.querySelector('form'),status=document.querySelector('#status');form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;status.textContent='Saving…';try{const response=await fetch('/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':token},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const result=await response.json();if(!response.ok)throw new Error(result.error);form.reset();form.hidden=true;status.textContent='Connection saved. Return to Claude and ask it to call memory_health to verify your connection.';}catch(error){status.textContent=error.message;button.disabled=false;}});</script></html>`;

export class MemorySetup {
  private server?: Server;
  private url?: string;
  private timer?: NodeJS.Timeout;
  private opening?: Promise<{ url: string; message: string }>;

  constructor(private readonly configPath: string, private readonly lifetimeMs = 10 * 60_000) {}

  async open() {
    // Concurrent calls share a single form and one expiry timer.
    if (this.opening) return this.opening;
    this.opening = this.start().finally(() => { this.opening = undefined; });
    return this.opening;
  }

  private async start() {
    if (this.url) return this.link();
    const token = randomBytes(32).toString("hex");
    const nonce = randomBytes(16).toString("hex");
    const server = createServer(async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'`);
      const origin = this.url && new URL(this.url).origin;
      const reply = (code: number, body: object) => {
        response.writeHead(code, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      // Bind to loopback and reject rebinding, cross-origin writes, and missing tokens.
      if (!origin || request.headers.host !== new URL(origin).host) return reply(403, { error: "Invalid setup host." });
      if (request.method === "GET" && request.url === "/setup") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(page.replace("NONCE", nonce));
        return;
      }
      if (request.method !== "POST" || request.url !== "/settings") return reply(404, { error: "Not found." });
      const supplied = request.headers["x-setup-token"];
      if (request.headers.origin !== origin || request.headers["content-type"] !== "application/json"
        || typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied)
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
        return reply(403, { error: "Open a new setup link from Claude and try again." });
      }
      try {
        let body = "";
        for await (const part of request) {
          body += part.toString();
          if (Buffer.byteLength(body) > 16_384) return reply(413, { error: "Settings are too large." });
        }
        const input = JSON.parse(body);
        const value = (key: string) => typeof input?.[key] === "string" ? input[key].trim() : "";
        let baseUrl: URL;
        try { baseUrl = new URL(value("baseUrl")); } catch { return reply(400, { error: "Enter a valid HTTPS Redis URL." }); }
        if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
          return reply(400, { error: "Use an HTTPS Redis URL without credentials, query parameters, or fragments." });
        }
        if (!value("storeId") || !value("apiKey")) return reply(400, { error: "Store ID and API key are required." });
        const settings = {
          AGENT_MEMORY_BASE_URL: baseUrl.href.replace(/\/+$/, ""),
          AGENT_MEMORY_STORE_ID: value("storeId"),
          AGENT_MEMORY_API_KEY: value("apiKey"),
          AGENT_MEMORY_OWNER_ID: value("ownerId"),
          AGENT_MEMORY_NAMESPACE_ID: value("namespaceId"),
          AGENT_MEMORY_NAMESPACE: value("namespace"),
        };
        await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
        const temporary = `${this.configPath}.${randomBytes(8).toString("hex")}.tmp`;
        try {
          await writeFile(temporary, `${JSON.stringify(settings)}\n`, { mode: 0o600, flag: "wx" });
          await rename(temporary, this.configPath);
        } finally { await rm(temporary, { force: true }); }
        reply(200, { saved: true });
        this.close();
      } catch {
        reply(400, { error: "Could not save settings. Check the form and try again." });
      }
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not start the local setup form.");
    this.url = `http://127.0.0.1:${address.port}/setup#${token}`;
    this.timer = setTimeout(() => this.close(), this.lifetimeMs);
    this.timer.unref();
    server.unref();
    return this.link();
  }

  private link() {
    return { url: this.url!, message: "Open this local setup link in your browser and enter your Redis URL, store ID, and API key. Do not enter credentials in chat. The link expires in 10 minutes." };
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.server?.close();
    this.server = undefined;
    this.url = undefined;
  }
}
