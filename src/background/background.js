import {
  DEFAULT_SETTINGS,
  OPPORTUNITY_STATUS,
  PLATFORM_HOSTS,
  PROMPT_VERSIONS,
  SCHEMA_VERSION,
  SNAPSHOT_RETENTION_STATE,
  STORAGE_KEYS
} from "../shared/schema.js";

const MAX_SNAPSHOT_CHARS = 70000;
const MAX_SCORE_INPUT_CHARS = 110000;
const BACKUP_PREFIX = "uosc_backup_v0_to_v1_";
const SCORE_DECISIONS = ["strong_apply", "targeted_apply", "only_if_strong_fit", "skip"];

let migrationPromise = null;
let storageWriteQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
  protectStorageAccess();
});

protectStorageAccess();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
  return true;
});

async function handleMessage(message) {
  await ensureMigrated();

  switch (message?.type) {
    case "settings:get":
      return { ok: true, settings: await getSettings() };
    case "settings:save":
      return { ok: true, settings: await saveSettings(message.settings || {}) };
    case "data:getStorageUsage":
      return { ok: true, usage: await getStorageUsage() };
    case "data:createBackup":
      return { ok: true, backupKey: await createBackup() };
    case "data:export":
      return { ok: true, exportData: await exportData() };
    case "data:importPreview":
      return { ok: true, preview: validateImportData(message.data) };
    case "data:importCommit":
      return { ok: true, result: await importData(message.data) };
    case "opportunities:list":
    case "opportunities:listSummary":
      return { ok: true, opportunities: await listOpportunitySummaries() };
    case "opportunities:get":
      return { ok: true, opportunity: await getOpportunityDetail(message.id) };
    case "opportunities:delete":
    case "opportunities:archive":
      await archiveOpportunity(message.id);
      return { ok: true };
    case "opportunities:restore":
      return { ok: true, opportunity: await restoreOpportunity(message.id) };
    case "opportunities:deletePermanent":
      await deleteOpportunityPermanent(message.id);
      return { ok: true };
    case "opportunities:updateNotes":
    case "notes:update":
      return { ok: true, opportunity: await updateOpportunityNotes(message.id || message.opportunityId, message.notes || "") };
    case "capture:currentPage":
      return captureCurrentPage(message.opportunityId || null);
    case "score:opportunity":
    case "scores:create":
      return { ok: true, opportunity: await scoreOpportunity(message.opportunityId) };
    default:
      throw new Error(`Unknown message type: ${message?.type || "empty"}`);
  }
}

async function protectStorageAccess() {
  try {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    // Older Chromium builds may not support this API. Export still strips apiKey.
  }
}

async function ensureMigrated() {
  if (!migrationPromise) migrationPromise = migrateToSchemaV1();
  return migrationPromise;
}

async function migrateToSchemaV1() {
  const keys = Object.values(STORAGE_KEYS);
  const data = await chrome.storage.local.get(keys);
  const meta = data[STORAGE_KEYS.meta];
  if (meta?.schemaVersion === SCHEMA_VERSION) return meta;

  const oldOpportunities = Array.isArray(data[STORAGE_KEYS.opportunities]) ? data[STORAGE_KEYS.opportunities] : [];
  const oldHasEmbeddedData = oldOpportunities.some((item) => Array.isArray(item.snapshots) || item.scoreResult || item.extractedProfile || Object.prototype.hasOwnProperty.call(item, "notes"));
  let migrationBackupKey = null;

  if (oldHasEmbeddedData || oldOpportunities.length) {
    migrationBackupKey = await createBackup();
  }

  const migrated = oldHasEmbeddedData
    ? await migrateLegacyOpportunities(oldOpportunities, data)
    : normalizeExistingCanonicalData(data);

  const now = new Date().toISOString();
  const nextMeta = {
    schemaVersion: SCHEMA_VERSION,
    storageRevision: Number(meta?.storageRevision || 0) + 1,
    migratedAt: now,
    lastMigrationAt: now,
    lastBackupAt: migrationBackupKey ? now : meta?.lastBackupAt || null,
    lastBackupKey: migrationBackupKey || meta?.lastBackupKey || null
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.meta]: nextMeta,
    [STORAGE_KEYS.settings]: normalizeSettings(data[STORAGE_KEYS.settings]),
    [STORAGE_KEYS.opportunities]: migrated.opportunities,
    [STORAGE_KEYS.snapshots]: migrated.snapshots,
    [STORAGE_KEYS.opportunityProfiles]: migrated.opportunityProfiles,
    [STORAGE_KEYS.scoreResults]: migrated.scoreResults,
    [STORAGE_KEYS.noteRevisions]: migrated.noteRevisions,
    [STORAGE_KEYS.myProfile]: data[STORAGE_KEYS.myProfile] || null,
    [STORAGE_KEYS.portfolioCases]: data[STORAGE_KEYS.portfolioCases] || [],
    [STORAGE_KEYS.proposalDrafts]: data[STORAGE_KEYS.proposalDrafts] || [],
    [STORAGE_KEYS.outcomeEvents]: data[STORAGE_KEYS.outcomeEvents] || [],
    [STORAGE_KEYS.clientRecords]: data[STORAGE_KEYS.clientRecords] || [],
    [STORAGE_KEYS.fieldSelectors]: data[STORAGE_KEYS.fieldSelectors] || []
  });

  return nextMeta;
}

