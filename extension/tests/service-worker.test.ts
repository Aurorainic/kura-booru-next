import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeChrome, installChrome, dispatchMessage, loadScript, type ChromeStub } from "./_chrome-stub";

// Service worker has no exports — it registers a chrome.runtime.onMessage
// listener at load. We re-import it fresh after installing the chrome stub so
// that listener registers against our stub.

const SCRIPT = "../background/service-worker.js";

function jsonResponse(body: any, init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let chrome: ChromeStub;

beforeEach(async () => {
  vi.useFakeTimers();
  // Default: configured. Tests override storage / fetch as needed.
  chrome = makeChrome({
    storage: { serverUrl: "https://kura.example.com", apiKey: "kb_ext_abc", contentType: "auto" },
    fetch: async () => jsonResponse({ results: [{ task_id: "t-1", status: "queued", url: "https://www.pixiv.net/artworks/1" }] }),
  });
  installChrome(chrome);
  await loadScript(SCRIPT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as any).chrome;
  delete (globalThis as any).fetch;
});

describe("handleImport (IMPORT_URL)", () => {
  it("returns 未配置 when serverUrl/apiKey missing", async () => {
    chrome.storage.sync.set({ serverUrl: "", apiKey: "" });
    const res = await dispatchMessage(chrome, { type: "IMPORT_URL", url: "https://www.pixiv.net/artworks/1" });
    expect(res).toEqual({ success: false, error: "未配置" });
  });

  it("posts to /api/tasks/web-import with X-Api-Key and urls array, returns taskId on 200", async () => {
    const calls: any[] = [];
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com/", apiKey: "kb_ext_abc", contentType: "auto" },
      fetch: async (input: any, init: any) => {
        calls.push({ input, init });
        return jsonResponse({ results: [{ task_id: "t-42", status: "queued", url: "https://www.pixiv.net/artworks/99" }] });
      },
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "IMPORT_URL", url: "https://www.pixiv.net/artworks/99" });

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("https://kura.example.com/api/tasks/web-import");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["X-Api-Key"]).toBe("kb_ext_abc");
    // No force_rating when contentType is "auto"
    expect(JSON.parse(calls[0].init.body)).toEqual({ urls: ["https://www.pixiv.net/artworks/99"] });
    expect(res).toEqual({ success: true, taskId: "t-42" });
  });

  it("includes force_rating when contentType is set to a rating value", async () => {
    const calls: any[] = [];
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "kb_ext_abc", contentType: "questionable" },
      fetch: async (input: any, init: any) => {
        calls.push({ input, init });
        return jsonResponse({ results: [{ task_id: "t-99", status: "queued", url: "u" }] });
      },
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    await dispatchMessage(chrome, { type: "IMPORT_URL", url: "u" });
    expect(JSON.parse(calls[0].init.body)).toEqual({ urls: ["u"], force_rating: "questionable" });
  });

  it("returns API 密钥无效 on 401", async () => {
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "bad" },
      fetch: async () => new Response("{}", { status: 401 }),
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "IMPORT_URL", url: "u" });
    expect(res).toEqual({ success: false, error: "API 密钥无效" });
  });

  it("returns 请求过快 on 429", async () => {
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "k" },
      fetch: async () => new Response("{}", { status: 429 }),
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "IMPORT_URL", url: "u" });
    expect(res).toEqual({ success: false, error: "请求过快,请稍后再试" });
  });

  it("returns HTTP <status> on other non-ok", async () => {
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "k" },
      fetch: async () => new Response("{}", { status: 500 }),
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "IMPORT_URL", url: "u" });
    expect(res).toEqual({ success: false, error: "HTTP 500" });
  });

  it("returns 服务端拒绝 when server returns results[0].status === 'error'", async () => {
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "k" },
      fetch: async () => jsonResponse({ results: [{ status: "error", url: "u", error: "private/reserved host" }] }),
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "IMPORT_URL", url: "u" });
    expect(res).toEqual({ success: false, error: "private/reserved host" });
  });

  it("returns 网络错误 when fetch throws", async () => {
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "k" },
      fetch: async () => { throw new Error("offline"); },
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "IMPORT_URL", url: "u" });
    expect(res).toEqual({ success: false, error: "网络错误" });
  });

  it("trims trailing slashes from configured serverUrl", async () => {
    const calls: any[] = [];
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com///", apiKey: "k" },
      fetch: async (input: any) => { calls.push(input); return jsonResponse({ results: [{ task_id: "t", status: "queued", url: "u" }] }); },
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    await dispatchMessage(chrome, { type: "IMPORT_URL", url: "u" });
    expect(calls[0]).toBe("https://kura.example.com/api/tasks/web-import");
  });
});

describe("checkTaskStatus (CHECK_STATUS)", () => {
  it("returns error when not configured", async () => {
    chrome.storage.sync.set({ serverUrl: "", apiKey: "" });
    const res = await dispatchMessage(chrome, { type: "CHECK_STATUS", taskId: "t-1" });
    expect(res).toEqual({ status: "error" });
  });

  it("returns parsed JSON on 200", async () => {
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "k" },
      fetch: async (input: any, init: any) => {
        expect(input).toBe("https://kura.example.com/api/tasks/t-9");
        expect(init.headers["X-Api-Key"]).toBe("k");
        return jsonResponse({ status: "queued", position: 3 });
      },
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "CHECK_STATUS", taskId: "t-9" });
    expect(res).toEqual({ status: "queued", position: 3 });
  });

  it("returns error on non-ok status", async () => {
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "k" },
      fetch: async () => new Response("{}", { status: 404 }),
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "CHECK_STATUS", taskId: "missing" });
    expect(res).toEqual({ status: "error" });
  });

  it("returns error when fetch throws", async () => {
    chrome = makeChrome({
      storage: { serverUrl: "https://kura.example.com", apiKey: "k" },
      fetch: async () => { throw new Error("offline"); },
    });
    installChrome(chrome);
    await loadScript(SCRIPT);

    const res = await dispatchMessage(chrome, { type: "CHECK_STATUS", taskId: "t-1" });
    expect(res).toEqual({ status: "error" });
  });
});

describe("unknown message type", () => {
  it("does not keep the channel open (no return true)", async () => {
    const listener = chrome.runtime.onMessage._listeners[0];
    const result = listener({ type: "UNKNOWN" }, {}, () => {});
    expect(result).toBeUndefined();
  });
});
