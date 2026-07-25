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

      // Filter for ChatGPT, Claude, and Gemini tabs. A tab that is still
      // loading when the popup opens has an empty url; pendingUrl holds
      // its destination.
      const tabUrl = (tab) => (tab.url || tab.pendingUrl || "").toLowerCase();
      detectedTabs = tabs.filter(tab => {
        const url = tabUrl(tab);
        return url.includes("chatgpt.com") ||
               url.includes("chat.openai.com") ||
               url.includes("claude.ai") ||
               url.includes("claude.com") ||
               url.includes("gemini.google.com") ||
               url.includes("grok.com");
      });

      // Diagnostic: tally every open tab by hostname so missing-tab
      // reports are debuggable ("N tabs across M windows" + AI hosts).
      const hostCounts = {};
      tabs.forEach(t => {
        try { const h = new URL(t.url || t.pendingUrl || "about:blank").hostname || "(none)"; hostCounts[h] = (hostCounts[h] || 0) + 1; } catch (e) {}
      });
      const windowCount = new Set(tabs.map(t => t.windowId)).size;
      const aiHosts = Object.entries(hostCounts)
        .filter(([h]) => /chatgpt|openai|claude|gemini|grok/.test(h))
        .map(([h, n]) => `${h}: ${n}`)
        .join(", ");
      logStatus(`Scanned ${tabs.length} tabs in ${windowCount} window(s). AI hosts: ${aiHosts || "none"}.`, "info");

      // Surface the tab the popup was opened on: sort it to the top of
      // the list and flag it, so it's findable among many similar rows.
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTabId = activeTab ? activeTab.id : null;
      if (activeTabId !== null) {
        detectedTabs.sort((a, b) => (b.id === activeTabId) - (a.id === activeTabId));
        if (activeTab && !detectedTabs.some(t => t.id === activeTabId)) {
          let h = "";
          try { h = new URL(activeTab.url || activeTab.pendingUrl || "about:blank").hostname; } catch (e) {}
          logStatus(`Note: the tab you're on (${h || "unknown"}) is not a supported chat tab.`, "error");
        }
      }

      if (detectedTabs.length === 0) {
        selectAllContainer.style.display = "none";
        detectedCount.textContent = "0 tabs detected";
        tabList.innerHTML = `
          <div class="no-tabs">
            <div class="no-tabs-icon">💬</div>
            <p>No active AI chat tabs found.</p>
            <p style="font-size: 11px; margin-top: 4px; color: #64748b;">
              Open ChatGPT, Claude.ai, Google Gemini, or Grok and check back.
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
        const isCurrent = tab.id === activeTabId;
        if (isCurrent) item.classList.add("current-tab");

        // Determine site and badge style
        let siteClass = "site-chatgpt";
        let siteLabel = "ChatGPT";
        const url = tab.url.toLowerCase();
        if (url.includes("claude.ai") || url.includes("claude.com")) {
          siteClass = "site-claude";
          siteLabel = "Claude";
        } else if (url.includes("gemini.google.com")) {
          siteClass = "site-gemini";
          siteLabel = "Gemini";
        } else if (url.includes("grok.com")) {
          siteClass = "site-grok";
          siteLabel = "Grok";
        }

        item.innerHTML = `
          <input type="checkbox" class="tab-checkbox tab-select" data-tab-id="${tab.id}" checked />
          <span class="site-badge ${siteClass}">${siteLabel}</span>
          <span class="tab-title" title="${escapeHtml(tab.title || "")}">${escapeHtml(tab.title || "Untitled Chat")}</span>
          ${isCurrent ? '<span class="site-badge current-badge">THIS TAB</span>' : ''}
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