async function migrateLegacyOpportunities(oldOpportunities, data) {
  const now = new Date().toISOString();
  const opportunities = [];
  const snapshots = [];
  const opportunityProfiles = [];
  const scoreResults = [];
  const noteRevisions = [];

  for (const oldOpportunity of oldOpportunities) {
    const opportunityId = oldOpportunity.id || crypto.randomUUID();
    const createdAt = oldOpportunity.createdAt || now;
    const updatedAt = oldOpportunity.updatedAt || createdAt;
    const snapshotIds = [];
    const noteRevisionId = oldOpportunity.notes ? crypto.randomUUID() : null;

    for (const oldSnapshot of oldOpportunity.snapshots || []) {
      const snapshotId = oldSnapshot.id || crypto.randomUUID();
      snapshotIds.push(snapshotId);
      snapshots.push({
        id: snapshotId,
        opportunityId,
        schemaVersion: SCHEMA_VERSION,
        createdAt: oldSnapshot.createdAt || oldSnapshot.capturedAt || createdAt,
        capturedAt: oldSnapshot.capturedAt || oldSnapshot.createdAt || createdAt,
        sourceUrl: oldSnapshot.sourceUrl || oldOpportunity.mainUrl || "",
        pageTitle: oldSnapshot.pageTitle || oldSnapshot.title || "Untitled",
        pageType: oldSnapshot.pageType || "unknown",
        platform: inferPlatform(oldSnapshot.sourceUrl || oldOpportunity.mainUrl || ""),
        text: oldSnapshot.text || "",
        textHash: await hashText(oldSnapshot.text || ""),
        domSummary: oldSnapshot.domSummary || [],
        stats: oldSnapshot.stats || {},
        retentionState: SNAPSHOT_RETENTION_STATE.full
      });
    }

    let currentProfileId = null;
    if (oldOpportunity.extractedProfile) {
      currentProfileId = crypto.randomUUID();
      opportunityProfiles.push(createProfileRecord({
        id: currentProfileId,
        opportunityId,
        rawProfile: oldOpportunity.extractedProfile,
        model: null,
        inputSnapshotIds: snapshotIds,
        version: 1,
        createdAt: updatedAt
      }));
    }

    let currentScoreResultId = null;
    if (oldOpportunity.scoreResult) {
      currentScoreResultId = crypto.randomUUID();
      scoreResults.push(createScoreRecord({
        id: currentScoreResultId,
        opportunityId,
        rawScore: oldOpportunity.scoreResult,
        model: null,
        inputSnapshotIds: snapshotIds,
        inputProfileId: currentProfileId,
        inputProfileVersion: currentProfileId ? 1 : null,
        notesRevisionId: noteRevisionId,
        profileReviewed: false,
        createdAt: updatedAt
      }));
    }

    if (noteRevisionId) {
      noteRevisions.push({
        id: noteRevisionId,
        opportunityId,
        schemaVersion: SCHEMA_VERSION,
        text: String(oldOpportunity.notes || ""),
        createdAt: updatedAt,
        createdBy: "user"
      });
    }

    opportunities.push({
      id: opportunityId,
      schemaVersion: SCHEMA_VERSION,
      createdAt,
      updatedAt,
      title: oldOpportunity.title || normalizeTitle(snapshots.find((item) => item.opportunityId === opportunityId)?.pageTitle),
      mainUrl: oldOpportunity.mainUrl || snapshots.find((item) => item.opportunityId === opportunityId)?.sourceUrl || "",
      jobKey: oldOpportunity.jobKey || extractUpworkJobKey(oldOpportunity.mainUrl || ""),
      platform: inferPlatform(oldOpportunity.mainUrl || ""),
      status: deriveMigratedStatus(oldOpportunity, snapshotIds),
      clientRecordId: oldOpportunity.clientRecordId || null,
      snapshotIds,
      currentProfileId,
      currentScoreResultId,
      currentProposalDraftId: oldOpportunity.currentProposalDraftId || null,
      currentNotesRevisionId: noteRevisionId,
      archivedAt: oldOpportunity.archivedAt || null
    });
  }

  return {
    opportunities,
    snapshots,
    opportunityProfiles,
    scoreResults,
    noteRevisions
  };
}

function normalizeExistingCanonicalData(data) {
  const opportunities = (data[STORAGE_KEYS.opportunities] || []).map((item) => ({
    id: item.id || crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    title: item.title || "Untitled opportunity",
    mainUrl: item.mainUrl || "",
    jobKey: item.jobKey || extractUpworkJobKey(item.mainUrl || ""),
    platform: item.platform || inferPlatform(item.mainUrl || ""),
    status: normalizeOpportunityStatus(item.status),
    clientRecordId: item.clientRecordId || null,
    snapshotIds: item.snapshotIds || [],
    currentProfileId: item.currentProfileId || null,
    currentScoreResultId: item.currentScoreResultId || null,
    currentProposalDraftId: item.currentProposalDraftId || null,
    currentNotesRevisionId: item.currentNotesRevisionId || null,
    archivedAt: item.archivedAt || null
  }));

  return {
    opportunities,
    snapshots: data[STORAGE_KEYS.snapshots] || [],
    opportunityProfiles: data[STORAGE_KEYS.opportunityProfiles] || [],
    scoreResults: data[STORAGE_KEYS.scoreResults] || [],
    noteRevisions: data[STORAGE_KEYS.noteRevisions] || []
  };
}

async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(result[STORAGE_KEYS.settings]);
}

