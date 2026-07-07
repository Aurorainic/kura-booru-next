import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_JS = readFileSync(resolve(__dirname, "../content/content.js"), "utf8");

interface SendMessageCall {
  message: any;
  cb: (response: any) => void;
}

function setupDom(pathname: string): { dom: JSDOM; sendMessages: SendMessageCall[]; respondTo: (matcher: RegExp, response: any) => void } {
  const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
    url: "https://www.pixiv.net" + pathname,
    runScripts: "outside-only",
  });
  const { window } = dom;

  // Install globals the IIFE reads at top level.
  const sendMessages: SendMessageCall[] = [];
  (window as any).chrome = {
    runtime: {
      sendMessage: (message: any, cb: (r: any) => void) => {
        sendMessages.push({ message, cb });
      },
      lastError: undefined,
    },
  };

  // Expose to the script's scope: content.js references `window`, `document`,
  // `chrome` as globals. Running via vm with its own context requires these on
  // that context.
  const vm = (window as any)._virtualConsole;
  void vm;

  // Execute the IIFE in the jsdom window scope using its Function constructor so
  // `document`/`window`/`chrome` resolve to jsdom's.
  const fn = new window.Function(CONTENT_JS);
  fn.call(window);

  const respondTo = (matcher: RegExp, response: any) => {
    const call = sendMessages.find((c) => matcher.test(c.message.type));
    if (!call) throw new Error(`no sendMessage matching ${matcher}`);
    call.cb(response);
  };

  return { dom, sendMessages, respondTo };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("injection guard", () => {
  it("injects the import button on /artworks/<id>", () => {
    const { dom } = setupDom("/artworks/12345678");
    const btn = dom.window.document.getElementById("kura-import-btn");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("导入到 Kura");
    expect(btn?.title).toContain("Kura Booru");
  });

  it("does NOT inject on a non-artworks path", () => {
    const { dom } = setupDom("/users/123");
    expect(dom.window.document.getElementById("kura-import-btn")).toBeNull();
  });

  it("does not inject twice when run twice", () => {
    const { dom } = setupDom("/artworks/1");
    const fn = new dom.window.Function(CONTENT_JS);
    fn.call(dom.window);
    expect(dom.window.document.querySelectorAll("#kura-import-btn").length).toBe(1);
  });
});

describe("IMPORT_URL click flow", () => {
  it("disables button + sends IMPORT_URL with the page URL on click", () => {
    const { dom, sendMessages } = setupDom("/artworks/99");
    const btn = dom.window.document.getElementById("kura-import-btn") as HTMLButtonElement;

    btn.click();
    vi.runAllTicks();

    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("导入中...");
    expect(sendMessages).toHaveLength(1);
    expect(sendMessages[0].message).toEqual({
      type: "IMPORT_URL",
      url: "https://www.pixiv.net/artworks/99",
    });
  });

  it("shows 失败 and resets when response is not success", async () => {
    const { dom, respondTo } = setupDom("/artworks/1");
    const btn = dom.window.document.getElementById("kura-import-btn") as HTMLButtonElement;
    btn.click();
    vi.runAllTicks();

    respondTo(/^IMPORT_URL$/, { success: false, error: "HTTP 500" });
    vi.runAllTicks();

    expect(btn.textContent).toBe("HTTP 500");
    expect(btn.className).toBe("kura-error");

    // resetButton fires after 3000ms
    vi.advanceTimersByTime(3000);
    expect(btn.textContent).toBe("导入到 Kura");
    expect(btn.disabled).toBe(false);
  });

  it("shows 错误 on chrome.runtime.lastError", async () => {
    const { dom } = setupDom("/artworks/1");
    const window = dom.window as any;
    // Stamp lastError for the next sendMessage
    window.chrome.runtime.sendMessage = (message: any, cb: (r: any) => void) => {
      window.chrome.runtime.lastError = { message: "port closed" };
      cb(undefined);
      window.chrome.runtime.lastError = undefined;
    };
    const btn = dom.window.document.getElementById("kura-import-btn") as HTMLButtonElement;
    btn.click();
    vi.runAllTicks();

    expect(btn.textContent).toBe("错误");
    expect(btn.className).toBe("kura-error");
  });

  it("shows custom error text when response.error present but success=false", () => {
    const { dom, respondTo } = setupDom("/artworks/1");
    const btn = dom.window.document.getElementById("kura-import-btn") as HTMLButtonElement;
    btn.click();
    vi.runAllTicks();

    respondTo(/^IMPORT_URL$/, { success: false, error: "API 密钥无效" });
    vi.runAllTicks();
    expect(btn.textContent).toBe("API 密钥无效");
  });
});

