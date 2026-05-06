const analyticsStatus = document.querySelector("#analyticsStatus");
const analyticsWindow = document.querySelector("#analyticsWindow");
const analyticsScoreVersion = document.querySelector("#analyticsScoreVersion");
const analyticsPromptVersion = document.querySelector("#analyticsPromptVersion");
const analyticsSkill = document.querySelector("#analyticsSkill");
const analyticsIncludeArchived = document.querySelector("#analyticsIncludeArchived");
const refreshAnalyticsButton = document.querySelector("#refreshAnalyticsButton");
const analyticsSampleBadge = document.querySelector("#analyticsSampleBadge");
const analyticsMetrics = document.querySelector("#analyticsMetrics");
const analyticsCalibration = document.querySelector("#analyticsCalibration");
const scoreBandGroups = document.querySelector("#scoreBandGroups");
const skillGroups = document.querySelector("#skillGroups");
const clientTypeGroups = document.querySelector("#clientTypeGroups");
const templateGroups = document.querySelector("#templateGroups");

init();

async function init() {
  refreshAnalyticsButton.addEventListener("click", refreshAnalytics);
  await refreshAnalytics();
}

async function refreshAnalytics() {
  analyticsStatus.textContent = "Loading analytics...";
  refreshAnalyticsButton.disabled = true;
  try {
    const filters = collectFilters();
    const [summaryResponse, scoreBandResponse, skillResponse, clientTypeResponse, templateResponse] = await Promise.all([
      send({ type: "analytics:getSummary", filters }),
      send({ type: "analytics:getByScoreBand", filters }),
      send({ type: "analytics:getBySkill", filters }),
      send({ type: "analytics:getByClientType", filters }),
      send({ type: "analytics:getByTemplate", filters })
    ]);
    renderSummary(summaryResponse.analyticsSummary);
    renderGroupTable(scoreBandGroups, scoreBandResponse.groups);
    renderGroupTable(skillGroups, skillResponse.groups);
    renderGroupTable(clientTypeGroups, clientTypeResponse.groups);
    renderGroupTable(templateGroups, templateResponse.groups);
    analyticsStatus.textContent = `Updated from storage revision ${summaryResponse.analyticsSummary.builtFromRevision}`;
  } catch (error) {
    analyticsStatus.textContent = error.message;
  } finally {
    refreshAnalyticsButton.disabled = false;
  }
}

function collectFilters() {
  return {
    window: analyticsWindow.value,
    scoreVersion: analyticsScoreVersion.value.trim(),
    promptVersion: analyticsPromptVersion.value.trim(),
    skill: analyticsSkill.value.trim(),
    includeArchived: analyticsIncludeArchived.checked
  };
}

function renderSummary(summary) {
  const metrics = summary.metrics || {};
  analyticsSampleBadge.className = `badge${metrics.lowSample ? "" : " reviewed"}`;
  analyticsSampleBadge.textContent = metrics.lowSample ? "Low sample" : "Calibration ready";
  analyticsMetrics.innerHTML = [
    metricCard("Opportunities", metrics.totalOpportunities),
    metricCard("Applied", metrics.appliedCount),
    metricCard("Viewed rate", formatRate(metrics.viewedRate)),
    metricCard("Reply rate", formatRate(metrics.replyRate)),
    metricCard("Interview rate", formatRate(metrics.interviewRate)),
    metricCard("Hired rate", formatRate(metrics.hiredRate)),
    metricCard("Avg connects", metrics.averageConnectsSpent ?? "none"),
    metricCard("Avg score", metrics.averageScore ?? "none")
  ].join("");

  const calibration = summary.calibration || {};
  const suggestions = calibration.suggestions || [];
  analyticsCalibration.className = suggestions.length ? "details" : "details empty";
  analyticsCalibration.innerHTML = suggestions.length
    ? renderList("Calibration suggestions", suggestions)
    : escapeHtml(calibration.message || "No calibration signal.");
}

function renderGroupTable(container, groups = []) {
  if (!groups.length) {
    container.className = "analytics-table empty";
    container.textContent = "No data.";
    return;
  }
  container.className = "analytics-table";
  container.innerHTML = `
    <div class="analytics-row analytics-head">
      <strong>Group</strong>
      <strong>Total</strong>
      <strong>Applied</strong>
      <strong>Reply</strong>
      <strong>Hired</strong>
      <strong>Avg score</strong>
    </div>
    ${groups.map((group) => `
      <div class="analytics-row">
        <span>${escapeHtml(group.label || group.key)}</span>
        <span>${escapeHtml(group.metrics.totalOpportunities)}</span>
        <span>${escapeHtml(group.metrics.appliedCount)}</span>
        <span>${escapeHtml(formatRate(group.metrics.replyRate))}</span>
        <span>${escapeHtml(formatRate(group.metrics.hiredRate))}</span>
        <span>${escapeHtml(group.metrics.averageScore ?? "none")}</span>
      </div>
    `).join("")}
  `;
}

function metricCard(label, value) {
  return `
    <div class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderList(title, values) {
  return `
    <article class="dimension">
      <header><strong>${escapeHtml(title)}</strong></header>
      <ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>
  `;
}

function formatRate(value) {
  return value === null || value === undefined ? "none" : `${Math.round(value * 100)}%`;
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