async function saveSettings(partialSettings) {
  return withStorageLock(async () => {
    const settings = normalizeSettings({
      ...(await getSettings()),
      ...partialSettings
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
    await bumpStorageRevision();
    return settings;
  });
}

function normalizeSettings(rawSettings = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(rawSettings || {})
  };
  settings.schemaVersion = SCHEMA_VERSION;
  settings.updatedAt = new Date().toISOString();
  settings.apiKey = String(settings.apiKey || "").trim();
  settings.extractModel = String(settings.extractModel || DEFAULT_SETTINGS.extractModel).trim();
  settings.scoreModel = String(settings.scoreModel || DEFAULT_SETTINGS.scoreModel).trim();
  settings.proposalModel = String(settings.proposalModel || DEFAULT_SETTINGS.proposalModel).trim();
  settings.language = String(settings.language || DEFAULT_SETTINGS.language).trim();
  settings.reasoningEffort = String(settings.reasoningEffort || DEFAULT_SETTINGS.reasoningEffort).trim();
  settings.captureMode = settings.captureMode === "allowed_hosts" ? "allowed_hosts" : "strict_upwork";
  settings.allowedHosts = Array.isArray(settings.allowedHosts) ? settings.allowedHosts.map((host) => String(host).trim()).filter(Boolean) : [];
  settings.exportPreferences = {
    ...DEFAULT_SETTINGS.exportPreferences,
    ...(settings.exportPreferences || {})
  };
  return settings;
}

async function getStorageUsage() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  return {
    bytesInUse,
    quotaBytes: chrome.storage.local.QUOTA_BYTES || null
  };
}

async function listOpportunitySummaries({ includeArchived = false } = {}) {
  const store = await readStore();
  const summaries = store.opportunities
    .filter((opportunity) => includeArchived || opportunity.status !== OPPORTUNITY_STATUS.archived)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((opportunity) => {
      const score = store.scoreResults.find((item) => item.id === opportunity.currentScoreResultId) || null;
      return {
        id: opportunity.id,
        schemaVersion: opportunity.schemaVersion,
        title: opportunity.title,
        mainUrl: opportunity.mainUrl,
        jobKey: opportunity.jobKey,
        platform: opportunity.platform,
        status: opportunity.status,
        updatedAt: opportunity.updatedAt,
        archivedAt: opportunity.archivedAt,
        snapshotCount: opportunity.snapshotIds.length,
        currentScore: score ? {
          id: score.id,
          totalScore: score.totalScore,
          decision: score.decision,
          decisionSummary: score.decisionSummary
        } : null,
        scoreResult: score ? toLegacyScoreResult(score) : null
      };
    });
  return summaries;
}

async function getOpportunityDetail(id) {
  if (!id) return null;
  const store = await readStore();
  const opportunity = store.opportunities.find((item) => item.id === id);
  if (!opportunity) return null;
  return hydrateOpportunity(opportunity, store);
}

async function archiveOpportunity(id) {
  if (!id) throw new Error("Opportunity id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Opportunity not found");
    store.opportunities[index] = {
      ...store.opportunities[index],
      status: OPPORTUNITY_STATUS.archived,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await writeStore(store);
  });
}