describe("pollStatus terminal states (CHECK_STATUS)", () => {
  function startPoll(dom: JSDOM, sendMessages: SendMessageCall[]) {
    const btn = dom.window.document.getElementById("kura-import-btn") as HTMLButtonElement;
    btn.click();
    vi.runAllTicks();
    // resolve IMPORT_URL with a taskId -> triggers pollStatus
    sendMessages[0].cb({ success: true, taskId: "t-7" });
    vi.runAllTicks();
    return btn;
  }

  function respondCheck(sendMessages: SendMessageCall[], response: any) {
    const call = sendMessages.find((c) => c.message.type === "CHECK_STATUS");
    if (!call) throw new Error("no CHECK_STATUS message");
    call.cb(response);
    vi.runAllTicks();
  }

  it("renders 已导入！ on success result", () => {
    const { dom, sendMessages } = setupDom("/artworks/1");
    const btn = startPoll(dom, sendMessages);
    expect(btn.textContent).toBe("排队中...");

    respondCheck(sendMessages, {
      status: "complete",
      result: { status: "success" },
    });
    expect(btn.textContent).toBe("已导入！");
    expect(btn.className).toBe("kura-success");
  });

  it("renders 重复 on duplicate error", () => {
    const { dom, sendMessages } = setupDom("/artworks/1");
    const btn = startPoll(dom, sendMessages);
    respondCheck(sendMessages, {
      status: "complete",
      result: { error: "duplicate" },
    });
    expect(btn.textContent).toBe("重复");
    expect(btn.className).toBe("kura-duplicate");
  });

  it("renders 图片过大 on image_too_large error", () => {
    const { dom, sendMessages } = setupDom("/artworks/1");
    const btn = startPoll(dom, sendMessages);
    respondCheck(sendMessages, {
      status: "complete",
      result: { error: "image_too_large" },
    });
    expect(btn.textContent).toBe("图片过大");
    expect(btn.className).toBe("kura-error");
  });

  it("renders 失败 on unknown complete result error", () => {
    const { dom, sendMessages } = setupDom("/artworks/1");
    const btn = startPoll(dom, sendMessages);
    respondCheck(sendMessages, {
      status: "complete",
      result: { error: "something_else" },
    });
    expect(btn.textContent).toBe("失败");
    expect(btn.className).toBe("kura-error");
  });

  it("renders 任务丢失 on unknown status", () => {
    const { dom, sendMessages } = setupDom("/artworks/1");
    const btn = startPoll(dom, sendMessages);
    respondCheck(sendMessages, { status: "weird" });
    expect(btn.textContent).toBe("任务丢失");
    expect(btn.className).toBe("kura-error");
  });

  it("renders 错误 when CHECK_STATUS returns no response", () => {
    const { dom, sendMessages } = setupDom("/artworks/1");
    const btn = startPoll(dom, sendMessages);
    respondCheck(sendMessages, undefined);
    expect(btn.textContent).toBe("错误");
  });

  it("shows 处理中 and re-polls on queued/in_progress", () => {
    const { dom, sendMessages } = setupDom("/artworks/1");
    const btn = startPoll(dom, sendMessages);

    respondCheck(sendMessages, { status: "queued" });
    expect(btn.textContent).toBe("处理中...");
    expect(btn.className).toBe("kura-processing");

    // After 2000ms another CHECK_STATUS is sent
    vi.advanceTimersByTime(2000);
    const checkCalls = sendMessages.filter((c) => c.message.type === "CHECK_STATUS");
    expect(checkCalls.length).toBe(2);
    expect(checkCalls[1].message.taskId).toBe("t-7");
  });

  it("renders 超时 after >60 polling attempts", () => {
    const { dom, sendMessages } = setupDom("/artworks/1");
    const btn = startPoll(dom, sendMessages);

    // The script counts polling attempts and bails when attempt > 60. Each
    // loop iteration responds to the next unanswered CHECK_STATUS (which
    // increments pollStatus's attempt counter) and advances the 2s re-poll
    // timer that schedules the following CHECK_STATUS. Iterating enough times
    // reliably pushes attempt past 60 regardless of the exact off-by-one.
    const answered = new Set<SendMessageCall>();
    let checkCount = 0;
    for (let i = 0; i < 80; i++) {
      const call = sendMessages.find((c) => c.message.type === "CHECK_STATUS" && !answered.has(c));
      if (!call) {
        vi.advanceTimersByTime(2000);
        continue;
      }
      answered.add(call);
      checkCount++;
      call.cb({ status: "queued" });
      vi.runAllTicks();
      vi.advanceTimersByTime(2000);
      if (btn.textContent === "超时") break;
    }
    expect(checkCount).toBeGreaterThan(60);
    expect(btn.textContent).toBe("超时");
    expect(btn.className).toBe("kura-error");
  });
});
