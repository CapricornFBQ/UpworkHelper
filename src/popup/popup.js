const statusText = document.querySelector("#statusText");
const opportunitySelect = document.querySelector("#opportunitySelect");
const recentList = document.querySelector("#recentList");
const captureButton = document.querySelector("#captureButton");
const openPanelButton = document.querySelector("#openPanelButton");
const openOptionsButton = document.querySelector("#openOptions");

let opportunities = [];

init();

async function init() {
  bindEvents();
  await refresh();
}

function bindEvents() {
  captureButton.addEventListener("click", captureCurrentPage);
  openPanelButton.addEventListener("click", openPanel);
  openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
}

async function refresh() {
  const response = await send({ type: "opportunities:listSummary" });
  opportunities = response.opportunities || [];
  renderOpportunitySelect();
  renderRecentList();
}

async function captureCurrentPage() {
  setBusy(true, "Capturing DOM...");
  try {
    const opportunityId = opportunitySelect.value || null;
    const response = await send({ type: "capture:currentPage", opportunityId });
    statusText.textContent = `Captured ${response.snapshot.stats.capturedCharCount} chars`;
    await refresh();
    opportunitySelect.value = response.opportunity.id;
    await openPanel();
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function openPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (chrome.sidePanel?.open && tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
}

function renderOpportunitySelect() {
  const current = opportunitySelect.value;
  opportunitySelect.innerHTML = '<option value="">New opportunity</option>';
  for (const opportunity of opportunities) {
    const option = document.createElement("option");
    option.value = opportunity.id;
    option.textContent = `${scoreLabel(opportunity)} ${opportunity.title}`;
    opportunitySelect.append(option);
  }
  opportunitySelect.value = opportunities.some((item) => item.id === current) ? current : "";
}

function renderRecentList() {
  recentList.innerHTML = "";
  if (!opportunities.length) {
    recentList.className = "list empty";
    recentList.textContent = "No opportunities yet.";
    return;
  }
  recentList.className = "list";
  for (const opportunity of opportunities.slice(0, 5)) {
    const item = document.createElement("button");
    item.className = "list-item";
    item.innerHTML = `
      <span>${escapeHtml(opportunity.title)}</span>
      <strong>${scoreLabel(opportunity)}</strong>
    `;
    item.addEventListener("click", () => {
      opportunitySelect.value = opportunity.id;
      openPanel();
    });
    recentList.append(item);
  }
}

function setBusy(isBusy, label) {
  captureButton.disabled = isBusy;
  if (label) statusText.textContent = label;
}

function scoreLabel(opportunity) {
  const score = opportunity.scoreResult?.total_score ?? opportunity.currentScore?.totalScore;
  return Number.isFinite(score) ? `${Math.round(score)}/100` : "Draft";
}

function send(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "Extension request failed");
    return response;
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
