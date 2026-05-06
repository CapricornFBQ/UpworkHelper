import { PROFILE_FIELD_DEFINITIONS } from "../shared/adapters.js";
import { OUTCOME_STATUS } from "../shared/schema.js";

const panelStatus = document.querySelector("#panelStatus");
const opportunitySelect = document.querySelector("#opportunitySelect");
const outcomeFilter = document.querySelector("#outcomeFilter");
const captureButton = document.querySelector("#captureButton");
const scoreButton = document.querySelector("#scoreButton");
const deleteButton = document.querySelector("#deleteButton");
const permanentDeleteButton = document.querySelector("#permanentDeleteButton");
const refreshButton = document.querySelector("#refreshButton");
const notesInput = document.querySelector("#notesInput");
const saveNotesButton = document.querySelector("#saveNotesButton");
const extractProfileButton = document.querySelector("#extractProfileButton");
const saveProfileButton = document.querySelector("#saveProfileButton");
const clearProfileButton = document.querySelector("#clearProfileButton");
const profileReviewBadge = document.querySelector("#profileReviewBadge");
const profileFieldsPanel = document.querySelector("#profileFieldsPanel");
const profileConflictsPanel = document.querySelector("#profileConflictsPanel");
const selectorBadge = document.querySelector("#selectorBadge");
const selectorFieldSelect = document.querySelector("#selectorFieldSelect");
const selectorPageType = document.querySelector("#selectorPageType");
const pickSelectorButton = document.querySelector("#pickSelectorButton");
const extractSelectorsButton = document.querySelector("#extractSelectorsButton");
const fieldSelectorsList = document.querySelector("#fieldSelectorsList");
const summaryPanel = document.querySelector("#summaryPanel");
const clientBadge = document.querySelector("#clientBadge");
const clientSummaryPanel = document.querySelector("#clientSummaryPanel");
const clientRecordSelect = document.querySelector("#clientRecordSelect");
const clientPrimaryKey = document.querySelector("#clientPrimaryKey");
const clientDisplayName = document.querySelector("#clientDisplayName");
const clientNotes = document.querySelector("#clientNotes");
const clientRedFlags = document.querySelector("#clientRedFlags");
const saveClientButton = document.querySelector("#saveClientButton");
const linkClientButton = document.querySelector("#linkClientButton");
const unlinkClientButton = document.querySelector("#unlinkClientButton");
const splitClientButton = document.querySelector("#splitClientButton");
const archiveClientButton = document.querySelector("#archiveClientButton");
const clientMergeSourceSelect = document.querySelector("#clientMergeSourceSelect");
const clientMergeTargetSelect = document.querySelector("#clientMergeTargetSelect");
const mergeClientButton = document.querySelector("#mergeClientButton");
const clientHistoryPanel = document.querySelector("#clientHistoryPanel");
const snapshotsList = document.querySelector("#snapshotsList");
const detailsPanel = document.querySelector("#detailsPanel");
const generateProposalButton = document.querySelector("#generateProposalButton");
const saveProposalButton = document.querySelector("#saveProposalButton");
const copyProposalButton = document.querySelector("#copyProposalButton");
const archiveProposalButton = document.querySelector("#archiveProposalButton");
const proposalBadge = document.querySelector("#proposalBadge");
const proposalRiskPanel = document.querySelector("#proposalRiskPanel");
const proposalOutput = document.querySelector("#proposalOutput");
const proposalDetailsPanel = document.querySelector("#proposalDetailsPanel");
const outcomeBadge = document.querySelector("#outcomeBadge");
const outcomeSummaryPanel = document.querySelector("#outcomeSummaryPanel");
const outcomeEventType = document.querySelector("#outcomeEventType");
const outcomeOccurredAt = document.querySelector("#outcomeOccurredAt");
const outcomeConnectsSpent = document.querySelector("#outcomeConnectsSpent");
const outcomeBidAmount = document.querySelector("#outcomeBidAmount");
const outcomeBidType = document.querySelector("#outcomeBidType");
const outcomeEventSelect = document.querySelector("#outcomeEventSelect");
const outcomeNotes = document.querySelector("#outcomeNotes");
const saveOutcomeEventButton = document.querySelector("#saveOutcomeEventButton");
const voidOutcomeEventButton = document.querySelector("#voidOutcomeEventButton");
const outcomeTimeline = document.querySelector("#outcomeTimeline");

let opportunities = [];
let clientRecords = [];
let fieldSelectors = [];
let selectedId = null;
let selectedOpportunity = null;
let selectedOutcomeFilter = "";

init();

async function init() {
  bindEvents();
  await refresh();
}

