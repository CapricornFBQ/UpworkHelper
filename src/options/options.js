const form = document.querySelector("#settingsForm");
const saveStatus = document.querySelector("#saveStatus");
const storageUsage = document.querySelector("#storageUsage");
const retentionSummary = document.querySelector("#retentionSummary");
const refreshUsageButton = document.querySelector("#refreshUsageButton");
const createBackupButton = document.querySelector("#createBackupButton");
const exportButton = document.querySelector("#exportButton");
const compactSnapshotsButton = document.querySelector("#compactSnapshotsButton");
const redactSnapshotsButton = document.querySelector("#redactSnapshotsButton");
const exportOutput = document.querySelector("#exportOutput");
const importInput = document.querySelector("#importInput");
const previewImportButton = document.querySelector("#previewImportButton");
const commitImportButton = document.querySelector("#commitImportButton");
const dataStatus = document.querySelector("#dataStatus");
const saveProfileButton = document.querySelector("#saveProfileButton");
const clearProfileButton = document.querySelector("#clearProfileButton");
const profileStatus = document.querySelector("#profileStatus");
const portfolioSelect = document.querySelector("#portfolioSelect");
const newPortfolioButton = document.querySelector("#newPortfolioButton");
const savePortfolioButton = document.querySelector("#savePortfolioButton");
const archivePortfolioButton = document.querySelector("#archivePortfolioButton");
const clearPortfolioButton = document.querySelector("#clearPortfolioButton");
const portfolioStatus = document.querySelector("#portfolioStatus");
const fields = {
  apiKey: document.querySelector("#apiKey"),
  extractModel: document.querySelector("#extractModel"),
  scoreModel: document.querySelector("#scoreModel"),
  language: document.querySelector("#language"),
  reasoningEffort: document.querySelector("#reasoningEffort")
};
const profileFields = {
  displayName: document.querySelector("#profileDisplayName"),
  title: document.querySelector("#profileTitle"),
  summary: document.querySelector("#profileSummary"),
  skillTags: document.querySelector("#profileSkillTags"),
  serviceCategories: document.querySelector("#profileServiceCategories"),
  strengths: document.querySelector("#profileStrengths"),
  preferredProjects: document.querySelector("#profilePreferredProjects"),
  rejectRules: document.querySelector("#profileRejectRules"),
  rateCurrency: document.querySelector("#profileRateCurrency"),
  hourlyRate: document.querySelector("#profileHourlyRate"),
  minimumBudget: document.querySelector("#profileMinimumBudget"),
  fixedMinimum: document.querySelector("#profileFixedMinimum"),
  availability: document.querySelector("#profileAvailability"),
  proposalPreferences: document.querySelector("#profileProposalPreferences"),
  languagePreferences: document.querySelector("#profileLanguagePreferences")
};
const portfolioFields = {
  title: document.querySelector("#portfolioTitle"),
  summary: document.querySelector("#portfolioSummary"),
  skillTags: document.querySelector("#portfolioSkillTags"),
  outcome: document.querySelector("#portfolioOutcome"),
  proofPoints: document.querySelector("#portfolioProofPoints"),
  links: document.querySelector("#portfolioLinks"),
  applicableKeywords: document.querySelector("#portfolioApplicableKeywords")
};
let portfolioCases = [];
let selectedPortfolioId = "";

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
  await refreshMyProfile();
  await refreshPortfolioCases();
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
  compactSnapshotsButton.addEventListener("click", compactSnapshots);
  redactSnapshotsButton.addEventListener("click", redactSnapshotText);
  previewImportButton.addEventListener("click", previewImport);
  commitImportButton.addEventListener("click", commitImport);
  saveProfileButton.addEventListener("click", saveMyProfile);
  clearProfileButton.addEventListener("click", clearMyProfile);
  portfolioSelect.addEventListener("change", () => {
    selectedPortfolioId = portfolioSelect.value;
    renderSelectedPortfolio();
  });
  newPortfolioButton.addEventListener("click", newPortfolioCase);
  savePortfolioButton.addEventListener("click", savePortfolioCase);
  archivePortfolioButton.addEventListener("click", archivePortfolioCase);
  clearPortfolioButton.addEventListener("click", clearPortfolioCases);
}

async function refreshMyProfile() {
  try {
    const { profile } = await send({ type: "myProfile:get" });
    renderMyProfile(profile);
    profileStatus.textContent = profile ? `Saved profile v${profile.version}` : "No profile saved";
  } catch (error) {
    profileStatus.textContent = error.message;
  }
}

