// Kura Booru 导入助手 — popup settings (v0.7.8: + contentType select)

document.addEventListener("DOMContentLoaded", function () {
  var serverUrlInput = document.getElementById("server-url");
  var apiKeyInput = document.getElementById("api-key");
  var contentTypeInput = document.getElementById("content-type");
  var saveBtn = document.getElementById("save-btn");
  var statusDiv = document.getElementById("status");

  // Load saved settings
  chrome.storage.sync.get(["serverUrl", "apiKey", "contentType"], function (data) {
    serverUrlInput.value = data.serverUrl || "";
    apiKeyInput.value = data.apiKey || "";
    contentTypeInput.value = data.contentType || "auto";
  });

  saveBtn.addEventListener("click", function () {
    var serverUrl = serverUrlInput.value.replace(/\/+$/, "");
    var apiKey = apiKeyInput.value.trim();
    var contentType = contentTypeInput.value || "auto";

    // ponytail: surface a typo (e.g. pasting BACKEND_API_KEY) immediately
    // instead of letting the user discover it via 401 on every import.
    if (apiKey && apiKey.indexOf("kb_ext_") !== 0) {
      statusDiv.textContent = "Key 应以 kb_ext_ 开头 — 去 admin 后台生成";
      statusDiv.className = "error";
      setTimeout(function () {
        statusDiv.textContent = "";
        statusDiv.className = "";
      }, 3000);
      return;
    }

    chrome.storage.sync.set({
      serverUrl: serverUrl,
      apiKey: apiKey,
      contentType: contentType,
    }, function () {
      statusDiv.textContent = "已保存！";
      statusDiv.className = "success";
      setTimeout(function () {
        statusDiv.textContent = "";
        statusDiv.className = "";
      }, 2000);
    });
  });
});