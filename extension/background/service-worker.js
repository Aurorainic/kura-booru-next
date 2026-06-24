// Kura Booru Importer — background service worker
// Handles API calls to the Kura backend

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
    return { success: false, error: "Not configured" };
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
      return { success: false, error: "Invalid API key" };
    }

    return { success: false, error: "HTTP " + resp.status };
  } catch (err) {
    return { success: false, error: "Network error" };
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