function renderMyProfile(profile) {
  profileFields.displayName.value = profile?.displayName || "";
  profileFields.title.value = profile?.title || "";
  profileFields.summary.value = profile?.summary || "";
  profileFields.skillTags.value = formatList(profile?.skillTags);
  profileFields.serviceCategories.value = formatList(profile?.serviceCategories);
  profileFields.strengths.value = formatList(profile?.strengths);
  profileFields.preferredProjects.value = formatList(profile?.preferredProjects);
  profileFields.rejectRules.value = formatList(profile?.rejectRules);
  profileFields.rateCurrency.value = profile?.rateCard?.currency || "USD";
  profileFields.hourlyRate.value = profile?.rateCard?.hourlyRateText || "";
  profileFields.minimumBudget.value = profile?.rateCard?.minimumProjectBudgetText || "";
  profileFields.fixedMinimum.value = profile?.rateCard?.fixedProjectMinimumText || "";
  profileFields.availability.value = profile?.availability || "";
  profileFields.proposalPreferences.value = formatList(profile?.proposalPreferences);
  profileFields.languagePreferences.value = formatList(profile?.languagePreferences);
}

async function saveMyProfile() {
  profileStatus.textContent = "Saving profile...";
  try {
    const { profile } = await send({ type: "myProfile:save", profile: collectMyProfile() });
    renderMyProfile(profile);
    profileStatus.textContent = `Profile saved v${profile.version}`;
    await refreshStorageUsage();
  } catch (error) {
    profileStatus.textContent = error.message;
  }
}

async function clearMyProfile() {
  if (!confirm("Clear saved My Profile? New scores and proposals will no longer use it.")) return;
  if (prompt("Type CLEAR to remove saved My Profile.") !== "CLEAR") {
    profileStatus.textContent = "Clear canceled";
    return;
  }
  profileStatus.textContent = "Clearing profile...";
  try {
    await send({ type: "myProfile:clear" });
    renderMyProfile(null);
    profileStatus.textContent = "Profile cleared";
    await refreshStorageUsage();
  } catch (error) {
    profileStatus.textContent = error.message;
  }
}

function collectMyProfile() {
  return {
    displayName: profileFields.displayName.value,
    title: profileFields.title.value,
    summary: profileFields.summary.value,
    skillTags: parseList(profileFields.skillTags.value),
    serviceCategories: parseList(profileFields.serviceCategories.value),
    strengths: parseList(profileFields.strengths.value),
    preferredProjects: parseList(profileFields.preferredProjects.value),
    rejectRules: parseList(profileFields.rejectRules.value),
    rateCard: {
      currency: profileFields.rateCurrency.value,
      hourlyRateText: profileFields.hourlyRate.value,
      minimumProjectBudgetText: profileFields.minimumBudget.value,
      fixedProjectMinimumText: profileFields.fixedMinimum.value
    },
    availability: profileFields.availability.value,
    proposalPreferences: parseList(profileFields.proposalPreferences.value),
    languagePreferences: parseList(profileFields.languagePreferences.value)
  };
}

async function refreshPortfolioCases() {
  try {
    const response = await send({ type: "portfolio:list" });
    portfolioCases = response.portfolioCases || [];
    if (!portfolioCases.some((item) => item.id === selectedPortfolioId)) {
      selectedPortfolioId = portfolioCases[0]?.id || "";
    }
    renderPortfolioSelect();
    renderSelectedPortfolio();
    portfolioStatus.textContent = portfolioCases.length ? `${portfolioCases.length} active cases` : "No active portfolio cases";
  } catch (error) {
    portfolioStatus.textContent = error.message;
  }
}

