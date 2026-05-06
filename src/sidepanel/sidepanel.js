const panelStatus = document.querySelector("#panelStatus");
const opportunitySelect = document.querySelector("#opportunitySelect");
const captureButton = document.querySelector("#captureButton");
const scoreButton = document.querySelector("#scoreButton");
const deleteButton = document.querySelector("#deleteButton");
const refreshButton = document.querySelector("#refreshButton");
const notesInput = document.querySelector("#notesInput");
const saveNotesButton = document.querySelector("#saveNotesButton");
const summaryPanel = document.querySelector("#summaryPanel");
const snapshotsList = document.querySelector("#snapshotsList");
const detailsPanel = document.querySelector("#detailsPanel");

let opportunities = [];
let selectedId = null;
let selectedOpportunity = null;

init();

async function init() {
  bindEvents();
  await refresh();
}

function bindEvents() {
  refreshButton.addEventListener("click", refresh);
  opportunitySelect.addEventListener("change", () => {
    selectedId = opportunitySelect.value;
    loadSelected();
  });
  captureButton.addEventListener("click", captureCurrentPage);
  scoreButton.addEventListener("click", scoreSelected);
  deleteButton.addEventListener("click", deleteSelected);
  saveNotesButton.addEventListener("click", saveNotes);
}

async function refresh() {
  const response = await send({ type: "opportunities:listSummary" });
  opportunities = response.opportunities || [];
  if (!selectedId || !opportunities.some((item) => item.id === selectedId)) {
    selectedId = opportunities[0]?.id || "";
  }
  renderOpportunitySelect();
  await loadSelected();
}

async function loadSelected() {
  selectedOpportunity = null;
  if (selectedId) {
    const response = await send({ type: "opportunities:get", id: selectedId });
    selectedOpportunity = response.opportunity || null;
  }
  renderSelected();
}

