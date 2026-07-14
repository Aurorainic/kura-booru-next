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