function bindEvents() {
  refreshButton.addEventListener("click", refresh);
  outcomeFilter.addEventListener("change", () => {
    selectedOutcomeFilter = outcomeFilter.value;
    const visible = getVisibleOpportunities();
    if (!visible.some((item) => item.id === selectedId)) selectedId = visible[0]?.id || "";
    renderOpportunitySelect();
    loadSelected();
  });
  opportunitySelect.addEventListener("change", () => {
    selectedId = opportunitySelect.value;
    loadSelected();
  });
  captureButton.addEventListener("click", captureCurrentPage);
  scoreButton.addEventListener("click", scoreSelected);
  deleteButton.addEventListener("click", deleteSelected);
  permanentDeleteButton.addEventListener("click", permanentDeleteSelected);
  saveNotesButton.addEventListener("click", saveNotes);
  extractProfileButton.addEventListener("click", extractProfile);
  saveProfileButton.addEventListener("click", saveProfileCorrections);
  clearProfileButton.addEventListener("click", clearProfileCorrections);
  pickSelectorButton.addEventListener("click", pickFieldSelector);
  extractSelectorsButton.addEventListener("click", extractCurrentSelectors);
  fieldSelectorsList.addEventListener("click", archiveFieldSelectorFromList);
  generateProposalButton.addEventListener("click", generateProposal);
  saveProposalButton.addEventListener("click", saveProposalEdit);
  copyProposalButton.addEventListener("click", copyProposalText);
  archiveProposalButton.addEventListener("click", archiveProposal);
  saveOutcomeEventButton.addEventListener("click", saveOutcomeEvent);
  voidOutcomeEventButton.addEventListener("click", voidSelectedOutcomeEvent);
  clientRecordSelect.addEventListener("change", renderClientFormFromSelection);
  saveClientButton.addEventListener("click", saveClientRecord);
  linkClientButton.addEventListener("click", linkSelectedClient);
  unlinkClientButton.addEventListener("click", unlinkSelectedClient);
  splitClientButton.addEventListener("click", splitCurrentOpportunityFromClient);
  archiveClientButton.addEventListener("click", archiveSelectedClient);
  mergeClientButton.addEventListener("click", mergeSelectedClients);
}

