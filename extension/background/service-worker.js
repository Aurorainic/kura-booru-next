// Kura Booru 导入助手 — background service worker（/api/tasks/web-import + kb_ext_ key）

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "IMPORT_URL") {
    handleImport(message.url).then(sendResponse);
    return true; // Keep channel open for async
  }
  if (message.type === "CHECK_STATUS") {
    checkTaskStatus(message.taskId).then(sendResponse);
    return true;
  }
});

async function handleImport(url) {
  var config = await getConfig();
  if (!config.serverUrl || !config.apiKey) {
    return { success: false, error: "未配置" };
  }

  var body = { urls: [url] };
  if (config.contentType && config.contentType !== "auto") {
    body.force_rating = config.contentType;
  }

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 30000);
    var resp = await fetch(config.serverUrl + "/api/tasks/web-import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      var data = await resp.json();
      // response shape: { results: [{ task_id, status, url }, ...] }
      var first = data.results && data.results[0];
      if (!first) {
        return { success: false, error: "返回格式异常" };
      }
      if (first.status === "error") {
        return { success: false, error: first.error || "服务端拒绝" };
      }
      if (!first.task_id) {
        return { success: false, error: "返回格式异常" };
      }
      return { success: true, taskId: first.task_id };
    }

    if (resp.status === 401) {
      return { success: false, error: "API 密钥无效" };
    }
    if (resp.status === 429) {
      return { success: false, error: "请求过快,请稍后再试" };
    }

    return { success: false, error: "HTTP " + resp.status };
  } catch (err) {
    return { success: false, error: "网络错误" };
  }
}

async function checkTaskStatus(taskId) {
  var config = await getConfig();
  if (!config.serverUrl || !config.apiKey) {
    return { status: "error" };
  }

  try {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 30000);
    var resp = await fetch(config.serverUrl + "/api/tasks/" + taskId, {
      headers: { "X-Api-Key": config.apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      return await resp.json();
    }

    return { status: "error" };
  } catch (err) {
    return { status: "error" };
  }
}

async function getConfig() {
  var data = await chrome.storage.sync.get(["serverUrl", "apiKey", "contentType"]);
  return {
    serverUrl: (data.serverUrl || "").replace(/\/+$/, ""),
    apiKey: data.apiKey || "",
    contentType: data.contentType || "auto",
  };
}