async function restoreOpportunity(id) {
  if (!id) throw new Error("Opportunity id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    store.opportunities[index] = {
      ...opportunity,
      status: opportunity.currentScoreResultId ? OPPORTUNITY_STATUS.scored : OPPORTUNITY_STATUS.captured,
      archivedAt: null,
      updatedAt: new Date().toISOString()
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

async function deleteOpportunityPermanent(id) {
  if (!id) throw new Error("Opportunity id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const exists = store.opportunities.some((item) => item.id === id);
    if (!exists) throw new Error("Opportunity not found");
    store.opportunities = store.opportunities.filter((item) => item.id !== id);
    store.snapshots = store.snapshots.filter((item) => item.opportunityId !== id);
    store.opportunityProfiles = store.opportunityProfiles.filter((item) => item.opportunityId !== id);
    store.scoreResults = store.scoreResults.filter((item) => item.opportunityId !== id);
    store.noteRevisions = store.noteRevisions.filter((item) => item.opportunityId !== id);
    await writeStore(store);
  });
}

async function updateOpportunityNotes(id, notes) {
  if (!id) throw new Error("Opportunity id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Opportunity not found");
    const revision = {
      id: crypto.randomUUID(),
      opportunityId: id,
      schemaVersion: SCHEMA_VERSION,
      text: String(notes || ""),
      createdAt: new Date().toISOString(),
      createdBy: "user"
    };
    store.noteRevisions.push(revision);
    store.opportunities[index] = {
      ...store.opportunities[index],
      currentNotesRevisionId: revision.id,
      updatedAt: revision.createdAt
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

async function captureCurrentPage(opportunityId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  const tabUrl = parseUrl(tab.url);
  if (!tabUrl || tabUrl.protocol !== "https:" || tabUrl.hostname !== PLATFORM_HOSTS.upwork) {
    throw new Error("Capture is limited to https://www.upwork.com pages");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: captureVisibleDom,
    args: [MAX_SNAPSHOT_CHARS]
  });

  if (!result?.text) throw new Error("No readable page text found");
  const sourceUrl = result.url || tab.url;
  const sourceParsed = parseUrl(sourceUrl);
  if (!sourceParsed || sourceParsed.protocol !== "https:" || sourceParsed.hostname !== PLATFORM_HOSTS.upwork) {
    throw new Error("Capture is limited to https://www.upwork.com pages");
  }

  return withStorageLock(async () => {
    const capturedAt = new Date().toISOString();
    const jobKey = extractUpworkJobKey(sourceUrl);
    const store = await readStore();
    let opportunity = opportunityId ? store.opportunities.find((item) => item.id === opportunityId) : null;

    if (opportunity && opportunity.status === OPPORTUNITY_STATUS.archived) {
      throw new Error("Archived opportunities cannot receive new snapshots");
    }
    if (opportunity && opportunity.jobKey && jobKey && opportunity.jobKey !== jobKey) {
      throw new Error("Current page belongs to a different Upwork job. Create a new opportunity instead.");
    }
    if (!opportunity && jobKey) {
      opportunity = store.opportunities.find((item) => item.jobKey === jobKey && item.status !== OPPORTUNITY_STATUS.archived) || null;
    }

    const snapshot = {
      id: crypto.randomUUID(),
      opportunityId: opportunity?.id || crypto.randomUUID(),
      schemaVersion: SCHEMA_VERSION,
      createdAt: capturedAt,
      capturedAt,
      sourceUrl,
      pageTitle: result.title || tab.title || "Untitled",
      pageType: inferPageType(sourceUrl, result.text),
      platform: "upwork",
      text: result.text,
      textHash: await hashText(result.text),
      domSummary: result.domSummary || [],
      stats: result.stats || {},
      retentionState: SNAPSHOT_RETENTION_STATE.full
    };

    if (!opportunity) {
      opportunity = {
        id: snapshot.opportunityId,
        schemaVersion: SCHEMA_VERSION,
        createdAt: capturedAt,
        updatedAt: capturedAt,
        title: normalizeTitle(snapshot.pageTitle),
        mainUrl: sourceUrl,
        jobKey,
        platform: "upwork",
        status: OPPORTUNITY_STATUS.captured,
        clientRecordId: null,
        snapshotIds: [],
        currentProfileId: null,
        currentScoreResultId: null,
        currentProposalDraftId: null,
        currentNotesRevisionId: null,
        archivedAt: null
      };
      store.opportunities.push(opportunity);
    } else {
      snapshot.opportunityId = opportunity.id;
      opportunity.jobKey = opportunity.jobKey || jobKey;
      opportunity.mainUrl = opportunity.mainUrl || sourceUrl;
      opportunity.platform = "upwork";
      if (opportunity.status === OPPORTUNITY_STATUS.draft) opportunity.status = OPPORTUNITY_STATUS.captured;
    }

    opportunity.snapshotIds.push(snapshot.id);
    opportunity.updatedAt = capturedAt;
    store.snapshots.push(snapshot);
    await writeStore(store);

    return { ok: true, opportunity: hydrateOpportunity(opportunity, store), snapshot: toLegacySnapshot(snapshot) };
  });
}

function captureVisibleDom(maxChars) {
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "IMG", "VIDEO", "CANVAS", "IFRAME"]);
  const domSummary = [];
  let visitedNodes = 0;
  let hiddenNodes = 0;

  function isVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (rect.width === 0 && rect.height === 0 && element.getClientRects().length === 0) return false;
    return true;
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const root = document.body || document.documentElement;
  const text = cleanText(root.innerText || root.textContent || "");
  const summaryNodes = root.querySelectorAll("h1,h2,h3,h4,button,a,[data-test],[data-qa],[aria-label]");
  for (const node of summaryNodes) {
    visitedNodes += 1;
    if (skipTags.has(node.tagName) || !isVisible(node)) {
      hiddenNodes += 1;
      continue;
    }
    const value = cleanText(node.innerText || node.getAttribute("aria-label") || node.getAttribute("data-test") || node.getAttribute("data-qa"));
    if (!value) continue;
    const previous = domSummary[domSummary.length - 1];
    if (previous?.text === value) continue;
    domSummary.push({
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute("role") || null,
      dataTest: node.getAttribute("data-test") || node.getAttribute("data-qa") || null,
      text: value.slice(0, 240)
    });
    if (domSummary.length >= 240) break;
  }

  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, maxChars),
    domSummary,
    stats: {
      charCount: text.length,
      capturedCharCount: Math.min(text.length, maxChars),
      visitedNodes,
      hiddenNodes
    }
  };
}