function renderPortfolioSelect() {
  portfolioSelect.innerHTML = "";
  if (!portfolioCases.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No active portfolio cases";
    portfolioSelect.append(option);
    return;
  }
  for (const item of portfolioCases) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.title} · v${item.version}`;
    portfolioSelect.append(option);
  }
  portfolioSelect.value = selectedPortfolioId;
}

function renderSelectedPortfolio() {
  const portfolioCase = portfolioCases.find((item) => item.id === selectedPortfolioId) || null;
  portfolioFields.title.value = portfolioCase?.title || "";
  portfolioFields.summary.value = portfolioCase?.summary || "";
  portfolioFields.skillTags.value = formatList(portfolioCase?.skillTags);
  portfolioFields.outcome.value = portfolioCase?.outcome || "";
  portfolioFields.proofPoints.value = formatList(portfolioCase?.proofPoints);
  portfolioFields.links.value = formatList(portfolioCase?.links);
  portfolioFields.applicableKeywords.value = formatList(portfolioCase?.applicableKeywords);
  archivePortfolioButton.disabled = !portfolioCase;
}

function newPortfolioCase() {
  selectedPortfolioId = "";
  portfolioSelect.value = "";
  renderSelectedPortfolio();
  portfolioStatus.textContent = "New case";
}

async function savePortfolioCase() {
  portfolioStatus.textContent = "Saving portfolio case...";
  try {
    const payload = collectPortfolioCase();
    const message = selectedPortfolioId
      ? { type: "portfolio:update", id: selectedPortfolioId, portfolioCase: payload }
      : { type: "portfolio:create", portfolioCase: payload };
    const response = await send(message);
    selectedPortfolioId = response.portfolioCase.id;
    await refreshPortfolioCases();
    portfolioStatus.textContent = `Portfolio case saved v${response.portfolioCase.version}`;
    await refreshStorageUsage();
  } catch (error) {
    portfolioStatus.textContent = error.message;
  }
}

async function archivePortfolioCase() {
  if (!selectedPortfolioId) return;
  const portfolioCase = portfolioCases.find((item) => item.id === selectedPortfolioId);
  if (!confirm(`Archive "${portfolioCase?.title || "this portfolio case"}"?`)) return;
  portfolioStatus.textContent = "Archiving portfolio case...";
  try {
    await send({ type: "portfolio:archive", id: selectedPortfolioId });
    selectedPortfolioId = "";
    await refreshPortfolioCases();
    portfolioStatus.textContent = "Portfolio case archived";
    await refreshStorageUsage();
  } catch (error) {
    portfolioStatus.textContent = error.message;
  }
}

async function clearPortfolioCases() {
  if (!confirm("Archive all active portfolio cases? New scores and proposals will no longer use them.")) return;
  if (prompt("Type CLEAR to archive all active portfolio cases.") !== "CLEAR") {
    portfolioStatus.textContent = "Clear canceled";
    return;
  }
  portfolioStatus.textContent = "Archiving portfolio cases...";
  try {
    const response = await send({ type: "portfolio:clear" });
    selectedPortfolioId = "";
    await refreshPortfolioCases();
    portfolioStatus.textContent = `Archived ${response.archivedCount} cases`;
    await refreshStorageUsage();
  } catch (error) {
    portfolioStatus.textContent = error.message;
  }
}

function collectPortfolioCase() {
  return {
    title: portfolioFields.title.value,
    summary: portfolioFields.summary.value,
    skillTags: parseList(portfolioFields.skillTags.value),
    outcome: portfolioFields.outcome.value,
    proofPoints: parseList(portfolioFields.proofPoints.value),
    links: parseList(portfolioFields.links.value),
    applicableKeywords: parseList(portfolioFields.applicableKeywords.value),
    sourceRefs: []
  };
}

async function refreshStorageUsage() {
  try {
    const { usage } = await send({ type: "data:getStorageUsage" });
    const quota = usage.quotaBytes ? ` / ${formatBytes(usage.quotaBytes)}` : "";
    storageUsage.textContent = `${formatBytes(usage.bytesInUse)}${quota} used`;
    await refreshRetentionSummary();
  } catch (error) {
    storageUsage.textContent = error.message;
  }
}

async function refreshRetentionSummary() {
  try {
    const { summary } = await send({ type: "snapshots:getRetentionSummary" });
    retentionSummary.textContent = formatRetentionSummary(summary);
  } catch (error) {
    retentionSummary.textContent = error.message;
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

async function compactSnapshots() {
  const message = "Compact large full snapshot text? A backup will be created before changes.";
  if (!confirm(message)) return;
  dataStatus.textContent = "Compacting snapshots...";
  try {
    const { result } = await send({ type: "snapshots:compactText" });
    dataStatus.textContent = `Compacted ${result.updatedCount} snapshots${result.backupKey ? `. Backup: ${result.backupKey}` : ""}`;
    await refreshStorageUsage();
  } catch (error) {
    dataStatus.textContent = error.message;
  }
}

async function redactSnapshotText() {
  const message = "Redact all stored snapshot text? A backup will be created before changes. Existing scores remain, but redacted snapshots cannot be used for future scoring.";
  if (!confirm(message)) return;
  if (prompt("Type REDACT to remove stored snapshot text.") !== "REDACT") {
    dataStatus.textContent = "Redaction canceled";
    return;
  }
  dataStatus.textContent = "Redacting snapshot text...";
  try {
    const { result } = await send({ type: "snapshots:redactText" });
    dataStatus.textContent = `Redacted ${result.updatedCount} snapshots${result.backupKey ? `. Backup: ${result.backupKey}` : ""}`;
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

function formatRetentionSummary(summary = {}) {
  const counts = summary.counts || {};
  return [
    `Snapshots: ${summary.totalSnapshots || 0}`,
    `with text: ${summary.snapshotsWithText || 0}`,
    `text: ${formatNumber(summary.textChars || 0)} chars`,
    `full: ${counts.full || 0}`,
    `compacted: ${counts.compacted || 0}`,
    `redacted: ${counts.redacted || 0}`
  ].join(" · ");
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function parseList(value) {
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatList(value) {
  return Array.isArray(value) ? value.join("\n") : "";
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
