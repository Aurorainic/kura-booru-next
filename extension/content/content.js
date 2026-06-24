// Kura Booru Importer — Pixiv content script
// Injects a floating "Import to Kura" button on Pixiv artwork pages

(function () {
  // Don't inject twice
  if (document.getElementById("kura-import-btn")) return;

  // Extract artwork ID from URL
  var match = window.location.pathname.match(/\/artworks\/(\d+)/);
  if (!match) return;

  var btn = document.createElement("button");
  btn.id = "kura-import-btn";
  btn.textContent = "Import to Kura";
  btn.title = "Import this artwork to your Kura Booru instance";
  document.body.appendChild(btn);

  btn.addEventListener("click", function () {
    btn.disabled = true;
    btn.textContent = "Importing...";
    btn.className = "";

    chrome.runtime.sendMessage(
      { type: "IMPORT_URL", url: window.location.href },
      function (response) {
        if (chrome.runtime.lastError) {
          btn.textContent = "Error";
          btn.className = "kura-error";
          resetButton();
          return;
        }

        if (!response || !response.success) {
          btn.textContent = response && response.error ? response.error : "Failed";
          btn.className = "kura-error";
          resetButton();
          return;
        }

        // Poll for result
        var taskId = response.taskId;
        btn.textContent = "Queued...";
        pollStatus(taskId);
      }
    );
  });

  function pollStatus(taskId) {
    chrome.runtime.sendMessage(
      { type: "CHECK_STATUS", taskId: taskId },
      function (response) {
        if (!response) {
          btn.textContent = "Error";
          btn.className = "kura-error";
          resetButton();
          return;
        }

        if (response.status === "complete" && response.result) {
          var result = response.result;
          if (result.status === "success") {
            btn.textContent = "Imported!";
            btn.className = "kura-success";
          } else if (result.error === "duplicate") {
            btn.textContent = "Duplicate";
            btn.className = "kura-duplicate";
          } else if (result.error === "image_too_large") {
            btn.textContent = "Too large";
            btn.className = "kura-error";
          } else {
            btn.textContent = "Failed";
            btn.className = "kura-error";
          }
          resetButton();
        } else if (
          response.status === "queued" ||
          response.status === "in_progress"
        ) {
          btn.textContent = "Processing...";
          setTimeout(function () {
            pollStatus(taskId);
          }, 2000);
        } else {
          // not_found or unknown
          btn.textContent = "Lost";
          btn.className = "kura-error";
          resetButton();
        }
      }
    );
  }

  function resetButton() {
    setTimeout(function () {
      btn.textContent = "Import to Kura";
      btn.className = "";
      btn.disabled = false;
    }, 3000);
  }
})();