async function scoreOpportunity(opportunityId) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("OpenAI API key is missing. Set it in Options first.");

  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    const detail = hydrateOpportunity(opportunity, store);
    if (!detail.snapshots.length) throw new Error("No snapshots captured for this opportunity");

    const rawProfile = await extractOpportunityProfile(detail, settings);
    const profileVersion = store.opportunityProfiles.filter((item) => item.opportunityId === opportunityId).length + 1;
    const profileRecord = createProfileRecord({
      id: crypto.randomUUID(),
      opportunityId,
      rawProfile,
      model: settings.extractModel,
      inputSnapshotIds: opportunity.snapshotIds,
      version: profileVersion,
      createdAt: new Date().toISOString()
    });

    const rawScore = await scoreOpportunityProfile(detail, rawProfile, settings);
    const scoreRecord = createScoreRecord({
      id: crypto.randomUUID(),
      opportunityId,
      rawScore,
      model: settings.scoreModel,
      inputSnapshotIds: opportunity.snapshotIds,
      inputProfileId: profileRecord.id,
      inputProfileVersion: profileRecord.version,
      notesRevisionId: opportunity.currentNotesRevisionId,
      profileReviewed: false,
      createdAt: new Date().toISOString()
    });

    store.opportunityProfiles.push(profileRecord);
    store.scoreResults.push(scoreRecord);
    store.opportunities[index] = {
      ...opportunity,
      status: OPPORTUNITY_STATUS.scored,
      currentProfileId: profileRecord.id,
      currentScoreResultId: scoreRecord.id,
      updatedAt: scoreRecord.createdAt
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

async function extractOpportunityProfile(opportunity, settings) {
  const input = buildSnapshotCorpus(opportunity, MAX_SCORE_INPUT_CHARS);
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: ["string", "null"] },
      job_description_summary: { type: ["string", "null"] },
      required_skills: { type: "array", items: { type: "string" } },
      budget: { type: ["string", "null"] },
      hourly_or_fixed: { type: ["string", "null"] },
      proposal_count: { type: ["string", "null"] },
      connects_cost: { type: ["string", "null"] },
      posted_time: { type: ["string", "null"] },
      interviews: { type: ["string", "null"] },
      invites_sent: { type: ["string", "null"] },
      hires: { type: ["string", "null"] },
      client_payment_verified: { type: ["string", "null"] },
      client_rating: { type: ["string", "null"] },
      client_total_spend: { type: ["string", "null"] },
      client_hire_rate: { type: ["string", "null"] },
      client_avg_hourly_paid: { type: ["string", "null"] },
      client_type: { type: ["string", "null"] },
      test_task: { type: ["string", "null"] },
      long_term_signal: { type: ["string", "null"] },
      raw_evidence: { type: "array", items: { type: "string" } },
      missing_fields: { type: "array", items: { type: "string" } }
    },
    required: [
      "title",
      "job_description_summary",
      "required_skills",
      "budget",
      "hourly_or_fixed",
      "proposal_count",
      "connects_cost",
      "posted_time",
      "interviews",
      "invites_sent",
      "hires",
      "client_payment_verified",
      "client_rating",
      "client_total_spend",
      "client_hire_rate",
      "client_avg_hourly_paid",
      "client_type",
      "test_task",
      "long_term_signal",
      "raw_evidence",
      "missing_fields"
    ]
  };

  const prompt = [
    "Extract structured facts from manually captured Upwork page text.",
    "Rules:",
    "- Use only the supplied snapshots.",
    "- Do not infer facts that are not present.",
    "- Put unknown values as null and list them in missing_fields.",
    "- raw_evidence must contain short copied/paraphrased evidence snippets from the snapshots.",
    "- Output valid JSON only.",
    "",
    input
  ].join("\n");

  return callOpenAIJson({
    apiKey: settings.apiKey,
    model: settings.extractModel,
    prompt,
    schemaName: "upwork_opportunity_profile",
    schema
  });
}

async function scoreOpportunityProfile(opportunity, profile, settings) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      total_score: { type: "number" },
      decision: { type: "string", enum: SCORE_DECISIONS },
      decision_summary: { type: "string" },
      timing_priority: { type: "string" },
      dimensions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string" },
            name_zh: { type: "string" },
            name_en: { type: "string" },
            score: { type: "number" },
            max_score: { type: "number" },
            confidence: { type: "number" },
            evidence: { type: "array", items: { type: "string" } },
            missing_fields: { type: "array", items: { type: "string" } },
            reasoning: { type: "string" }
          },
          required: ["key", "name_zh", "name_en", "score", "max_score", "confidence", "evidence", "missing_fields", "reasoning"]
        }
      },
      hard_red_flags: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      missing_info_checklist: { type: "array", items: { type: "string" } },
      recommended_bid_strategy: { type: "string" },
      proposal_angle: { type: "string" },
      confidence: { type: "number" }
    },
    required: [
      "total_score",
      "decision",
      "decision_summary",
      "timing_priority",
      "dimensions",
      "hard_red_flags",
      "risks",
      "missing_info_checklist",
      "recommended_bid_strategy",
      "proposal_angle",
      "confidence"
    ]
  };

  const prompt = [
    "Score this Upwork opportunity using the exact 100-point sheet below.",
    "Use only the extracted profile and snapshot evidence. Do not invent missing facts.",
    "If evidence is weak, lower confidence and list missing fields. Scores may still be estimated from available evidence, but the reasoning must identify the assumption.",
    "Language: Chinese, with concise English labels where useful.",
    "",
    "Scoring dimensions:",
    "1. 竞争强度 / Competition intensity: 10",
    "2. 技术门槛与真实匹配度 / Technical barrier and real fit: 15",
    "3. 需求清晰度 / Requirement clarity: 10",
    "4. 范围可控性 / Scope controllability: 10",
    "5. 客户靠谱度 / Client reliability: 10",
    "6. 预算真实性 / Budget realism: 15",
    "7. 客户类型成熟度 / Client type maturity: 5",
    "8. 测试任务健康度 / Test task health: 5",
    "9. 长期价值 / Long-term value: 10",
    "10. 案例与战略价值 / Portfolio and strategic value: 10",
    "",
    "Decision bands:",
    "80+: strong_apply. 65-79: targeted_apply. 50-64: only_if_strong_fit. <50: skip.",
    "Hard downgrade rules: budget realism <=5 and client reliability <=5; test task health <=1; scope controllability <=4; competition <=4 with old posting and advanced client activity.",
    "",
    `Opportunity title: ${opportunity.title}`,
    `User notes: ${opportunity.notes || ""}`,
    "Extracted profile JSON:",
    JSON.stringify(profile, null, 2),
    "",
    "Snapshot corpus:",
    buildSnapshotCorpus(opportunity, 45000)
  ].join("\n");

  const result = await callOpenAIJson({
    apiKey: settings.apiKey,
    model: settings.scoreModel,
    reasoningEffort: settings.reasoningEffort || "low",
    prompt,
    schemaName: "upwork_opportunity_score",
    schema
  });

  result.total_score = clampNumber(result.total_score, 0, 100);
  result.dimensions = normalizeDimensions(result.dimensions || []);
  return result;
}

