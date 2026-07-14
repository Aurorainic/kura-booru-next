import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POPUP_HTML = readFileSync(resolve(__dirname, "../popup/popup.html"), "utf8");
const POPUP_JS = readFileSync(resolve(__dirname, "../popup/popup.js"), "utf8");

// popup.js reads popup.html's structure at load. We load the real HTML so the
// element IDs (#server-url, #api-key, #save-btn, #status) match production,
// then run popup.js inside the jsdom window.
function setupPopup(storage: Record<string, any> = {}) {
  const dom = new JSDOM(POPUP_HTML, {
    url: "https://example.com/",
    runScripts: "outside-only",
  });
  const { window } = dom;

  const storageData = { ...storage };
  (window as any).chrome = {
    storage: {
      sync: {
        get: (keys: string[], cb: (data: Record<string, any>) => void) => {
          const data = keys.reduce((acc, k) => ({ ...acc, [k]: storageData[k] }), {});
          if (cb) cb(data);
          return Promise.resolve(data);
        },
        set: (data: Record<string, any>, cb?: () => void) => {
          Object.assign(storageData, data);
          if (cb) cb();
          return Promise.resolve();
        },
      },
    },
  };

  // popup.js wraps its logic in DOMContentLoaded. jsdom may have already fired
  // it during parse, so call the script via Function and manually dispatch.
  const fn = new window.Function(POPUP_JS);
  fn.call(window);
  // If listener already attached but DOMContentLoaded passed, dispatch now.
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

  return { dom, storageData };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("popup settings load", () => {
  it("populates inputs from chrome.storage.sync on load", () => {
    const { dom } = setupPopup({ serverUrl: "https://kura.example.com", apiKey: "key-abc" });
    vi.runAllTicks();
    expect((dom.window.document.getElementById("server-url") as HTMLInputElement).value).toBe("https://kura.example.com");
    expect((dom.window.document.getElementById("api-key") as HTMLInputElement).value).toBe("key-abc");
    expect((dom.window.document.getElementById("content-type") as HTMLSelectElement).value).toBe("auto");
  });

  it("loads saved contentType selection when present", () => {
    const { dom } = setupPopup({ serverUrl: "https://kura.example.com", apiKey: "k", contentType: "explicit" });
    vi.runAllTicks();
    expect((dom.window.document.getElementById("content-type") as HTMLSelectElement).value).toBe("explicit");
  });

  it("leaves inputs empty when nothing stored", () => {
    const { dom } = setupPopup({});
    vi.runAllTicks();
    expect((dom.window.document.getElementById("server-url") as HTMLInputElement).value).toBe("");
    expect((dom.window.document.getElementById("api-key") as HTMLInputElement).value).toBe("");
    expect((dom.window.document.getElementById("content-type") as HTMLSelectElement).value).toBe("auto");
  });
});

describe("popup save", () => {
  it("trims trailing slashes from serverUrl and persists all three fields", () => {
    const { dom, storageData } = setupPopup();
    vi.runAllTicks();

    const urlInput = dom.window.document.getElementById("server-url") as HTMLInputElement;
    const keyInput = dom.window.document.getElementById("api-key") as HTMLInputElement;
    const typeInput = dom.window.document.getElementById("content-type") as HTMLSelectElement;
    urlInput.value = "https://kura.example.com////";
    keyInput.value = "  kb_ext_xyz  ";
    typeInput.value = "questionable";

    dom.window.document.getElementById("save-btn")!.click();
    vi.runAllTicks();

    expect(storageData.serverUrl).toBe("https://kura.example.com");
    expect(storageData.apiKey).toBe("kb_ext_xyz");
    expect(storageData.contentType).toBe("questionable");
  });

  it("shows 已保存！ status and clears it after 2000ms", () => {
    const { dom } = setupPopup();
    vi.runAllTicks();

    dom.window.document.getElementById("save-btn")!.click();
    vi.runAllTicks();

    const status = dom.window.document.getElementById("status")!;
    expect(status.textContent).toBe("已保存！");
    expect(status.className).toBe("success");

    vi.advanceTimersByTime(2000);
    expect(status.textContent).toBe("");
    expect(status.className).toBe("");
  });
});
