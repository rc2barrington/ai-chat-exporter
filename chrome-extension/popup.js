// JS logic for AI Chat Exporter Chrome Extension Popup

document.addEventListener("DOMContentLoaded", () => {
  const tabList = document.getElementById("tab-list");
  const exportBtn = document.getElementById("export-btn");
  const cancelBtn = document.getElementById("cancel-btn");
  const selectAllContainer = document.getElementById("select-all-container");
  const selectAllCheckbox = document.getElementById("select-all-checkbox");
  const detectedCount = document.getElementById("detected-count");
  const statusPanel = document.getElementById("status-panel");
  const toggleThinking = document.getElementById("toggle-thinking");
  const toggleTools = document.getElementById("toggle-tools");
  const toggleMedia = document.getElementById("toggle-media");

  let detectedTabs = [];

  // Log status message to panel
  function logStatus(message, type = "default", time = null) {
    const line = document.createElement("div");
    line.className = `status-line ${type}`;
    const displayTime = time || new Date().toLocaleTimeString();
    line.textContent = `[${displayTime}] ${message}`;
    statusPanel.appendChild(line);
    statusPanel.scrollTop = statusPanel.scrollHeight;
  }

  // Listen for progress messages from background.js
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "progress") {
      logStatus(request.message, request.type || "info", request.time);
      
      // Re-enable UI elements on batch completion, cancellation, or error
      if (
        request.message === "Batch export sequence completed." || 
        request.message === "Batch export was cancelled." ||
        request.type === "error"
      ) {
        exportBtn.style.display = "block";
        exportBtn.disabled = false;
        cancelBtn.style.display = "none";
        document.querySelectorAll(".tab-select, #select-all-checkbox, .switch input").forEach(el => el.disabled = false);
        scanTabs();
      }
    }
  });

  // Scan open tabs
  async function scanTabs() {
    detectedCount.textContent = "Scanning...";
    tabList.innerHTML = "";

    try {
      const tabs = await chrome.tabs.query({});
      
      // Filter for ChatGPT, Claude, and Gemini tabs
      detectedTabs = tabs.filter(tab => {
        if (!tab.url) return false;
        const url = tab.url.toLowerCase();
        return url.includes("chatgpt.com") || 
               url.includes("claude.ai") || 
               url.includes("gemini.google.com");
      });

      if (detectedTabs.length === 0) {
        selectAllContainer.style.display = "none";
        detectedCount.textContent = "0 tabs detected";
        tabList.innerHTML = `
          <div class="no-tabs">
            <div class="no-tabs-icon">💬</div>
            <p>No active AI chat tabs found.</p>
            <p style="font-size: 11px; margin-top: 4px; color: #64748b;">
              Open ChatGPT, Claude.ai, or Google Gemini and check back.
            </p>
          </div>
        `;
        exportBtn.disabled = true;
        return;
      }

      selectAllContainer.style.display = "flex";
      detectedCount.textContent = `${detectedTabs.length} tab(s) detected`;
      exportBtn.disabled = false;

      // Populate list
      detectedTabs.forEach((tab) => {
        const item = document.createElement("div");
        item.className = "tab-item";

        // Determine site and badge style
        let siteClass = "site-chatgpt";
        let siteLabel = "ChatGPT";
        const url = tab.url.toLowerCase();
        if (url.includes("claude.ai")) {
          siteClass = "site-claude";
          siteLabel = "Claude";
        } else if (url.includes("gemini.google.com")) {
          siteClass = "site-gemini";
          siteLabel = "Gemini";
        }

        item.innerHTML = `
          <input type="checkbox" class="tab-checkbox tab-select" data-tab-id="${tab.id}" checked />
          <span class="site-badge ${siteClass}">${siteLabel}</span>
          <span class="tab-title" title="${escapeHtml(tab.title || "")}">${escapeHtml(tab.title || "Untitled Chat")}</span>
        `;
        tabList.appendChild(item);
      });

      // Wire checkbox handlers
      const itemCheckboxes = document.querySelectorAll(".tab-select");
      itemCheckboxes.forEach(cb => {
        cb.addEventListener("change", updateExportButtonState);
      });

    } catch (err) {
      logStatus(`Error scanning tabs: ${err.message || err}`, "error");
    }
  }

  // Update export button state based on selections
  function updateExportButtonState() {
    const selectedCount = document.querySelectorAll(".tab-select:checked").length;
    exportBtn.disabled = selectedCount === 0;
    
    const allCount = document.querySelectorAll(".tab-select").length;
    selectAllCheckbox.checked = selectedCount === allCount;
  }

  // Select all / Deselect all
  selectAllCheckbox.addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.querySelectorAll(".tab-select").forEach(cb => {
      cb.checked = checked;
    });
    updateExportButtonState();
  });

  // Helper to escape HTML tags
  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Note: markdown + zip assembly happens in offscreen.js (see buildMarkdown there),
  // which runs in a DOM context that can use FileReader/Blob and JSZip.

  // Main export action
  exportBtn.addEventListener("click", async () => {
    const checkedBoxes = document.querySelectorAll(".tab-select:checked");
    const targetTabIds = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute("data-tab-id"), 10));

    if (targetTabIds.length === 0) return;

    // Disable UI elements and switch buttons
    exportBtn.style.display = "none";
    cancelBtn.style.display = "block";
    cancelBtn.disabled = false;
    document.querySelectorAll(".tab-select, #select-all-checkbox, .switch input").forEach(el => el.disabled = true);

    logStatus(`Delegating export of ${targetTabIds.length} chat(s) to background worker...`, "info");

    chrome.runtime.sendMessage({
      action: "startExport",
      tabs: targetTabIds,
      options: {
        includeThinking: toggleThinking.checked,
        includeTools: toggleTools.checked,
        includeMedia: toggleMedia.checked
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        logStatus(`Error launching background worker: ${chrome.runtime.lastError.message}`, "error");
        exportBtn.style.display = "block";
        exportBtn.disabled = false;
        cancelBtn.style.display = "none";
        document.querySelectorAll(".tab-select, #select-all-checkbox, .switch input").forEach(el => el.disabled = false);
      } else {
        logStatus("Background export started! You can click away or close this popup safely.", "success");
      }
    });
  });

  // Cancel export action
  cancelBtn.addEventListener("click", () => {
    cancelBtn.disabled = true;
    logStatus("Sending cancellation request...", "info");
    
    chrome.runtime.sendMessage({ action: "cancelExport" }, (response) => {
      if (chrome.runtime.lastError) {
        logStatus(`Error sending cancel: ${chrome.runtime.lastError.message}`, "error");
        cancelBtn.disabled = false;
      } else {
        logStatus("Cancel signal sent to background worker.", "info");
      }
    });
  });

  // Query background worker for current status and restore logs/UI if exporting
  chrome.runtime.sendMessage({ action: "getStatus" }, (response) => {
    if (chrome.runtime.lastError) {
      // Background worker might not be active/initialized yet
      scanTabs();
      return;
    }

    if (response && response.logs && response.logs.length > 0) {
      // Load cached logs regardless of whether it's currently exporting
      statusPanel.innerHTML = "";
      response.logs.forEach(log => {
        logStatus(log.message, log.type, log.time);
      });
    }

    if (response && response.isExporting) {
      // Disable UI elements
      exportBtn.style.display = "none";
      cancelBtn.style.display = "block";
      cancelBtn.disabled = false;
      document.querySelectorAll(".tab-select, #select-all-checkbox, .switch input").forEach(el => el.disabled = true);
    }
    // Run initial scan to discover tabs
    scanTabs();
  });
});