function createProfileRecord({ id, opportunityId, rawProfile, model, inputSnapshotIds, version, createdAt }) {
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    version,
    createdAt,
    updatedAt: createdAt,
    model,
    promptVersion: PROMPT_VERSIONS.extractPromptVersion,
    scoreVersion: "not_applicable",
    inputSnapshotIds,
    fields: mapRawProfileFields(rawProfile),
    missingFieldKeys: rawProfile?.missing_fields || [],
    conflicts: [],
    reviewedAt: null,
    reviewedBy: null,
    rawProfile
  };
}

function createScoreRecord({ id, opportunityId, rawScore, model, inputSnapshotIds, inputProfileId, inputProfileVersion, notesRevisionId, profileReviewed, createdAt }) {
  const normalized = normalizeRawScore(rawScore);
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    model,
    promptVersion: PROMPT_VERSIONS.scorePromptVersion,
    scoreVersion: PROMPT_VERSIONS.scoreRuleVersion,
    inputSnapshotIds,
    inputProfileId,
    inputProfileVersion,
    notesRevisionId,
    profileReviewed,
    totalScore: normalized.total_score,
    decision: normalized.decision,
    decisionSummary: normalized.decision_summary,
    timingPriority: normalized.timing_priority,
    dimensions: normalized.dimensions,
    hardRedFlags: normalized.hard_red_flags,
    risks: normalized.risks,
    missingInfoChecklist: normalized.missing_info_checklist,
    recommendedBidStrategy: normalized.recommended_bid_strategy,
    proposalAngle: normalized.proposal_angle,
    confidence: normalized.confidence,
    archivedAt: null,
    rawResult: normalized
  };
}

function mapRawProfileFields(rawProfile = {}) {
  const fieldMap = {
    title: "jobTitle",
    job_description_summary: "descriptionSummary",
    required_skills: "requiredSkills",
    budget: "budgetText",
    hourly_or_fixed: "pricingType",
    proposal_count: "proposalCountText",
    connects_cost: "connectsCostText",
    posted_time: "postedTimeText",
    interviews: "interviewsText",
    invites_sent: "invitesSentText",
    hires: "hiresText",
    client_payment_verified: "clientPaymentVerifiedText",
    client_rating: "clientRatingText",
    client_total_spend: "clientTotalSpendText",
    client_hire_rate: "clientHireRateText",
    client_avg_hourly_paid: "clientAvgHourlyPaidText",
    client_type: "clientType",
    test_task: "testTaskSignal",
    long_term_signal: "longTermSignal"
  };
  const fields = {};
  for (const [rawKey, fieldKey] of Object.entries(fieldMap)) {
    const value = rawProfile?.[rawKey] ?? null;
    if (value === null || value === undefined || value === "") continue;
    fields[fieldKey] = {
      value,
      valueKind: Array.isArray(value) ? "array" : "text",
      effectiveSource: "ai_extracted",
      sources: [{
        source: "ai_extracted",
        value,
        confidence: null,
        evidenceRefs: [],
        snapshotId: null,
        selectorId: null,
        createdAt: new Date().toISOString()
      }],
      confidence: null,
      evidenceRefs: [],
      correctedAt: null,
      correctedBy: null
    };
  }
  return fields;
}

function normalizeRawScore(rawScore = {}) {
  return {
    total_score: clampNumber(rawScore.total_score, 0, 100),
    decision: SCORE_DECISIONS.includes(rawScore.decision) ? rawScore.decision : "skip",
    decision_summary: String(rawScore.decision_summary || ""),
    timing_priority: String(rawScore.timing_priority || ""),
    dimensions: normalizeDimensions(rawScore.dimensions || []),
    hard_red_flags: Array.isArray(rawScore.hard_red_flags) ? rawScore.hard_red_flags : [],
    risks: Array.isArray(rawScore.risks) ? rawScore.risks : [],
    missing_info_checklist: Array.isArray(rawScore.missing_info_checklist) ? rawScore.missing_info_checklist : [],
    recommended_bid_strategy: String(rawScore.recommended_bid_strategy || ""),
    proposal_angle: String(rawScore.proposal_angle || ""),
    confidence: clampNumber(rawScore.confidence, 0, 1)
  };
}

function hydrateOpportunity(opportunity, store) {
  const snapshots = opportunity.snapshotIds
    .map((id) => store.snapshots.find((item) => item.id === id))
    .filter(Boolean)
    .map(toLegacySnapshot);
  const score = store.scoreResults.find((item) => item.id === opportunity.currentScoreResultId) || null;
  const profile = store.opportunityProfiles.find((item) => item.id === opportunity.currentProfileId) || null;
  const notes = getCurrentNotesText(opportunity, store.noteRevisions);

  return {
    ...opportunity,
    snapshots,
    notes,
    extractedProfile: profile?.rawProfile || null,
    scoreResult: score ? toLegacyScoreResult(score) : null,
    snapshotCount: snapshots.length,
    currentScore: score ? {
      id: score.id,
      totalScore: score.totalScore,
      decision: score.decision,
      decisionSummary: score.decisionSummary
    } : null
  };
}

function getCurrentNotesText(opportunity, noteRevisions) {
  const current = noteRevisions.find((item) => item.id === opportunity.currentNotesRevisionId);
  return current?.text || "";
}

