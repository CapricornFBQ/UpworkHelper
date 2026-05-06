const form = document.querySelector("#settingsForm");
const saveStatus = document.querySelector("#saveStatus");
const storageUsage = document.querySelector("#storageUsage");
const refreshUsageButton = document.querySelector("#refreshUsageButton");
const createBackupButton = document.querySelector("#createBackupButton");
const exportButton = document.querySelector("#exportButton");
const exportOutput = document.querySelector("#exportOutput");
const importInput = document.querySelector("#importInput");
const previewImportButton = document.querySelector("#previewImportButton");
const commitImportButton = document.querySelector("#commitImportButton");
const dataStatus = document.querySelector("#dataStatus");
const fields = {
  apiKey: document.querySelector("#apiKey"),
  extractModel: document.querySelector("#extractModel"),
  scoreModel: document.querySelector("#scoreModel"),
  language: document.querySelector("#language"),
  reasoningEffort: document.querySelector("#reasoningEffort")
};

init();

async function init() {
  bindEvents();
  try {
    const { settings } = await send({ type: "settings:get" });
    for (const [key, field] of Object.entries(fields)) {
      field.value = settings[key] || "";
    }
  } catch (error) {
    saveStatus.textContent = error.message;
  }
  await refreshStorageUsage();
}

function bindEvents() {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveStatus.textContent = "Saving...";
    const settings = Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [key, field.value])
    );
    try {
      await send({ type: "settings:save", settings });
      saveStatus.textContent = "Saved";
    } catch (error) {
      saveStatus.textContent = error.message;
    }
  });
  refreshUsageButton.addEventListener("click", refreshStorageUsage);
  createBackupButton.addEventListener("click", createBackup);
  exportButton.addEventListener("click", exportJson);
  previewImportButton.addEventListener("click", previewImport);
  commitImportButton.addEventListener("click", commitImport);
}

async function refreshStorageUsage() {
  try {
    const { usage } = await send({ type: "data:getStorageUsage" });
    const quota = usage.quotaBytes ? ` / ${formatBytes(usage.quotaBytes)}` : "";
    storageUsage.textContent = `${formatBytes(usage.bytesInUse)}${quota} used`;
  } catch (error) {
    storageUsage.textContent = error.message;
  }
}

async function createBackup() {
  dataStatus.textContent = "Creating backup...";
  try {
    const { backupKey } = await send({ type: "data:createBackup" });
    dataStatus.textContent = `Backup created: ${backupKey}`;
    await refreshStorageUsage();
  } catch (error) {
    dataStatus.textContent = error.message;
  }
}

async function exportJson() {
  dataStatus.textContent = "Exporting...";
  try {
    const { exportData } = await send({ type: "data:export" });
    exportOutput.value = JSON.stringify(exportData, null, 2);
    dataStatus.textContent = "Export ready. API key excluded.";
    await refreshStorageUsage();
  } catch (error) {
    dataStatus.textContent = error.message;
  }
}

async function previewImport() {
  dataStatus.textContent = "Previewing import...";
  try {
    const data = parseImportInput();
    const { preview } = await send({ type: "data:importPreview", data });
    dataStatus.textContent = `Import ok: ${formatEntityCounts(preview.entityCounts)}`;
  } catch (error) {
    dataStatus.textContent = error.message;
  }
}

async function commitImport() {
  try {
    const data = parseImportInput();
    const { preview } = await send({ type: "data:importPreview", data });
    const message = `Import will replace local data except API key. ${formatEntityCounts(preview.entityCounts)}. Continue?`;
    if (!confirm(message)) return;
    dataStatus.textContent = "Importing...";
    const response = await send({ type: "data:importCommit", data });
    dataStatus.textContent = `Import complete. Backup: ${response.result.backupKey}`;
    await refreshStorageUsage();
  } catch (error) {
    dataStatus.textContent = error.message;
  }
}

function parseImportInput() {
  const value = importInput.value.trim();
  if (!value) throw new Error("Import JSON is empty");
  return JSON.parse(value);
}

function formatEntityCounts(counts = {}) {
  return Object.entries(counts)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function send(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error("Chrome extension runtime is unavailable"));
  }
  return globalThis.chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "Extension request failed");
    return response;
  });
}
