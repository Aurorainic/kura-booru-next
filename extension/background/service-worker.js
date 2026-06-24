// Kura Booru 导入助手 — background service worker
// 处理与 Kura 后端的 API 通信

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

  try {
    var resp = await fetch(config.serverUrl + "/api/tasks/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.apiKey,
      },
      body: JSON.stringify({ source_url: url }),
    });

    if (resp.ok) {
      var data = await resp.json();
      return { success: true, taskId: data.task_id };
    }

    if (resp.status === 401) {
      return { success: false, error: "API 密钥无效" };
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
    var resp = await fetch(config.serverUrl + "/api/tasks/" + taskId, {
      headers: { "X-Api-Key": config.apiKey },
    });

    if (resp.ok) {
      return await resp.json();
    }

    return { status: "error" };
  } catch (err) {
    return { status: "error" };
  }
}

async function getConfig() {
  var data = await chrome.storage.sync.get(["serverUrl", "apiKey"]);
  return {
    serverUrl: (data.serverUrl || "").replace(/\/+$/, ""),
    apiKey: data.apiKey || "",
  };
}
