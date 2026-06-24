// Kura Booru 导入助手 — Pixiv content script
// 在 Pixiv 作品页注入浮动导入按钮

(function () {
  // Don't inject twice
  if (document.getElementById("kura-import-btn")) return;

  // Extract artwork ID from URL
  var match = window.location.pathname.match(/\/artworks\/(\d+)/);
  if (!match) return;

  var btn = document.createElement("button");
  btn.id = "kura-import-btn";
  btn.textContent = "导入到 Kura";
  btn.title = "将此作品导入你的 Kura Booru 实例";
  document.body.appendChild(btn);

  btn.addEventListener("click", function () {
    btn.disabled = true;
    btn.textContent = "导入中...";
    btn.className = "";

    chrome.runtime.sendMessage(
      { type: "IMPORT_URL", url: window.location.href },
      function (response) {
        if (chrome.runtime.lastError) {
          btn.textContent = "错误";
          btn.className = "kura-error";
          resetButton();
          return;
        }

        if (!response || !response.success) {
          btn.textContent = response && response.error ? response.error : "失败";
          btn.className = "kura-error";
          resetButton();
          return;
        }

        // Poll for result
        var taskId = response.taskId;
        btn.textContent = "排队中...";
        pollStatus(taskId);
      }
    );
  });

  function pollStatus(taskId) {
    chrome.runtime.sendMessage(
      { type: "CHECK_STATUS", taskId: taskId },
      function (response) {
        if (!response) {
          btn.textContent = "错误";
          btn.className = "kura-error";
          resetButton();
          return;
        }

        if (response.status === "complete" && response.result) {
          var result = response.result;
          if (result.status === "success") {
            btn.textContent = "已导入！";
            btn.className = "kura-success";
          } else if (result.error === "duplicate") {
            btn.textContent = "重复";
            btn.className = "kura-duplicate";
          } else if (result.error === "image_too_large") {
            btn.textContent = "图片过大";
            btn.className = "kura-error";
          } else {
            btn.textContent = "失败";
            btn.className = "kura-error";
          }
          resetButton();
        } else if (
          response.status === "queued" ||
          response.status === "in_progress"
        ) {
          btn.textContent = "处理中...";
          btn.className = "kura-processing";
          setTimeout(function () {
            pollStatus(taskId);
          }, 2000);
        } else {
          // not_found or unknown
          btn.textContent = "任务丢失";
          btn.className = "kura-error";
          resetButton();
        }
      }
    );
  }

  function resetButton() {
    setTimeout(function () {
      btn.textContent = "导入到 Kura";
      btn.className = "";
      btn.disabled = false;
    }, 3000);
  }
})();
