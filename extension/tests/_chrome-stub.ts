import { vi, expect } from "vitest";

// Minimal types for the surface area the extension actually touches.
export interface ChromeRuntime {
  onMessage: {
    addListener: (fn: (msg: any, sender: any, sendResponse: (r: any) => void) => boolean | undefined) => void;
    _listeners: Array<(msg: any, sender: any, sendResponse: (r: any) => void) => boolean | undefined>;
  };
  sendMessage: (msg: any, cb: (response: any) => void) => void;
  lastError: { message: string } | undefined;
}

export interface ChromeStorage {
  sync: {
    get: (keys: string[], cb: (data: Record<string, any>) => void) => void;
    set: (data: Record<string, any>, cb?: () => void) => void;
  };
}

export interface ChromeStub {
  runtime: ChromeRuntime;
  storage: ChromeStorage;
}

export function installChrome(stub: ChromeStub): void {
  (globalThis as any).chrome = stub;
}

// Chrome stub: storage starts empty; fetch only installed when provided
export function makeChrome(opts: {
  storage?: Record<string, any>;
  fetch?: typeof fetch;
  sendMessage?: (msg: any) => any | Promise<any>;
  lastError?: { message: string };
} = {}): ChromeStub {
  const storageData: Record<string, any> = { ...opts.storage };

  const onMessageListeners: ChromeRuntime["onMessage"]["_listeners"] = [];
  const onMessage: ChromeRuntime["onMessage"] = {
    addListener: (fn) => onMessageListeners.push(fn),
    _listeners: onMessageListeners,
  };

  const runtime: ChromeRuntime = {
    onMessage,
    sendMessage: (msg, cb) => {
      if (opts.sendMessage) {
        Promise.resolve(opts.sendMessage(msg)).then((r) => cb(r));
      } else {
        cb(undefined);
      }
    },
    lastError: opts.lastError,
  };

  const storage: ChromeStorage = {
    sync: {
      // Extension awaits chrome.storage.sync.get(keys) — real Chrome's callback API
      // resolves undefined, so return a Promise resolving to the data object.
      get: (keys, cb) => {
        const data = keys.reduce((acc, k) => ({ ...acc, [k]: storageData[k] }), {});
        if (cb) cb(data);
        return Promise.resolve(data);
      },
      set: (data, cb) => {
        Object.assign(storageData, data);
        if (cb) cb();
        return Promise.resolve();
      },
    },
  };

  if (opts.fetch) {
    (globalThis as any).fetch = opts.fetch;
  }

  return { runtime, storage };
}

// Dispatch a message to registered onMessage listeners; resolves with sendResponse's argument
export function dispatchMessage(stub: ChromeStub, message: any): Promise<any> {
  return new Promise((resolve) => {
    const listener = stub.runtime.onMessage._listeners[0];
    if (!listener) {
      throw new Error("no onMessage listener registered");
    }
    const result = listener(message, {}, resolve);
    // service-worker returns true to keep the channel open for async sendResponse.
    expect(result).toBe(true);
  });
}

// Re-import a plain-JS script fresh so its top-level side effects (e.g. onMessage
// registration) re-run; call after installChrome().
export async function loadScript(path: string): Promise<void> {
  vi.resetModules();
  await import(path);
}
