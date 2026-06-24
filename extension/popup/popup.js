// Kura Booru Importer — popup settings

document.addEventListener("DOMContentLoaded", function () {
  var serverUrlInput = document.getElementById("server-url");
  var apiKeyInput = document.getElementById("api-key");
  var saveBtn = document.getElementById("save-btn");
  var statusDiv = document.getElementById("status");

  // Load saved settings
  chrome.storage.sync.get(["serverUrl", "apiKey"], function (data) {
    serverUrlInput.value = data.serverUrl || "";
    apiKeyInput.value = data.apiKey || "";
  });

  saveBtn.addEventListener("click", function () {
    var serverUrl = serverUrlInput.value.replace(/\/+$/, "");
    var apiKey = apiKeyInput.value.trim();

    chrome.storage.sync.set({ serverUrl: serverUrl, apiKey: apiKey }, function () {
      statusDiv.textContent = "Saved!";
      statusDiv.className = "success";
      setTimeout(function () {
        statusDiv.textContent = "";
        statusDiv.className = "";
      }, 2000);
    });
  });
});