async function captureCurrentPage() {
  setStatus("Capturing DOM...");
  setBusy(true);
  try {
    const response = await send({ type: "capture:currentPage", opportunityId: selectedId || null });
    selectedId = response.opportunity.id;
    setStatus(`Captured ${response.snapshot.stats.capturedCharCount} chars`);
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function scoreSelected() {
  if (!selectedId) return;
  setStatus("Scoring with OpenAI...");
  setBusy(true);
  try {
    const response = await send({ type: "score:opportunity", opportunityId: selectedId });
    selectedOpportunity = response.opportunity;
    const index = opportunities.findIndex((item) => item.id === selectedId);
    if (index >= 0) opportunities[index] = response.opportunity;
    setStatus("Score updated");
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function deleteSelected() {
  if (!selectedId) return;
  const opportunity = getSelected();
  if (!confirm(`Archive "${opportunity?.title || "this opportunity"}"?`)) return;
  await send({ type: "opportunities:archive", id: selectedId });
  selectedId = "";
  await refresh();
}

async function saveNotes() {
  if (!selectedId) return;
  setStatus("Saving notes...");
  setBusy(true);
  try {
    await send({ type: "opportunities:updateNotes", id: selectedId, notes: notesInput.value });
    setStatus("Notes saved");
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function renderOpportunitySelect() {
  opportunitySelect.innerHTML = "";
  if (!opportunities.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No opportunities yet";
    opportunitySelect.append(option);
    return;
  }
  for (const opportunity of opportunities) {
    const option = document.createElement("option");
    option.value = opportunity.id;
    option.textContent = `${scoreLabel(opportunity)} ${opportunity.title}`;
    opportunitySelect.append(option);
  }
  opportunitySelect.value = selectedId;
}

function renderSelected() {
  const opportunity = getSelected();
  captureButton.disabled = false;
  scoreButton.disabled = !opportunity;
  deleteButton.disabled = !opportunity;
  saveNotesButton.disabled = !opportunity;

  if (!opportunity) {
    summaryPanel.innerHTML = "<p class=\"empty\">Capture a page to create the first opportunity.</p>";
    snapshotsList.textContent = "No snapshots.";
    detailsPanel.textContent = "No score yet.";
    notesInput.value = "";
    return;
  }

  notesInput.value = opportunity.notes || "";
  renderSummary(opportunity);
  renderSnapshots(opportunity);
  renderDetails(opportunity);
}

function renderSummary(opportunity) {
  const score = opportunity.scoreResult?.total_score;
  const decision = opportunity.scoreResult?.decision_summary || "Not scored yet.";
  const staleWarning = opportunity.scoreStale ? "<p class=\"warning\">Notes changed after this score. Re-score recommended.</p>" : "";
  summaryPanel.innerHTML = `
    <div class="score-card">
      <div>
        <span class="muted">Score</span>
        <strong>${Number.isFinite(score) ? Math.round(score) : "--"}/100</strong>
      </div>
      <div>
        <span class="muted">Snapshots</span>
        <strong>${opportunity.snapshots?.length || opportunity.snapshotCount || 0}</strong>
      </div>
    </div>
    <h2>${escapeHtml(opportunity.title)}</h2>
    <p>${escapeHtml(decision)}</p>
    ${staleWarning}
    <a href="${escapeAttribute(opportunity.mainUrl)}" target="_blank" rel="noreferrer">Open source page</a>
  `;
}

function renderSnapshots(opportunity) {
  snapshotsList.innerHTML = "";
  const snapshots = opportunity.snapshots || [];
  if (!snapshots.length) {
    snapshotsList.className = "list empty";
    snapshotsList.textContent = "No snapshots.";
    return;
  }
  snapshotsList.className = "list";
  for (const snapshot of snapshots.slice().reverse()) {
    const item = document.createElement("div");
    item.className = "snapshot";
    item.innerHTML = `
      <strong>${escapeHtml(snapshot.pageType)}</strong>
      <span>${escapeHtml(new Date(snapshot.capturedAt).toLocaleString())}</span>
      <small>${escapeHtml(snapshot.pageTitle || snapshot.title)}</small>
      <small>${escapeHtml(snapshot.stats?.capturedCharCount || 0)} chars</small>
    `;
    snapshotsList.append(item);
  }
}

function renderDetails(opportunity) {
  const score = opportunity.scoreResult;
  if (!score) {
    detailsPanel.className = "details empty";
    detailsPanel.textContent = "No score yet.";
    return;
  }
  detailsPanel.className = "details";
  const staleWarning = (opportunity.scoreStale || score.scoreStale) ? "<p class=\"warning\">Notes changed after this score. Re-score recommended.</p>" : "";
  const dimensions = (score.dimensions || []).map((dimension) => `
    <article class="dimension">
      <header>
        <strong>${escapeHtml(dimension.name_zh)} <span>${escapeHtml(dimension.score)}/${escapeHtml(dimension.max_score)}</span></strong>
        <small>confidence ${Math.round((dimension.confidence || 0) * 100)}%</small>
      </header>
      <p>${escapeHtml(dimension.reasoning)}</p>
      ${renderList("Evidence", dimension.evidence)}
      ${renderList("Missing", dimension.missing_fields)}
    </article>
  `).join("");

  detailsPanel.innerHTML = `
    ${staleWarning}
    <div class="decision ${escapeHtml(score.decision)}">
      <strong>${escapeHtml(score.decision)}</strong>
      <p>${escapeHtml(score.decision_summary)}</p>
    </div>
    ${renderList("Hard red flags", score.hard_red_flags)}
    ${renderList("Risks", score.risks)}
    ${renderList("Missing info checklist", score.missing_info_checklist)}
    <article class="dimension">
      <header><strong>Bid strategy</strong></header>
      <p>${escapeHtml(score.recommended_bid_strategy)}</p>
    </article>
    <article class="dimension">
      <header><strong>Proposal angle</strong></header>
      <p>${escapeHtml(score.proposal_angle)}</p>
    </article>
    ${dimensions}
  `;
}

function renderList(title, values) {
  if (!values?.length) return "";
  return `
    <div class="mini-list">
      <strong>${escapeHtml(title)}</strong>
      <ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function getSelected() {
  return selectedOpportunity || opportunities.find((item) => item.id === selectedId) || null;
}

function setBusy(isBusy) {
  captureButton.disabled = isBusy;
  scoreButton.disabled = isBusy || !selectedId;
  deleteButton.disabled = isBusy || !selectedId;
  saveNotesButton.disabled = isBusy || !selectedId;
}

function setStatus(message) {
  panelStatus.textContent = message;
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
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