function toLegacySnapshot(snapshot) {
  return {
    ...snapshot,
    title: snapshot.pageTitle
  };
}

function toLegacyScoreResult(score) {
  return {
    ...(score.rawResult || {}),
    id: score.id,
    model: score.model,
    promptVersion: score.promptVersion,
    scoreVersion: score.scoreVersion,
    inputSnapshotIds: score.inputSnapshotIds,
    inputProfileVersion: score.inputProfileVersion,
    profileReviewed: score.profileReviewed,
    total_score: score.totalScore,
    decision: score.decision,
    decision_summary: score.decisionSummary,
    timing_priority: score.timingPriority,
    dimensions: score.rawResult?.dimensions || score.dimensions || [],
    hard_red_flags: score.hardRedFlags || [],
    risks: score.risks || [],
    missing_info_checklist: score.missingInfoChecklist || [],
    recommended_bid_strategy: score.recommendedBidStrategy || "",
    proposal_angle: score.proposalAngle || "",
    confidence: score.confidence
  };
}

function buildSnapshotCorpus(opportunity, maxChars) {
  const chunks = [];
  for (const [index, snapshot] of (opportunity.snapshots || []).entries()) {
    chunks.push([
      `--- Snapshot ${index + 1} ---`,
      `Captured at: ${snapshot.capturedAt}`,
      `URL: ${snapshot.sourceUrl}`,
      `Page type: ${snapshot.pageType}`,
      `Title: ${snapshot.pageTitle || snapshot.title}`,
      "Visible DOM text:",
      snapshot.text
    ].join("\n"));
  }
  return chunks.join("\n\n").slice(0, maxChars);
}

async function callOpenAIJson({ apiKey, model, reasoningEffort, prompt, schemaName, schema }) {
  const body = {
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        schema,
        strict: true
      },
      verbosity: "low"
    },
    max_output_tokens: 6000
  };

  if (reasoningEffort && reasoningEffort !== "none") {
    body.reasoning = { effort: reasoningEffort };
  } else if (reasoningEffort === "none") {
    body.reasoning = { effort: "none" };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const text = extractResponseText(payload);
  if (!text) throw new Error("OpenAI response did not include text output");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`OpenAI returned invalid JSON: ${error.message}`);
  }
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) parts.push(content.text);
      if (content?.type === "text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function normalizeDimensions(dimensions) {
  return dimensions.map((dimension) => ({
    ...dimension,
    score: clampNumber(dimension.score, 0, dimension.max_score || dimension.maxScore || 100),
    confidence: clampNumber(dimension.confidence, 0, 1)
  }));
}

function inferPageType(url, text) {
  const lowered = `${url}\n${text}`.toLowerCase();
  if (lowered.includes("/jobs/") || lowered.includes("proposals") || lowered.includes("connects")) return "job_detail";
  if (lowered.includes("client") && lowered.includes("spent")) return "client_profile";
  if (lowered.includes("work history") || lowered.includes("hire rate")) return "client_history";
  if (lowered.includes("search") || lowered.includes("jobs you might like")) return "search_result";
  return "unknown";
}

function normalizeTitle(title) {
  return String(title || "Untitled opportunity")
    .replace(/\s+-\s+Upwork.*$/i, "")
    .trim()
    .slice(0, 160);
}

function extractUpworkJobKey(url) {
  const parsed = parseUrl(url);
  if (!parsed || parsed.hostname !== PLATFORM_HOSTS.upwork) return null;
  const match = parsed.pathname.match(/\/jobs\/(?:details\/)?([^/?#]+)/i);
  return match?.[1] || null;
}

function inferPlatform(url) {
  const parsed = parseUrl(url);
  return parsed?.hostname === PLATFORM_HOSTS.upwork ? "upwork" : "unknown";
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function deriveMigratedStatus(oldOpportunity, snapshotIds) {
  if (oldOpportunity.status === OPPORTUNITY_STATUS.archived) return OPPORTUNITY_STATUS.archived;
  if (oldOpportunity.scoreResult) return OPPORTUNITY_STATUS.scored;
  if (snapshotIds.length) return OPPORTUNITY_STATUS.captured;
  return OPPORTUNITY_STATUS.captured;
}

function normalizeOpportunityStatus(status) {
  if (status === OPPORTUNITY_STATUS.scored) return OPPORTUNITY_STATUS.scored;
  if (status === OPPORTUNITY_STATUS.archived) return OPPORTUNITY_STATUS.archived;
  if (status === OPPORTUNITY_STATUS.draft) return OPPORTUNITY_STATUS.captured;
  return OPPORTUNITY_STATUS.captured;
}

async function readStore() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.meta,
    STORAGE_KEYS.opportunities,
    STORAGE_KEYS.snapshots,
    STORAGE_KEYS.opportunityProfiles,
    STORAGE_KEYS.scoreResults,
    STORAGE_KEYS.noteRevisions
  ]);
  return {
    meta: data[STORAGE_KEYS.meta] || null,
    opportunities: data[STORAGE_KEYS.opportunities] || [],
    snapshots: data[STORAGE_KEYS.snapshots] || [],
    opportunityProfiles: data[STORAGE_KEYS.opportunityProfiles] || [],
    scoreResults: data[STORAGE_KEYS.scoreResults] || [],
    noteRevisions: data[STORAGE_KEYS.noteRevisions] || []
  };
}

async function writeStore(store) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.opportunities]: store.opportunities,
    [STORAGE_KEYS.snapshots]: store.snapshots,
    [STORAGE_KEYS.opportunityProfiles]: store.opportunityProfiles,
    [STORAGE_KEYS.scoreResults]: store.scoreResults,
    [STORAGE_KEYS.noteRevisions]: store.noteRevisions
  });
  await bumpStorageRevision();
}