async function refresh() {
  const [opportunityResponse, clientResponse, selectorResponse] = await Promise.all([
    send({ type: "opportunities:listSummary" }),
    send({ type: "clients:list" }),
    send({ type: "selectors:list", filters: { includeArchived: false } })
  ]);
  opportunities = opportunityResponse.opportunities || [];
  clientRecords = clientResponse.clientRecords || [];
  fieldSelectors = selectorResponse.fieldSelectors || [];
  const visible = getVisibleOpportunities();
  if (!selectedId || !visible.some((item) => item.id === selectedId)) {
    selectedId = visible[0]?.id || "";
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

async function permanentDeleteSelected() {
  if (!selectedId) return;
  const opportunity = getSelected();
  const title = opportunity?.title || "this opportunity";
  const warning = `Permanently delete "${title}" and its snapshots, notes, profiles, scores, proposals, outcomes, and client links? This cannot be undone.`;
  if (!confirm(warning)) return;
  if (prompt("Type DELETE to permanently delete this opportunity.") !== "DELETE") {
    setStatus("Permanent delete canceled");
    return;
  }
  setStatus("Deleting permanently...");
  setBusy(true);
  try {
    await send({ type: "opportunities:deletePermanent", id: selectedId });
    selectedId = "";
    setStatus("Opportunity permanently deleted");
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
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

async function extractProfile() {
  if (!selectedId) return;
  setStatus("Extracting fields...");
  setBusy(true);
  try {
    const response = await send({ type: "profile:extract", opportunityId: selectedId });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Fields extracted");
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function saveProfileCorrections() {
  if (!selectedId) return;
  setStatus("Saving profile corrections...");
  setBusy(true);
  try {
    const response = await send({
      type: "profile:saveCorrections",
      opportunityId: selectedId,
      fields: collectProfileFieldValues()
    });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Profile corrections saved");
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function clearProfileCorrections() {
  if (!selectedId) return;
  if (!confirm("Clear user profile corrections and return to AI extracted values?")) return;
  setStatus("Clearing profile corrections...");
  setBusy(true);
  try {
    const response = await send({ type: "profile:clearCorrections", opportunityId: selectedId });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Profile corrections cleared");
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function generateProposal() {
  if (!selectedId) return;
  setStatus("Generating proposal...");
  setBusy(true);
  try {
    const response = await send({ type: "proposal:generate", opportunityId: selectedId });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Proposal draft generated");
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function saveProposalEdit() {
  const draft = selectedOpportunity?.proposalDraft;
  if (!draft) return;
  setStatus("Saving proposal edit...");
  setBusy(true);
  try {
    const response = await send({
      type: "proposal:updateDraft",
      id: draft.id,
      patch: { finalText: proposalOutput.value }
    });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Proposal edit saved");
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function copyProposalText() {
  const draft = selectedOpportunity?.proposalDraft;
  if (!draft || !proposalOutput.value.trim()) return;
  if ((draft.unsupportedClaims || []).length && !confirm("This draft has unsupported claims. Copy anyway?")) return;
  try {
    await navigator.clipboard.writeText(proposalOutput.value);
    setStatus("Proposal text copied");
  } catch (error) {
    setStatus(error.message || "Clipboard copy failed");
  }
}

async function archiveProposal() {
  const draft = selectedOpportunity?.proposalDraft;
  if (!draft) return;
  if (!confirm("Archive this proposal draft?")) return;
  setStatus("Archiving proposal draft...");
  setBusy(true);
  try {
    const response = await send({ type: "proposal:archive", id: draft.id });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Proposal draft archived");
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function saveOutcomeEvent() {
  if (!selectedId) return;
  setStatus("Recording outcome...");
  setBusy(true);
  try {
    const response = await send({
      type: "outcome:appendEvent",
      opportunityId: selectedId,
      event: collectOutcomeEventInput()
    });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Outcome recorded");
    outcomeNotes.value = "";
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function voidSelectedOutcomeEvent() {
  const eventId = outcomeEventSelect.value;
  if (!eventId) return;
  if (!confirm("Void this outcome event? The event stays in the timeline as voided.")) return;
  setStatus("Voiding outcome event...");
  setBusy(true);
  try {
    const response = await send({ type: "outcome:voidEvent", id: eventId, reason: outcomeNotes.value });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Outcome event voided");
    renderSelected();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function saveClientRecord() {
  if (!selectedId) return;
  setStatus("Saving client...");
  setBusy(true);
  try {
    const id = clientRecordSelect.value;
    if (id) {
      await send({ type: "clients:update", id, clientRecord: collectClientRecordInput() });
    } else {
      await send({ type: "clients:create", opportunityId: selectedId, clientRecord: collectClientRecordInput() });
    }
    setStatus("Client saved");
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function linkSelectedClient() {
  if (!selectedId || !clientRecordSelect.value) return;
  setStatus("Linking client...");
  setBusy(true);
  try {
    const response = await send({
      type: "clients:linkOpportunity",
      opportunityId: selectedId,
      id: clientRecordSelect.value
    });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Client linked");
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function unlinkSelectedClient() {
  if (!selectedId || !selectedOpportunity?.clientRecordId) return;
  setStatus("Unlinking client...");
  setBusy(true);
  try {
    const response = await send({ type: "clients:unlinkOpportunity", opportunityId: selectedId });
    selectedOpportunity = response.opportunity;
    updateOpportunitySummary(response.opportunity);
    setStatus("Client unlinked");
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function archiveSelectedClient() {
  const id = clientRecordSelect.value || selectedOpportunity?.clientRecordId;
  if (!id) return;
  if (!confirm("Archive this client record and unlink its opportunities?")) return;
  setStatus("Archiving client...");
  setBusy(true);
  try {
    await send({ type: "clients:archive", id });
    setStatus("Client archived");
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function mergeSelectedClients() {
  const sourceId = clientMergeSourceSelect.value;
  const targetId = clientMergeTargetSelect.value;
  if (!sourceId || !targetId || sourceId === targetId) return;
  if (!confirm("Merge source client into target client?")) return;
  setStatus("Merging clients...");
  setBusy(true);
  try {
    await send({ type: "clients:merge", sourceId, targetId });
    setStatus("Clients merged");
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function splitCurrentOpportunityFromClient() {
  const sourceId = selectedOpportunity?.clientRecordId;
  if (!selectedId || !sourceId) return;
  setStatus("Splitting client...");
  setBusy(true);
  try {
    await send({
      type: "clients:split",
      sourceId,
      opportunityIds: [selectedId],
      clientRecord: collectClientRecordInput({ forceNewKey: true })
    });
    setStatus("Client split");
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function renderOpportunitySelect() {
  opportunitySelect.innerHTML = "";
  outcomeFilter.value = selectedOutcomeFilter;
  const visible = getVisibleOpportunities();
  if (!visible.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No opportunities yet";
    opportunitySelect.append(option);
    return;
  }
  for (const opportunity of visible) {
    const option = document.createElement("option");
    option.value = opportunity.id;
    option.textContent = `${scoreLabel(opportunity)} ${outcomeLabel(opportunity.outcomeSummary?.status)} ${opportunity.title}`;
    opportunitySelect.append(option);
  }
  opportunitySelect.value = selectedId;
}

function renderSelected() {
  const opportunity = getSelected();
  captureButton.disabled = false;
  scoreButton.disabled = !opportunity;
  deleteButton.disabled = !opportunity;
  permanentDeleteButton.disabled = !opportunity;
  saveNotesButton.disabled = !opportunity;

  if (!opportunity) {
    summaryPanel.innerHTML = "<p class=\"empty\">Capture a page to create the first opportunity.</p>";
    snapshotsList.textContent = "No snapshots.";
    detailsPanel.textContent = "No score yet.";
    notesInput.value = "";
    renderClient(null);
    renderProfileEditor(null);
    renderSelectorAssist(null);
    renderProposal(null);
    renderOutcome(null);
    return;
  }

  notesInput.value = opportunity.notes || "";
  renderSummary(opportunity);
  renderClient(opportunity);
  renderProfileEditor(opportunity);
  renderSelectorAssist(opportunity);
  renderSnapshots(opportunity);
  renderDetails(opportunity);
  renderProposal(opportunity);
  renderOutcome(opportunity);
}

async function pickFieldSelector() {
  if (!selectorFieldSelect.value) return;
  setStatus("Pick an element on the active Upwork tab...");
  setBusy(true);
  try {
    const response = await send({
      type: "selectors:startPicking",
      fieldKey: selectorFieldSelect.value,
      pageType: selectorPageType.value || ""
    });
    fieldSelectors = [response.fieldSelector, ...fieldSelectors.filter((item) => item.id !== response.fieldSelector.id)];
    setStatus("Selector saved");
    renderSelectorAssist(getSelected());
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function extractCurrentSelectors() {
  setStatus("Extracting selectors from active page...");
  setBusy(true);
  try {
    const response = await send({ type: "selectors:extractForCurrentPage" });
    const results = response.result?.selectorResults || [];
    const failures = results.filter((item) => !item.ok);
    const matches = results.filter((item) => item.ok);
    await refreshSelectors();
    setStatus(`Selector extract: ${matches.length} matched, ${failures.length} failed`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function archiveFieldSelectorFromList(event) {
  const button = event.target.closest("[data-archive-selector-id]");
  if (!button) return;
  if (!confirm("Archive this field selector?")) return;
  setStatus("Archiving selector...");
  setBusy(true);
  try {
    await send({ type: "selectors:archive", id: button.dataset.archiveSelectorId });
    await refreshSelectors();
    setStatus("Selector archived");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function refreshSelectors() {
  const response = await send({ type: "selectors:list", filters: { includeArchived: false } });
  fieldSelectors = response.fieldSelectors || [];
  renderSelectorAssist(getSelected());
}

function renderSummary(opportunity) {
  const score = opportunity.scoreResult?.total_score;
  const decision = opportunity.scoreResult?.decision_summary || "Not scored yet.";
  const staleWarning = opportunity.scoreStale ? "<p class=\"warning\">Notes changed after this score. Re-score recommended.</p>" : "";
  const profileWarning = opportunity.profile && !opportunity.profile.reviewedAt
    ? "<p class=\"warning\">Extracted fields are not reviewed. Score confidence may be lower.</p>"
    : "";
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
    ${profileWarning}
    <a href="${escapeAttribute(opportunity.mainUrl)}" target="_blank" rel="noreferrer">Open source page</a>
  `;
}

function renderClient(opportunity) {
  renderClientSelects(opportunity);
  const clientRecord = opportunity?.clientRecord || null;
  saveClientButton.disabled = !opportunity;
  linkClientButton.disabled = !opportunity || !clientRecordSelect.value;
  unlinkClientButton.disabled = !opportunity?.clientRecordId;
  splitClientButton.disabled = !opportunity?.clientRecordId;
  archiveClientButton.disabled = !clientRecordSelect.value && !opportunity?.clientRecordId;
  mergeClientButton.disabled = !clientMergeSourceSelect.value || !clientMergeTargetSelect.value || clientMergeSourceSelect.value === clientMergeTargetSelect.value;

  if (!opportunity) {
    clientBadge.className = "badge";
    clientBadge.textContent = "Unlinked";
    clientSummaryPanel.className = "details empty";
    clientSummaryPanel.textContent = "No client record.";
    clearClientForm();
    clientHistoryPanel.className = "list empty";
    clientHistoryPanel.textContent = "No client history.";
    return;
  }

  if (clientRecord) {
    clientBadge.className = "badge reviewed";
    clientBadge.textContent = "Linked";
    clientSummaryPanel.className = "details";
    clientSummaryPanel.innerHTML = renderClientSummary(clientRecord);
    clientHistoryPanel.className = clientRecord.summary?.opportunities?.length ? "list" : "list empty";
    clientHistoryPanel.innerHTML = renderClientHistory(clientRecord);
    fillClientForm(clientRecord);
    return;
  }

  clientBadge.className = "badge";
  clientBadge.textContent = "Unlinked";
  clientSummaryPanel.className = "details empty";
  clientSummaryPanel.textContent = "No client record.";
  renderClientFormFromSelection();
  clientHistoryPanel.className = "list empty";
  clientHistoryPanel.textContent = "No client history.";
}

function renderClientSelects(opportunity) {
  const linkedClientId = opportunity?.clientRecordId || "";
  fillSelect(clientRecordSelect, clientRecords, "New client", linkedClientId);
  fillSelect(clientMergeSourceSelect, clientRecords, "Source", linkedClientId);
  const defaultTarget = clientRecords.find((item) => item.id !== clientMergeSourceSelect.value)?.id || "";
  fillSelect(clientMergeTargetSelect, clientRecords, "Target", defaultTarget);
}

function fillSelect(select, records, emptyLabel, selectedValue) {
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  select.append(empty);
  for (const record of records) {
    const option = document.createElement("option");
    option.value = record.id;
    option.textContent = `${record.displayName} (${record.summary?.seenCount || 0})`;
    select.append(option);
  }
  select.value = selectedValue || "";
}

function renderClientSummary(clientRecord) {
  const summary = clientRecord.summary || {};
  return `
    <article class="dimension">
      <header><strong>${escapeHtml(clientRecord.displayName)}</strong><span>${escapeHtml(summary.seenCount || 0)} seen</span></header>
      <small>key ${escapeHtml(clientRecord.primaryClientKey)}</small>
      <small>average score ${escapeHtml(summary.averageScore ?? "none")}</small>
      <small>previous outcomes ${(summary.previousOutcomes || []).map((item) => escapeHtml(outcomeLabel(item.status))).join(", ") || "none"}</small>
      ${clientRecord.notes ? `<small>${escapeHtml(clientRecord.notes)}</small>` : ""}
      ${(clientRecord.redFlags || []).length ? `<small>red flags ${escapeHtml(clientRecord.redFlags.join("; "))}</small>` : ""}
    </article>
  `;
}

function renderClientHistory(clientRecord) {
  const opportunities = clientRecord.summary?.opportunities || [];
  if (!opportunities.length) return "No client history.";
  return opportunities.map((item) => `
    <div class="snapshot">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.totalScore ?? "no score")}</span>
      <small>${escapeHtml(outcomeLabel(item.outcomeStatus))}</small>
      <small>${escapeHtml(formatDateTime(item.updatedAt))}</small>
    </div>
  `).join("");
}

function renderClientFormFromSelection() {
  const selected = clientRecords.find((item) => item.id === clientRecordSelect.value) || null;
  if (selected) {
    fillClientForm(selected);
    linkClientButton.disabled = !selectedId;
    archiveClientButton.disabled = false;
    return;
  }
  if (!selectedOpportunity?.clientRecord) clearClientForm();
  linkClientButton.disabled = true;
}

function fillClientForm(clientRecord) {
  clientDisplayName.value = clientRecord.displayName || "";
  clientPrimaryKey.value = clientRecord.primaryClientKey || "";
  clientNotes.value = clientRecord.notes || "";
  clientRedFlags.value = (clientRecord.redFlags || []).join("\n");
}

function clearClientForm() {
  clientDisplayName.value = "";
  clientPrimaryKey.value = "";
  clientNotes.value = "";
  clientRedFlags.value = "";
}

function renderProfileEditor(opportunity) {
  const profile = opportunity?.profile || null;
  extractProfileButton.disabled = !opportunity;
  saveProfileButton.disabled = !profile;
  clearProfileButton.disabled = !profile || !profile.reviewedAt;

  if (!opportunity) {
    profileReviewBadge.className = "badge";
    profileReviewBadge.textContent = "Not extracted";
    profileFieldsPanel.className = "profile-fields empty";
    profileFieldsPanel.textContent = "No extracted fields.";
    profileConflictsPanel.className = "list empty";
    profileConflictsPanel.textContent = "No conflicts.";
    return;
  }

  if (!profile) {
    profileReviewBadge.className = "badge";
    profileReviewBadge.textContent = "Not extracted";
    profileFieldsPanel.className = "profile-fields empty";
    profileFieldsPanel.textContent = "Extract fields before scoring or editing profile data.";
    profileConflictsPanel.className = "list empty";
    profileConflictsPanel.textContent = "No conflicts.";
    return;
  }

  profileReviewBadge.className = `badge${profile.reviewedAt ? " reviewed" : ""}`;
  profileReviewBadge.textContent = profile.reviewedAt ? "Reviewed" : "Needs review";
  profileFieldsPanel.className = "profile-fields";
  profileFieldsPanel.innerHTML = PROFILE_FIELD_DEFINITIONS.map((definition) => {
    const field = profile.fields?.[definition.key] || {};
    const value = formatProfileFieldValue(field.value, definition.valueKind);
    const source = field.effectiveSource || "missing";
    const rows = definition.valueKind === "array" || value.length > 90 ? 3 : 2;
    return `
      <label class="profile-field">
        ${escapeHtml(definition.label)}
        <small>${escapeHtml(sourceLabel(source))}</small>
        <textarea data-profile-field="${escapeAttribute(definition.key)}" rows="${rows}">${escapeHtml(value)}</textarea>
      </label>
    `;
  }).join("");
  renderProfileConflicts(profile.conflicts || []);
}

function renderProfileConflicts(conflicts) {
  if (!conflicts.length) {
    profileConflictsPanel.className = "list empty";
    profileConflictsPanel.textContent = "No conflicts.";
    return;
  }
  profileConflictsPanel.className = "list";
  profileConflictsPanel.innerHTML = conflicts.map((conflict) => {
    const values = (conflict.sources || []).map((source) => (
      `<small>${escapeHtml(sourceLabel(source.source))}: ${escapeHtml(formatProfileFieldValue(source.value))}</small>`
    )).join("");
    return `
      <div class="conflict">
        <strong>${escapeHtml(conflict.label || conflict.fieldKey)}</strong>
        ${values}
      </div>
    `;
  }).join("");
}

function renderSelectorAssist(opportunity) {
  selectorFieldSelect.innerHTML = PROFILE_FIELD_DEFINITIONS.map((definition) => (
    `<option value="${escapeAttribute(definition.key)}">${escapeHtml(definition.label)}</option>`
  )).join("");
  const latestPageType = getLatestPageType(opportunity);
  if ([...selectorPageType.options].some((option) => option.value === latestPageType)) {
    selectorPageType.value = latestPageType;
  }

  const relevantSelectors = getRelevantFieldSelectors(opportunity);
  pickSelectorButton.disabled = false;
  extractSelectorsButton.disabled = !fieldSelectors.length;
  selectorBadge.className = `badge${relevantSelectors.length ? " reviewed" : ""}`;
  selectorBadge.textContent = `${relevantSelectors.length} active`;

  if (!relevantSelectors.length) {
    fieldSelectorsList.className = "list empty";
    fieldSelectorsList.textContent = "No field selectors for this opportunity host/page type.";
    return;
  }

  fieldSelectorsList.className = "list";
  fieldSelectorsList.innerHTML = relevantSelectors.map((fieldSelector) => {
    const definition = PROFILE_FIELD_DEFINITIONS.find((item) => item.key === fieldSelector.fieldKey);
    const failure = fieldSelector.lastFailure;
    return `
      <div class="snapshot">
        <strong>${escapeHtml(definition?.label || fieldSelector.fieldKey)}</strong>
        <span>${escapeHtml(fieldSelector.pageType)} · v${escapeHtml(fieldSelector.version)}</span>
        <small>${escapeHtml(fieldSelector.selector)}</small>
        <small>sample: ${escapeHtml(fieldSelector.sampleText || "none")}</small>
        ${fieldSelector.lastUsedAt ? `<small>last used ${escapeHtml(formatDateTime(fieldSelector.lastUsedAt))}</small>` : ""}
        ${failure ? `<small class="warning">last failure: ${escapeHtml(failure.reason || "unknown")} on ${escapeHtml(failure.pageType || fieldSelector.pageType)}</small>` : ""}
        <div class="button-row">
          <button data-archive-selector-id="${escapeAttribute(fieldSelector.id)}" class="danger">Archive selector</button>
        </div>
      </div>
    `;
  }).join("");
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
      ${renderSelectorSnapshotStats(snapshot)}
    `;
    snapshotsList.append(item);
  }
}

function renderSelectorSnapshotStats(snapshot) {
  const matches = snapshot.stats?.selectorMatches || [];
  const failures = snapshot.stats?.selectorFailures || [];
  if (!matches.length && !failures.length) return "";
  return [
    matches.length ? `<small>selector matches ${escapeHtml(matches.length)}</small>` : "",
    ...failures.map((failure) => `<small class="warning">selector failed ${escapeHtml(failure.fieldKey)}: ${escapeHtml(failure.reason || "unknown")}</small>`)
  ].filter(Boolean).join("");
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
  const profileReviewedWarning = score.profileReviewed === false
    ? "<p class=\"warning\">Score used unreviewed extracted fields.</p>"
    : "";
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
    ${profileReviewedWarning}
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

function renderProposal(opportunity) {
  const draft = opportunity?.proposalDraft || null;
  const hasCurrentScore = Boolean(opportunity?.currentScoreResultId || opportunity?.scoreResult);
  generateProposalButton.disabled = !opportunity || !hasCurrentScore || Boolean(opportunity?.scoreStale);
  saveProposalButton.disabled = !draft;
  copyProposalButton.disabled = !draft || !draft.finalText;
  archiveProposalButton.disabled = !draft;

  if (!opportunity) {
    proposalBadge.className = "badge";
    proposalBadge.textContent = "No draft";
    proposalOutput.value = "";
    proposalOutput.disabled = true;
    proposalRiskPanel.className = "list empty";
    proposalRiskPanel.textContent = "No unsupported claims.";
    proposalDetailsPanel.className = "details empty";
    proposalDetailsPanel.textContent = "No proposal metadata.";
    return;
  }

  if (!draft) {
    proposalBadge.className = "badge";
    proposalBadge.textContent = hasCurrentScore ? "Ready" : "Score first";
    proposalOutput.value = "";
    proposalOutput.disabled = true;
    proposalRiskPanel.className = "list empty";
    proposalRiskPanel.textContent = opportunity.scoreStale ? "Re-score before generating a proposal." : "No unsupported claims.";
    proposalDetailsPanel.className = "details empty";
    proposalDetailsPanel.textContent = "No proposal metadata.";
    return;
  }

  proposalBadge.className = `badge${draft.status === "edited" ? " reviewed" : ""}`;
  proposalBadge.textContent = draft.status === "edited" ? "Edited" : "Generated";
  proposalOutput.disabled = false;
  proposalOutput.value = draft.finalText || "";
  renderProposalRisks(draft);
  proposalDetailsPanel.className = "details";
  proposalDetailsPanel.innerHTML = `
    <article class="dimension">
      <header><strong>Inputs</strong></header>
      <small>score ${escapeHtml(draft.inputScoreResultId || "none")}</small>
      <small>profile version ${escapeHtml(draft.inputProfileVersion ?? "none")}</small>
      <small>my profile version ${escapeHtml(draft.inputMyProfileVersion ?? "none")}</small>
      <small>portfolio cases ${(draft.selectedPortfolioCaseRefs || []).map((item) => escapeHtml(item.id)).join(", ") || "none"}</small>
    </article>
    ${renderList("Questions to ask", draft.questionsToAsk)}
    ${renderList("Assumptions", draft.assumptions)}
  `;
}

function renderProposalRisks(draft) {
  const unsupportedClaims = draft.unsupportedClaims || [];
  if (!unsupportedClaims.length) {
    proposalRiskPanel.className = "list empty";
    proposalRiskPanel.textContent = "No unsupported claims.";
    return;
  }
  proposalRiskPanel.className = "list";
  proposalRiskPanel.innerHTML = `
    <p class="warning">Unsupported claims must be reviewed before sending.</p>
    ${unsupportedClaims.map((item) => `
      <div class="conflict">
        <strong>${escapeHtml(item.claim || "Unsupported claim")}</strong>
        <small>${escapeHtml(item.reason || "No saved source supports this claim.")}</small>
      </div>
    `).join("")}
  `;
}

function renderOutcome(opportunity) {
  saveOutcomeEventButton.disabled = !opportunity;
  const events = opportunity?.outcomeEvents || [];
  const summary = opportunity?.outcomeSummary || { status: OUTCOME_STATUS.notApplied };

  if (!opportunity) {
    outcomeBadge.className = "badge";
    outcomeBadge.textContent = "Not applied";
    outcomeSummaryPanel.className = "details empty";
    outcomeSummaryPanel.textContent = "No outcome events.";
    outcomeTimeline.className = "list empty";
    outcomeTimeline.textContent = "No outcome timeline.";
    outcomeEventSelect.innerHTML = "<option value=\"\">No events</option>";
    saveOutcomeEventButton.disabled = true;
    voidOutcomeEventButton.disabled = true;
    return;
  }

  outcomeBadge.className = `badge${summary.status === OUTCOME_STATUS.hired ? " reviewed" : ""}`;
  outcomeBadge.textContent = outcomeLabel(summary.status);
  outcomeSummaryPanel.className = "details";
  outcomeSummaryPanel.innerHTML = `
    <article class="dimension">
      <header><strong>Status</strong><span>${escapeHtml(outcomeLabel(summary.status))}</span></header>
      <small>applied ${escapeHtml(formatDateTime(summary.appliedAt) || "none")}</small>
      <small>viewed ${escapeHtml(formatDateTime(summary.viewedAt) || "none")}</small>
      <small>replied ${escapeHtml(formatDateTime(summary.repliedAt) || "none")}</small>
      <small>interview ${escapeHtml(formatDateTime(summary.interviewAt) || "none")}</small>
      <small>hired ${escapeHtml(formatDateTime(summary.hiredAt) || "none")}</small>
      <small>lost ${escapeHtml(formatDateTime(summary.lostAt) || "none")}</small>
      <small>connects ${escapeHtml(summary.connectsSpent ?? "none")}</small>
      <small>bid ${escapeHtml(formatBid(summary))}</small>
    </article>
  `;

  outcomeEventSelect.innerHTML = "";
  const activeEvents = events.filter((item) => !item.voidedAt);
  if (!activeEvents.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No events";
    outcomeEventSelect.append(option);
  } else {
    for (const event of activeEvents.slice().reverse()) {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = `${eventLabel(event.eventType)} ${formatDateTime(event.occurredAt)}`;
      outcomeEventSelect.append(option);
    }
  }
  voidOutcomeEventButton.disabled = activeEvents.length === 0;

  if (!events.length) {
    outcomeTimeline.className = "list empty";
    outcomeTimeline.textContent = "No outcome timeline.";
    return;
  }
  outcomeTimeline.className = "list";
  outcomeTimeline.innerHTML = events.slice().reverse().map((event) => `
    <div class="snapshot${event.voidedAt ? " voided" : ""}">
      <strong>${escapeHtml(eventLabel(event.eventType))}${event.voidedAt ? " (voided)" : ""}</strong>
      <span>${escapeHtml(formatDateTime(event.occurredAt))}</span>
      <small>${escapeHtml(event.source)}${event.snapshotId ? ` · snapshot ${escapeHtml(event.snapshotId)}` : ""}</small>
      ${renderOutcomePayload(event)}
      ${event.notes ? `<small>${escapeHtml(event.notes)}</small>` : ""}
    </div>
  `).join("");
}

function renderOutcomePayload(event) {
  if (event.eventType === "proposal_sent") {
    return [
      event.payload?.connectsSpent !== null && event.payload?.connectsSpent !== undefined ? `<small>connects ${escapeHtml(event.payload.connectsSpent)}</small>` : "",
      event.payload?.bidAmount !== null && event.payload?.bidAmount !== undefined ? `<small>bid ${escapeHtml(event.payload.bidCurrency || "")} ${escapeHtml(event.payload.bidAmount)} ${escapeHtml(event.payload.bidType || "")}</small>` : "",
      event.payload?.proposalDraftId ? `<small>proposal ${escapeHtml(event.payload.proposalDraftId)}</small>` : ""
    ].filter(Boolean).join("");
  }
  if (event.eventType === "capture_detected_status") {
    return `<small>detected ${escapeHtml(outcomeLabel(event.payload?.detectedStatus))}</small>`;
  }
  return "";
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

function collectProfileFieldValues() {
  const values = {};
  for (const definition of PROFILE_FIELD_DEFINITIONS) {
    const input = profileFieldsPanel.querySelector(`[data-profile-field="${definition.key}"]`);
    if (!input) continue;
    values[definition.key] = definition.valueKind === "array"
      ? input.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean)
      : input.value.trim();
  }
  return values;
}

function collectOutcomeEventInput() {
  const occurredAt = outcomeOccurredAt.value
    ? new Date(outcomeOccurredAt.value).toISOString()
    : new Date().toISOString();
  const payload = {};
  if (outcomeEventType.value === "proposal_sent") {
    payload.connectsSpent = outcomeConnectsSpent.value === "" ? null : Number(outcomeConnectsSpent.value);
    payload.bidAmount = outcomeBidAmount.value === "" ? null : Number(outcomeBidAmount.value);
    payload.bidCurrency = "USD";
    payload.bidType = outcomeBidType.value || "unknown";
    payload.proposalDraftId = selectedOpportunity?.currentProposalDraftId || selectedOpportunity?.proposalDraft?.id || null;
  }
  return {
    eventType: outcomeEventType.value,
    occurredAt,
    payload,
    notes: outcomeNotes.value
  };
}

function collectClientRecordInput({ forceNewKey = false } = {}) {
  return {
    displayName: clientDisplayName.value,
    primaryClientKey: forceNewKey ? "" : clientPrimaryKey.value,
    notes: clientNotes.value,
    redFlags: clientRedFlags.value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
  };
}

function getRelevantFieldSelectors(opportunity) {
  const host = getOpportunityHost(opportunity);
  const pageType = getLatestPageType(opportunity);
  return fieldSelectors.filter((fieldSelector) => {
    if (fieldSelector.archivedAt) return false;
    if (host && fieldSelector.host !== host) return false;
    return fieldSelector.pageType === pageType;
  });
}

function getOpportunityHost(opportunity) {
  try {
    return opportunity?.mainUrl ? new URL(opportunity.mainUrl).hostname : "";
  } catch {
    return "";
  }
}

function getLatestPageType(opportunity) {
  const snapshots = opportunity?.snapshots || [];
  return snapshots[snapshots.length - 1]?.pageType || "job_detail";
}

function getVisibleOpportunities() {
  if (!selectedOutcomeFilter) return opportunities;
  return opportunities.filter((item) => (item.outcomeSummary?.status || OUTCOME_STATUS.notApplied) === selectedOutcomeFilter);
}

function formatProfileFieldValue(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function sourceLabel(source) {
  const labels = {
    ai_extracted: "AI extracted",
    user_corrected: "User corrected",
    selector: "Selector",
    manual_note: "Manual note",
    missing: "Missing"
  };
  return labels[source] || source;
}

function updateOpportunitySummary(opportunity) {
  const index = opportunities.findIndex((item) => item.id === opportunity.id);
  if (index >= 0) {
    opportunities[index] = {
      ...opportunities[index],
      ...opportunity,
      snapshots: undefined
    };
  }
}

function getSelected() {
  return selectedOpportunity || opportunities.find((item) => item.id === selectedId) || null;
}

function setBusy(isBusy) {
  captureButton.disabled = isBusy;
  scoreButton.disabled = isBusy || !selectedId;
  deleteButton.disabled = isBusy || !selectedId;
  permanentDeleteButton.disabled = isBusy || !selectedId;
  saveNotesButton.disabled = isBusy || !selectedId;
  extractProfileButton.disabled = isBusy || !selectedId;
  saveProfileButton.disabled = isBusy || !selectedOpportunity?.profile;
  clearProfileButton.disabled = isBusy || !selectedOpportunity?.profile?.reviewedAt;
  selectorFieldSelect.disabled = isBusy;
  selectorPageType.disabled = isBusy;
  pickSelectorButton.disabled = isBusy;
  extractSelectorsButton.disabled = isBusy || !fieldSelectors.length;
  generateProposalButton.disabled = isBusy || !selectedId || !selectedOpportunity?.currentScoreResultId || selectedOpportunity?.scoreStale;
  saveProposalButton.disabled = isBusy || !selectedOpportunity?.proposalDraft;
  copyProposalButton.disabled = isBusy || !selectedOpportunity?.proposalDraft?.finalText;
  archiveProposalButton.disabled = isBusy || !selectedOpportunity?.proposalDraft;
  saveOutcomeEventButton.disabled = isBusy || !selectedId;
  voidOutcomeEventButton.disabled = isBusy || !selectedOutcomeEventId();
  clientRecordSelect.disabled = isBusy;
  clientPrimaryKey.disabled = isBusy;
  clientDisplayName.disabled = isBusy;
  clientNotes.disabled = isBusy;
  clientRedFlags.disabled = isBusy;
  saveClientButton.disabled = isBusy || !selectedId;
  linkClientButton.disabled = isBusy || !selectedId || !clientRecordSelect.value;
  unlinkClientButton.disabled = isBusy || !selectedOpportunity?.clientRecordId;
  splitClientButton.disabled = isBusy || !selectedOpportunity?.clientRecordId;
  archiveClientButton.disabled = isBusy || (!clientRecordSelect.value && !selectedOpportunity?.clientRecordId);
  clientMergeSourceSelect.disabled = isBusy;
  clientMergeTargetSelect.disabled = isBusy;
  mergeClientButton.disabled = isBusy || !clientMergeSourceSelect.value || !clientMergeTargetSelect.value || clientMergeSourceSelect.value === clientMergeTargetSelect.value;
}

function setStatus(message) {
  panelStatus.textContent = message;
}

function scoreLabel(opportunity) {
  const score = opportunity.scoreResult?.total_score ?? opportunity.currentScore?.totalScore;
  return Number.isFinite(score) ? `${Math.round(score)}/100` : "Draft";
}

function selectedOutcomeEventId() {
  return outcomeEventSelect.value || "";
}

function outcomeLabel(status) {
  const labels = {
    not_applied: "Not applied",
    skipped: "Skipped",
    applied: "Applied",
    viewed: "Viewed",
    replied: "Replied",
    interviewing: "Interviewing",
    hired: "Hired",
    lost: "Lost"
  };
  return labels[status] || "Not applied";
}

function eventLabel(eventType) {
  const labels = {
    marked_not_applied: "Not applied",
    marked_skipped: "Skipped",
    proposal_sent: "Proposal sent",
    proposal_viewed: "Proposal viewed",
    client_replied: "Client replied",
    interview_started: "Interview started",
    hired: "Hired",
    lost: "Lost",
    manual_note: "Manual note",
    capture_detected_status: "Capture detected",
    correction: "Correction",
    voided: "Voided"
  };
  return labels[eventType] || eventType;
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "";
}

function formatBid(summary) {
  if (summary.bidAmount === null || summary.bidAmount === undefined) return "none";
  return `${summary.bidCurrency || "USD"} ${summary.bidAmount} ${summary.bidType || ""}`.trim();
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