async function bumpStorageRevision(extra = {}) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.meta);
  const meta = data[STORAGE_KEYS.meta] || {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.meta]: {
      ...meta,
      ...extra,
      schemaVersion: SCHEMA_VERSION,
      storageRevision: Number(meta.storageRevision || 0) + 1,
      updatedAt: new Date().toISOString()
    }
  });
}

function withStorageLock(task) {
  const run = storageWriteQueue.then(task, task);
  storageWriteQueue = run.catch(() => {});
  return run;
}

async function createBackup() {
  const allData = await chrome.storage.local.get(null);
  const backupKey = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await chrome.storage.local.set({
    [backupKey]: {
      createdAt: new Date().toISOString(),
      schemaVersionBeforeBackup: allData[STORAGE_KEYS.meta]?.schemaVersion || 0,
      data: allData
    }
  });
  const meta = allData[STORAGE_KEYS.meta] || {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.meta]: {
      ...meta,
      schemaVersion: meta.schemaVersion || 0,
      lastBackupAt: new Date().toISOString(),
      lastBackupKey: backupKey
    }
  });
  return backupKey;
}

async function exportData() {
  const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const settings = normalizeSettings(data[STORAGE_KEYS.settings]);
  const safeSettings = {
    ...settings,
    apiKey: ""
  };
  return {
    manifest: {
      app: "UpworkHelper",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      excludes: ["settings.apiKey"],
      entityCounts: countExportEntities(data)
    },
    data: {
      ...data,
      [STORAGE_KEYS.settings]: safeSettings
    }
  };
}

function validateImportData(importPayload) {
  const manifest = importPayload?.manifest;
  const data = importPayload?.data;
  if (!manifest || !data) throw new Error("Import file must contain manifest and data");
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schemaVersion: ${manifest.schemaVersion}`);

  const opportunities = requireArray(data[STORAGE_KEYS.opportunities], STORAGE_KEYS.opportunities);
  const snapshots = requireArray(data[STORAGE_KEYS.snapshots], STORAGE_KEYS.snapshots);
  const profiles = requireArray(data[STORAGE_KEYS.opportunityProfiles], STORAGE_KEYS.opportunityProfiles);
  const scores = requireArray(data[STORAGE_KEYS.scoreResults], STORAGE_KEYS.scoreResults);
  const notes = requireArray(data[STORAGE_KEYS.noteRevisions], STORAGE_KEYS.noteRevisions);
  validateReferences({ opportunities, snapshots, profiles, scores, notes });

  return {
    schemaVersion: manifest.schemaVersion,
    entityCounts: {
      opportunities: opportunities.length,
      snapshots: snapshots.length,
      opportunityProfiles: profiles.length,
      scoreResults: scores.length,
      noteRevisions: notes.length
    }
  };
}

async function importData(importPayload) {
  const preview = validateImportData(importPayload);
  return withStorageLock(async () => {
    const backupKey = await createBackup();
    const currentSettings = await getSettings();
    const importedSettings = normalizeSettings(importPayload.data[STORAGE_KEYS.settings]);
    importedSettings.apiKey = currentSettings.apiKey;
    await chrome.storage.local.set({
      ...importPayload.data,
      [STORAGE_KEYS.meta]: {
        schemaVersion: SCHEMA_VERSION,
        storageRevision: 1,
        importedAt: new Date().toISOString(),
        lastBackupKey: backupKey
      },
      [STORAGE_KEYS.settings]: importedSettings
    });
    return { backupKey, preview };
  });
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function validateReferences({ opportunities, snapshots, profiles, scores, notes }) {
  const opportunityIds = new Set(opportunities.map((item) => item.id));
  for (const snapshot of snapshots) {
    if (!opportunityIds.has(snapshot.opportunityId)) throw new Error(`Snapshot ${snapshot.id} references missing opportunity`);
  }
  for (const profile of profiles) {
    if (!opportunityIds.has(profile.opportunityId)) throw new Error(`Profile ${profile.id} references missing opportunity`);
  }
  for (const score of scores) {
    if (!opportunityIds.has(score.opportunityId)) throw new Error(`Score ${score.id} references missing opportunity`);
  }
  for (const note of notes) {
    if (!opportunityIds.has(note.opportunityId)) throw new Error(`Note ${note.id} references missing opportunity`);
  }
}

function countExportEntities(data) {
  return {
    opportunities: (data[STORAGE_KEYS.opportunities] || []).length,
    snapshots: (data[STORAGE_KEYS.snapshots] || []).length,
    opportunityProfiles: (data[STORAGE_KEYS.opportunityProfiles] || []).length,
    scoreResults: (data[STORAGE_KEYS.scoreResults] || []).length,
    noteRevisions: (data[STORAGE_KEYS.noteRevisions] || []).length,
    portfolioCases: (data[STORAGE_KEYS.portfolioCases] || []).length,
    outcomeEvents: (data[STORAGE_KEYS.outcomeEvents] || []).length,
    clientRecords: (data[STORAGE_KEYS.clientRecords] || []).length,
    fieldSelectors: (data[STORAGE_KEYS.fieldSelectors] || []).length
  };
}

async function hashText(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function normalizeError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}
