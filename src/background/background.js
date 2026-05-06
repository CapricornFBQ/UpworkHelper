import {
  DEFAULT_SETTINGS,
  OPPORTUNITY_STATUS,
  OUTCOME_EVENT_TYPE,
  OUTCOME_STATUS,
  PLATFORM_HOSTS,
  PROPOSAL_DRAFT_STATUS,
  PROMPT_VERSIONS,
  SCHEMA_VERSION,
  SNAPSHOT_RETENTION_STATE,
  STORAGE_KEYS
} from "../shared/schema.js";
import {
  PROFILE_FIELD_DEFINITIONS,
  buildEffectiveProfile,
  isEmptyProfileValue,
  mapRawProfileFields,
  normalizeDimensions,
  normalizeMissingProfileFieldKeys,
  normalizeProfileFieldValue,
  normalizeRawProposalDraft,
  normalizeRawScore,
  profileFieldsToLegacyRawProfile
} from "../shared/adapters.js";

const MAX_SNAPSHOT_CHARS = 70000;
const MAX_SCORE_INPUT_CHARS = 110000;
const MAX_PROPOSAL_INPUT_CHARS = 65000;
const SNAPSHOT_COMPACT_CHARS = 2000;
const BACKUP_PREFIX = "uosc_backup_v0_to_v1_";
const SCORE_DECISIONS = ["strong_apply", "targeted_apply", "only_if_strong_fit", "skip"];
const PROPOSAL_SOURCE_TYPES = Object.freeze(["opportunity_field", "snapshot_evidence", "my_profile", "portfolio_case", "notes", "score_result"]);
const OUTCOME_EVENT_TYPES = Object.freeze(Object.values(OUTCOME_EVENT_TYPE));
const OUTCOME_STATUSES = Object.freeze(Object.values(OUTCOME_STATUS));
const OUTCOME_EVENT_SOURCES = Object.freeze(["manual", "capture", "import"]);
const MANAGED_STORAGE_KEYS = Object.freeze(Object.values(STORAGE_KEYS));
const UNIMPLEMENTED_IMPORT_KEYS = Object.freeze([
  STORAGE_KEYS.clientRecords,
  STORAGE_KEYS.fieldSelectors,
  STORAGE_KEYS.analyticsCache
]);

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
    case "myProfile:get":
      return { ok: true, profile: await getMyProfile() };
    case "myProfile:save":
      return { ok: true, profile: await saveMyProfile(message.profile || message.myProfile || {}) };
    case "myProfile:clear":
      await clearMyProfile();
      return { ok: true };
    case "myProfile:listVersions":
      return { ok: true, profiles: await listMyProfileVersions() };
    case "portfolio:list":
      return { ok: true, portfolioCases: await listPortfolioCases({ includeArchived: Boolean(message.includeArchived) }) };
    case "portfolio:get":
      return { ok: true, portfolioCase: await getPortfolioCase(message.id) };
    case "portfolio:create":
      return { ok: true, portfolioCase: await createPortfolioCase(message.portfolioCase || message.case || {}) };
    case "portfolio:update":
      return { ok: true, portfolioCase: await updatePortfolioCase(message.id, message.portfolioCase || message.case || {}) };
    case "portfolio:archive":
    case "portfolio:delete":
      return { ok: true, portfolioCase: await archivePortfolioCase(message.id) };
    case "portfolio:clear":
      return { ok: true, archivedCount: await clearPortfolioCases() };
    case "data:getStorageUsage":
      return { ok: true, usage: await getStorageUsage() };
    case "snapshots:getRetentionSummary":
      return { ok: true, summary: await getSnapshotRetentionSummary() };
    case "snapshots:compactText":
      return { ok: true, result: await compactSnapshotText() };
    case "snapshots:redactText":
      return { ok: true, result: await redactSnapshotText() };
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
    case "profile:extract":
      return { ok: true, opportunity: await extractProfileForOpportunity(message.id || message.opportunityId) };
    case "profile:getExtracted":
      return { ok: true, profile: await getCurrentProfileForOpportunity(message.id || message.opportunityId) };
    case "profile:saveCorrections":
      return { ok: true, opportunity: await saveProfileCorrections(message.id || message.opportunityId, message.fields || {}) };
    case "profile:clearCorrections":
      return { ok: true, opportunity: await clearProfileCorrections(message.id || message.opportunityId) };
    case "capture:currentPage":
      return captureCurrentPage(message.opportunityId || null);
    case "score:opportunity":
    case "scores:create":
      return { ok: true, opportunity: await scoreOpportunity(message.opportunityId) };
    case "proposal:generate":
      return { ok: true, opportunity: await generateProposalDraft(message.opportunityId) };
    case "proposal:list":
      return { ok: true, proposalDrafts: await listProposalDrafts(message.opportunityId, { includeArchived: Boolean(message.includeArchived) }) };
    case "proposal:get":
      return { ok: true, proposalDraft: await getProposalDraft(message.id) };
    case "proposal:update":
    case "proposal:updateDraft":
      return { ok: true, opportunity: await updateProposalDraft(message.id, message.patch || message.draft || {}) };
    case "proposal:archive":
    case "proposal:delete":
      return { ok: true, opportunity: await archiveProposalDraft(message.id) };
    case "outcome:appendEvent":
    case "outcome:create":
      return { ok: true, opportunity: await appendOutcomeEvent(message.opportunityId, message.event || message.outcomeEvent || {}) };
    case "outcome:voidEvent":
    case "outcome:delete":
      return { ok: true, opportunity: await voidOutcomeEvent(message.id, message.reason || "") };
    case "outcome:listEvents":
    case "outcome:list":
      return { ok: true, outcomeEvents: await listOutcomeEvents(message.opportunityId, { includeVoided: Boolean(message.includeVoided) }) };
    case "outcome:getSummary":
      return { ok: true, outcomeSummary: await getOutcomeSummary(message.opportunityId) };
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
  const data = await chrome.storage.local.get(MANAGED_STORAGE_KEYS);
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
    [STORAGE_KEYS.fieldSelectors]: data[STORAGE_KEYS.fieldSelectors] || [],
    [STORAGE_KEYS.analyticsCache]: data[STORAGE_KEYS.analyticsCache] || {}
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

async function getMyProfile() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.myProfile);
  return data[STORAGE_KEYS.myProfile] || null;
}

async function saveMyProfile(profileInput) {
  return withStorageLock(async () => {
    const current = await getMyProfile();
    const now = new Date().toISOString();
    const profile = normalizeMyProfileInput(profileInput, current, now);
    await chrome.storage.local.set({ [STORAGE_KEYS.myProfile]: profile });
    await bumpStorageRevision();
    return profile;
  });
}

async function clearMyProfile() {
  return withStorageLock(async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.myProfile]: null });
    await bumpStorageRevision();
  });
}

async function listMyProfileVersions() {
  const profile = await getMyProfile();
  return profile ? [profile] : [];
}

async function listPortfolioCases({ includeArchived = false } = {}) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.portfolioCases);
  const cases = Array.isArray(data[STORAGE_KEYS.portfolioCases]) ? data[STORAGE_KEYS.portfolioCases] : [];
  return cases
    .filter((item) => includeArchived || !item.archivedAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

async function getPortfolioCase(id) {
  if (!id) return null;
  const cases = await listPortfolioCases({ includeArchived: true });
  return cases.find((item) => item.id === id) || null;
}

async function createPortfolioCase(caseInput) {
  return withStorageLock(async () => {
    const data = await chrome.storage.local.get(STORAGE_KEYS.portfolioCases);
    const cases = Array.isArray(data[STORAGE_KEYS.portfolioCases]) ? data[STORAGE_KEYS.portfolioCases] : [];
    const now = new Date().toISOString();
    const portfolioCase = normalizePortfolioCaseInput(caseInput, null, now);
    cases.push(portfolioCase);
    await chrome.storage.local.set({ [STORAGE_KEYS.portfolioCases]: cases });
    await bumpStorageRevision();
    return portfolioCase;
  });
}

async function updatePortfolioCase(id, caseInput) {
  if (!id) throw new Error("Portfolio case id is required");
  return withStorageLock(async () => {
    const data = await chrome.storage.local.get(STORAGE_KEYS.portfolioCases);
    const cases = Array.isArray(data[STORAGE_KEYS.portfolioCases]) ? data[STORAGE_KEYS.portfolioCases] : [];
    const index = cases.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Portfolio case not found");
    const now = new Date().toISOString();
    const portfolioCase = normalizePortfolioCaseInput(caseInput, cases[index], now);
    cases[index] = portfolioCase;
    await chrome.storage.local.set({ [STORAGE_KEYS.portfolioCases]: cases });
    await bumpStorageRevision();
    return portfolioCase;
  });
}

async function archivePortfolioCase(id) {
  if (!id) throw new Error("Portfolio case id is required");
  return withStorageLock(async () => {
    const data = await chrome.storage.local.get(STORAGE_KEYS.portfolioCases);
    const cases = Array.isArray(data[STORAGE_KEYS.portfolioCases]) ? data[STORAGE_KEYS.portfolioCases] : [];
    const index = cases.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Portfolio case not found");
    const now = new Date().toISOString();
    cases[index] = {
      ...cases[index],
      version: Number(cases[index].version || 1) + 1,
      updatedAt: now,
      archivedAt: now
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.portfolioCases]: cases });
    await bumpStorageRevision();
    return cases[index];
  });
}

async function clearPortfolioCases() {
  return withStorageLock(async () => {
    const data = await chrome.storage.local.get(STORAGE_KEYS.portfolioCases);
    const cases = Array.isArray(data[STORAGE_KEYS.portfolioCases]) ? data[STORAGE_KEYS.portfolioCases] : [];
    const now = new Date().toISOString();
    let archivedCount = 0;
    const nextCases = cases.map((item) => {
      if (item.archivedAt) return item;
      archivedCount += 1;
      return {
        ...item,
        version: Number(item.version || 1) + 1,
        updatedAt: now,
        archivedAt: now
      };
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.portfolioCases]: nextCases });
    await bumpStorageRevision();
    return archivedCount;
  });
}

function normalizeMyProfileInput(input = {}, current = null, now = new Date().toISOString()) {
  return {
    id: current?.id || input.id || crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    version: Number(current?.version || 0) + 1,
    createdAt: current?.createdAt || input.createdAt || now,
    updatedAt: now,
    displayName: normalizeText(input.displayName ?? current?.displayName),
    title: normalizeText(input.title ?? current?.title),
    summary: normalizeText(input.summary ?? current?.summary),
    skillTags: normalizeStringList(input.skillTags ?? current?.skillTags),
    serviceCategories: normalizeStringList(input.serviceCategories ?? current?.serviceCategories),
    strengths: normalizeStringList(input.strengths ?? current?.strengths),
    preferredProjects: normalizeStringList(input.preferredProjects ?? current?.preferredProjects),
    rejectRules: normalizeStringList(input.rejectRules ?? current?.rejectRules),
    rateCard: normalizeRateCard(input.rateCard ?? current?.rateCard),
    availability: normalizeText(input.availability ?? current?.availability),
    proposalPreferences: normalizeStringList(input.proposalPreferences ?? current?.proposalPreferences),
    languagePreferences: normalizeStringList(input.languagePreferences ?? current?.languagePreferences),
    archivedAt: null
  };
}

function normalizePortfolioCaseInput(input = {}, current = null, now = new Date().toISOString()) {
  const title = normalizeText(input.title ?? current?.title);
  if (!title) throw new Error("Portfolio case title is required");
  return {
    id: current?.id || input.id || crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    version: Number(current?.version || 0) + 1,
    createdAt: current?.createdAt || input.createdAt || now,
    updatedAt: now,
    title,
    summary: normalizeText(input.summary ?? current?.summary),
    skillTags: normalizeStringList(input.skillTags ?? current?.skillTags),
    outcome: normalizeText(input.outcome ?? current?.outcome),
    proofPoints: normalizeStringList(input.proofPoints ?? current?.proofPoints),
    links: normalizeStringList(input.links ?? current?.links),
    applicableKeywords: normalizeStringList(input.applicableKeywords ?? current?.applicableKeywords),
    sourceRefs: Array.isArray(input.sourceRefs) ? input.sourceRefs : (Array.isArray(current?.sourceRefs) ? current.sourceRefs : []),
    archivedAt: null
  };
}

function normalizeRateCard(rateCard = {}) {
  return {
    currency: normalizeText(rateCard.currency || "USD"),
    hourlyRateText: normalizeText(rateCard.hourlyRateText),
    minimumProjectBudgetText: normalizeText(rateCard.minimumProjectBudgetText),
    fixedProjectMinimumText: normalizeText(rateCard.fixedProjectMinimumText)
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIsoTime(value, fieldName) {
  const text = normalizeText(value);
  const time = Date.parse(text);
  if (!text || Number.isNaN(time)) throw new Error(`${fieldName} must be a valid ISO date`);
  return new Date(time).toISOString();
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Outcome numeric payload field is invalid");
  return number;
}

function normalizeBidType(value) {
  const text = normalizeText(value || "unknown");
  return ["fixed", "hourly", "unknown"].includes(text) ? text : "unknown";
}

async function getStorageUsage() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  return {
    bytesInUse,
    quotaBytes: chrome.storage.local.QUOTA_BYTES || null
  };
}

async function getSnapshotRetentionSummary() {
  const store = await readStore();
  return summarizeSnapshotRetention(store.snapshots);
}

async function compactSnapshotText() {
  return withStorageLock(async () => {
    const store = await readStore();
    const before = summarizeSnapshotRetention(store.snapshots);
    const compactedAt = new Date().toISOString();
    const candidates = store.snapshots.filter((snapshot) => {
      const text = String(snapshot.text || "");
      return snapshot.retentionState === SNAPSHOT_RETENTION_STATE.full && text.length > SNAPSHOT_COMPACT_CHARS;
    });
    let backupKey = null;
    if (candidates.length > 0) backupKey = await createBackup();

    for (const snapshot of candidates) {
      const text = String(snapshot.text || "");
      const compactedText = [
        text.slice(0, SNAPSHOT_COMPACT_CHARS).trimEnd(),
        "",
        `[Compacted locally. Original text chars: ${text.length}.]`
      ].join("\n");
      snapshot.stats = {
        ...(snapshot.stats || {}),
        originalTextCharCount: text.length,
        originalTextHash: snapshot.textHash || null,
        compactedCharCount: compactedText.length,
        compactedAt
      };
      snapshot.text = compactedText;
      snapshot.textHash = await hashText(compactedText);
      snapshot.retentionState = SNAPSHOT_RETENTION_STATE.compacted;
    }

    if (candidates.length > 0) await writeStore(store);

    return {
      updatedCount: candidates.length,
      backupKey,
      before,
      after: summarizeSnapshotRetention(store.snapshots)
    };
  });
}

async function redactSnapshotText() {
  return withStorageLock(async () => {
    const store = await readStore();
    const before = summarizeSnapshotRetention(store.snapshots);
    const redactedAt = new Date().toISOString();
    const candidates = store.snapshots.filter((snapshot) => String(snapshot.text || "").length > 0);
    let backupKey = null;
    if (candidates.length > 0) backupKey = await createBackup();

    for (const snapshot of candidates) {
      const text = String(snapshot.text || "");
      snapshot.stats = {
        ...(snapshot.stats || {}),
        originalTextCharCount: snapshot.stats?.originalTextCharCount || text.length,
        originalTextHash: snapshot.stats?.originalTextHash || snapshot.textHash || null,
        redactedAt
      };
      snapshot.text = "";
      snapshot.textHash = await hashText("");
      snapshot.retentionState = SNAPSHOT_RETENTION_STATE.redacted;
    }

    if (candidates.length > 0) await writeStore(store);

    return {
      updatedCount: candidates.length,
      backupKey,
      before,
      after: summarizeSnapshotRetention(store.snapshots)
    };
  });
}

function summarizeSnapshotRetention(snapshots) {
  const counts = {
    [SNAPSHOT_RETENTION_STATE.full]: 0,
    [SNAPSHOT_RETENTION_STATE.redacted]: 0,
    [SNAPSHOT_RETENTION_STATE.compacted]: 0,
    [SNAPSHOT_RETENTION_STATE.deletedReferenceOnly]: 0,
    unknown: 0
  };
  let textChars = 0;
  let snapshotsWithText = 0;
  let compactableCount = 0;

  for (const snapshot of snapshots || []) {
    const state = snapshot.retentionState || "unknown";
    counts[state] = (counts[state] ?? 0) + 1;
    const textLength = String(snapshot.text || "").length;
    textChars += textLength;
    if (textLength > 0) snapshotsWithText += 1;
    if (state === SNAPSHOT_RETENTION_STATE.full && textLength > SNAPSHOT_COMPACT_CHARS) compactableCount += 1;
  }

  return {
    totalSnapshots: (snapshots || []).length,
    snapshotsWithText,
    compactableCount,
    textChars,
    compactChars: SNAPSHOT_COMPACT_CHARS,
    counts
  };
}

async function listOpportunitySummaries({ includeArchived = false } = {}) {
  const store = await readStore();
  const summaries = store.opportunities
    .filter((opportunity) => includeArchived || opportunity.status !== OPPORTUNITY_STATUS.archived)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((opportunity) => {
      const score = store.scoreResults.find((item) => item.id === opportunity.currentScoreResultId) || null;
      const outcomeSummary = deriveOutcomeSummary(opportunity.id, store.outcomeEvents);
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
        outcomeSummary,
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
    store.proposalDrafts = store.proposalDrafts.filter((item) => item.opportunityId !== id);
    store.outcomeEvents = store.outcomeEvents.filter((item) => item.opportunityId !== id);
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

async function getCurrentProfileForOpportunity(id) {
  const detail = await getOpportunityDetail(id);
  return detail?.profile || null;
}

async function extractProfileForOpportunity(opportunityId) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("OpenAI API key is missing. Set it in Options first.");

  const extractionInput = await withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    if (opportunity.status === OPPORTUNITY_STATUS.archived) throw new Error("Archived opportunity cannot be extracted");
    const detail = hydrateOpportunity(opportunity, store);
    if (!detail.snapshots.length) throw new Error("No snapshots captured for this opportunity");
    return {
      detail,
      snapshotIds: [...opportunity.snapshotIds],
      currentProfileId: opportunity.currentProfileId || null,
      status: opportunity.status
    };
  });

  const rawProfile = await extractOpportunityProfile(extractionInput.detail, settings);

  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    if (
      opportunity.status === OPPORTUNITY_STATUS.archived ||
      opportunity.status !== extractionInput.status ||
      (opportunity.currentProfileId || null) !== extractionInput.currentProfileId ||
      !arraysEqual(opportunity.snapshotIds, extractionInput.snapshotIds)
    ) {
      throw new Error("Opportunity changed while extracting profile. Re-run extraction with the latest snapshots.");
    }

    const profileVersion = store.opportunityProfiles.filter((item) => item.opportunityId === opportunityId).length + 1;
    const createdAt = new Date().toISOString();
    const profileRecord = createProfileRecord({
      id: crypto.randomUUID(),
      opportunityId,
      rawProfile,
      model: settings.extractModel,
      inputSnapshotIds: extractionInput.snapshotIds,
      version: profileVersion,
      createdAt
    });
    store.opportunityProfiles.push(profileRecord);
    store.opportunities[index] = {
      ...opportunity,
      currentProfileId: profileRecord.id,
      title: getProfileTitle(profileRecord) || opportunity.title,
      updatedAt: profileRecord.createdAt
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

async function saveProfileCorrections(opportunityId, fieldValues) {
  if (!opportunityId) throw new Error("Opportunity id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    const profile = store.opportunityProfiles.find((item) => item.id === opportunity.currentProfileId);
    if (!profile) throw new Error("Extract profile before saving corrections");

    const now = new Date().toISOString();
    const nextFields = { ...(profile.fields || {}) };
    for (const definition of PROFILE_FIELD_DEFINITIONS) {
      if (!Object.prototype.hasOwnProperty.call(fieldValues, definition.key)) continue;
      nextFields[definition.key] = applyProfileCorrection({
        field: nextFields[definition.key],
        definition,
        value: fieldValues[definition.key],
        correctedAt: now
      });
    }

    const nextProfile = {
      ...profile,
      fields: nextFields,
      missingFieldKeys: buildMissingFieldKeys(nextFields),
      conflicts: buildProfileConflicts(nextFields),
      reviewedAt: now,
      reviewedBy: "user",
      updatedAt: now
    };
    const profileIndex = store.opportunityProfiles.findIndex((item) => item.id === profile.id);
    store.opportunityProfiles[profileIndex] = nextProfile;
    store.opportunities[index] = {
      ...opportunity,
      title: getProfileTitle(nextProfile) || opportunity.title,
      updatedAt: now
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

async function clearProfileCorrections(opportunityId) {
  if (!opportunityId) throw new Error("Opportunity id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    const profile = store.opportunityProfiles.find((item) => item.id === opportunity.currentProfileId);
    if (!profile) throw new Error("Extract profile before clearing corrections");

    const now = new Date().toISOString();
    const fields = {};
    for (const definition of PROFILE_FIELD_DEFINITIONS) {
      const field = profile.fields?.[definition.key];
      if (!field) continue;
      const aiSource = (field.sources || []).find((source) => source.source === "ai_extracted");
      if (!aiSource) continue;
      const value = normalizeProfileFieldValue(aiSource.value, definition.valueKind);
      if (isEmptyProfileValue(value)) continue;
      fields[definition.key] = {
        ...field,
        value,
        valueKind: definition.valueKind,
        effectiveSource: "ai_extracted",
        sources: (field.sources || []).filter((source) => source.source !== "user_corrected"),
        confidence: aiSource.confidence ?? field.confidence ?? null,
        correctedAt: null,
        correctedBy: null
      };
    }

    const nextProfile = {
      ...profile,
      fields,
      missingFieldKeys: buildMissingFieldKeys(fields),
      conflicts: [],
      reviewedAt: null,
      reviewedBy: null,
      updatedAt: now
    };
    const profileIndex = store.opportunityProfiles.findIndex((item) => item.id === profile.id);
    store.opportunityProfiles[profileIndex] = nextProfile;
    store.opportunities[index] = {
      ...opportunity,
      title: getProfileTitle(nextProfile) || opportunity.title,
      updatedAt: now
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

function applyProfileCorrection({ field, definition, value, correctedAt }) {
  const normalizedValue = normalizeProfileFieldValue(value, definition.valueKind);
  const existingSources = Array.isArray(field?.sources) ? field.sources : [];
  const userSource = {
    source: "user_corrected",
    value: normalizedValue,
    confidence: 1,
    evidenceRefs: [],
    snapshotId: null,
    selectorId: null,
    createdAt: correctedAt
  };
  return {
    ...(field || {}),
    value: normalizedValue,
    valueKind: definition.valueKind,
    effectiveSource: "user_corrected",
    sources: [
      ...existingSources.filter((source) => source.source !== "user_corrected"),
      userSource
    ],
    confidence: 1,
    evidenceRefs: field?.evidenceRefs || [],
    correctedAt,
    correctedBy: "user"
  };
}

function buildMissingFieldKeys(fields) {
  return PROFILE_FIELD_DEFINITIONS
    .filter((definition) => isEmptyProfileValue(fields?.[definition.key]?.value))
    .map((definition) => definition.key);
}

function buildProfileConflicts(fields) {
  const conflicts = [];
  for (const definition of PROFILE_FIELD_DEFINITIONS) {
    const field = fields?.[definition.key];
    if (!field) continue;
    const aiSource = (field.sources || []).find((source) => source.source === "ai_extracted");
    const userSource = (field.sources || []).find((source) => source.source === "user_corrected");
    if (!aiSource || !userSource) continue;
    const aiValue = normalizeProfileFieldValue(aiSource.value, definition.valueKind);
    const userValue = normalizeProfileFieldValue(userSource.value, definition.valueKind);
    if (profileValuesEqual(aiValue, userValue)) continue;
    conflicts.push({
      fieldKey: definition.key,
      label: definition.label,
      selectedSource: "user_corrected",
      sources: [
        { source: "ai_extracted", value: aiValue, confidence: aiSource.confidence ?? null },
        { source: "user_corrected", value: userValue, confidence: userSource.confidence ?? 1 }
      ]
    });
  }
  return conflicts;
}

function profileValuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftArray = Array.isArray(left) ? left : normalizeProfileFieldValue(left, "array");
    const rightArray = Array.isArray(right) ? right : normalizeProfileFieldValue(right, "array");
    return arraysEqual(leftArray, rightArray);
  }
  return String(left || "") === String(right || "");
}

function getProfileTitle(profile) {
  const value = profile?.fields?.jobTitle?.value;
  return Array.isArray(value) ? value.join(", ") : String(value || "").trim();
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
    const detectedOutcomeEvent = createCaptureOutcomeEvent({ opportunity, snapshot, text: result.text, capturedAt });
    if (detectedOutcomeEvent) store.outcomeEvents.push(detectedOutcomeEvent);
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

function createCaptureOutcomeEvent({ opportunity, snapshot, text, capturedAt }) {
  const detected = detectOutcomeStatusFromCapture(snapshot.sourceUrl, text);
  if (!detected) return null;
  return {
    id: crypto.randomUUID(),
    opportunityId: opportunity.id,
    schemaVersion: SCHEMA_VERSION,
    eventType: OUTCOME_EVENT_TYPE.captureDetectedStatus,
    occurredAt: capturedAt,
    recordedAt: capturedAt,
    source: "capture",
    snapshotId: snapshot.id,
    payload: {
      detectedStatus: detected.status,
      confidence: detected.confidence,
      evidenceRefs: [{
        sourceType: "snapshot_evidence",
        sourceId: snapshot.id,
        fieldKey: "text",
        label: detected.label,
        quote: detected.quote
      }]
    },
    notes: "",
    correctionOfEventId: null,
    voidedAt: null
  };
}

function detectOutcomeStatusFromCapture(url, text) {
  const corpus = `${url || ""}\n${text || ""}`.toLowerCase();
  const rules = [
    { status: OUTCOME_STATUS.hired, label: "Detected hired status", patterns: ["contract started", "you were hired", "offer accepted"] },
    { status: OUTCOME_STATUS.interviewing, label: "Detected interview status", patterns: ["interview invitation", "invite to interview", "interview started"] },
    { status: OUTCOME_STATUS.replied, label: "Detected client reply", patterns: ["client replied", "new message from the client", "messages with client"] },
    { status: OUTCOME_STATUS.viewed, label: "Detected proposal viewed", patterns: ["client viewed your proposal", "proposal viewed"] },
    { status: OUTCOME_STATUS.applied, label: "Detected proposal sent", patterns: ["you submitted a proposal", "proposal submitted", "your proposal was sent"] },
    { status: OUTCOME_STATUS.lost, label: "Detected lost status", patterns: ["job closed", "not selected", "contract ended without hire"] }
  ];
  for (const rule of rules) {
    const quote = rule.patterns.find((pattern) => corpus.includes(pattern));
    if (quote) return { status: rule.status, confidence: 0.8, label: rule.label, quote };
  }
  return null;
}

async function readPersonalContext() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.myProfile,
    STORAGE_KEYS.portfolioCases
  ]);
  const myProfile = data[STORAGE_KEYS.myProfile]?.archivedAt ? null : data[STORAGE_KEYS.myProfile] || null;
  const portfolioCases = (Array.isArray(data[STORAGE_KEYS.portfolioCases]) ? data[STORAGE_KEYS.portfolioCases] : [])
    .filter((item) => !item.archivedAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  return { myProfile, portfolioCases };
}

function buildPersonalContextSignature(context = {}) {
  return JSON.stringify({
    myProfile: context.myProfile ? {
      id: context.myProfile.id,
      version: context.myProfile.version,
      updatedAt: context.myProfile.updatedAt,
      archivedAt: context.myProfile.archivedAt || null
    } : null,
    portfolioCases: (context.portfolioCases || []).map((item) => ({
      id: item.id,
      version: item.version,
      updatedAt: item.updatedAt,
      archivedAt: item.archivedAt || null
    }))
  });
}

async function scoreOpportunity(opportunityId) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("OpenAI API key is missing. Set it in Options first.");

  const scoringInput = await withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    const detail = hydrateOpportunity(opportunity, store);
    if (!detail.snapshots.length) throw new Error("No snapshots captured for this opportunity");
    const currentProfile = store.opportunityProfiles.find((item) => item.id === opportunity.currentProfileId) || null;
    const currentProfileMatchesSnapshots = currentProfile && arraysEqual(currentProfile.inputSnapshotIds, opportunity.snapshotIds);
    const personalContext = await readPersonalContext();

    return {
      detail,
      snapshotIds: [...opportunity.snapshotIds],
      notesRevisionId: opportunity.currentNotesRevisionId || null,
      currentProfile: currentProfileMatchesSnapshots ? currentProfile : null,
      currentProfileId: opportunity.currentProfileId || null,
      currentProfileUpdatedAt: currentProfileMatchesSnapshots ? currentProfile.updatedAt : null,
      profileCount: store.opportunityProfiles.filter((item) => item.opportunityId === opportunityId).length,
      personalContext,
      personalContextSignature: buildPersonalContextSignature(personalContext),
      currentScoreResultId: opportunity.currentScoreResultId || null,
      status: opportunity.status
    };
  });

  let profileRecord = scoringInput.currentProfile;
  let shouldCreateProfile = false;
  if (!profileRecord) {
    const rawProfile = await extractOpportunityProfile(scoringInput.detail, settings);
    profileRecord = createProfileRecord({
      id: crypto.randomUUID(),
      opportunityId,
      rawProfile,
      model: settings.extractModel,
      inputSnapshotIds: scoringInput.snapshotIds,
      version: scoringInput.profileCount + 1,
      createdAt: new Date().toISOString()
    });
    shouldCreateProfile = true;
  }
  const effectiveProfile = profileFieldsToLegacyRawProfile(profileRecord);
  const rawScore = await scoreOpportunityProfile(scoringInput.detail, effectiveProfile, settings, scoringInput.personalContext);

  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    const currentProfile = store.opportunityProfiles.find((item) => item.id === opportunity.currentProfileId) || null;
    const currentPersonalContext = await readPersonalContext();
    if (
      opportunity.status === OPPORTUNITY_STATUS.archived ||
      opportunity.status !== scoringInput.status ||
      (opportunity.currentScoreResultId || null) !== scoringInput.currentScoreResultId ||
      (opportunity.currentProfileId || null) !== scoringInput.currentProfileId ||
      (scoringInput.currentProfileUpdatedAt && currentProfile?.updatedAt !== scoringInput.currentProfileUpdatedAt) ||
      buildPersonalContextSignature(currentPersonalContext) !== scoringInput.personalContextSignature ||
      !arraysEqual(opportunity.snapshotIds, scoringInput.snapshotIds) ||
      (opportunity.currentNotesRevisionId || null) !== scoringInput.notesRevisionId
    ) {
      throw new Error("Opportunity changed while scoring. Re-run scoring with the latest snapshots, profile, and notes.");
    }

    const inputProfile = shouldCreateProfile ? profileRecord : currentProfile;
    if (!inputProfile) throw new Error("Opportunity profile not found");
    if (shouldCreateProfile) store.opportunityProfiles.push(inputProfile);
    const createdAt = new Date().toISOString();
    const scoreRecord = createScoreRecord({
      id: crypto.randomUUID(),
      opportunityId,
      rawScore,
      model: settings.scoreModel,
      inputSnapshotIds: scoringInput.snapshotIds,
      inputProfileId: inputProfile.id,
      inputProfileVersion: inputProfile.version,
      notesRevisionId: scoringInput.notesRevisionId,
      profileReviewed: Boolean(inputProfile.reviewedAt),
      personalContext: scoringInput.personalContext,
      createdAt
    });

    store.scoreResults.push(scoreRecord);
    store.opportunities[index] = {
      ...opportunity,
      status: OPPORTUNITY_STATUS.scored,
      currentProfileId: inputProfile.id,
      currentScoreResultId: scoreRecord.id,
      updatedAt: scoreRecord.createdAt
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

async function generateProposalDraft(opportunityId) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("OpenAI API key is missing. Set it in Options first.");

  const proposalInput = await withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    if (opportunity.status === OPPORTUNITY_STATUS.archived) throw new Error("Archived opportunity cannot generate proposals");
    const detail = hydrateOpportunity(opportunity, store);
    if (!detail.snapshots.length) throw new Error("No snapshots captured for this opportunity");
    if (!opportunity.currentScoreResultId) throw new Error("Score this opportunity before generating a proposal");
    if (detail.scoreStale) throw new Error("Current score is stale. Re-score before generating a proposal");

    const score = store.scoreResults.find((item) => item.id === opportunity.currentScoreResultId);
    if (!score) throw new Error("Current score result not found");
    const profile = store.opportunityProfiles.find((item) => item.id === opportunity.currentProfileId) || null;
    const personalContext = await readPersonalContext();
    const selectedPortfolioCases = selectRelevantPortfolioCases({ detail, score, portfolioCases: personalContext.portfolioCases });

    return {
      detail,
      snapshotIds: [...opportunity.snapshotIds],
      notesRevisionId: opportunity.currentNotesRevisionId || null,
      currentProfileId: opportunity.currentProfileId || null,
      currentScoreResultId: opportunity.currentScoreResultId || null,
      currentProposalDraftId: opportunity.currentProposalDraftId || null,
      status: opportunity.status,
      score,
      profile,
      personalContext,
      personalContextSignature: buildPersonalContextSignature(personalContext),
      selectedPortfolioCases
    };
  });

  const rawProposal = await generateProposalDraftText({
    detail: proposalInput.detail,
    score: proposalInput.score,
    personalContext: proposalInput.personalContext,
    selectedPortfolioCases: proposalInput.selectedPortfolioCases,
    settings
  });

  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const opportunity = store.opportunities[index];
    const currentPersonalContext = await readPersonalContext();
    if (
      opportunity.status === OPPORTUNITY_STATUS.archived ||
      opportunity.status !== proposalInput.status ||
      (opportunity.currentProfileId || null) !== proposalInput.currentProfileId ||
      (opportunity.currentScoreResultId || null) !== proposalInput.currentScoreResultId ||
      (opportunity.currentProposalDraftId || null) !== proposalInput.currentProposalDraftId ||
      buildPersonalContextSignature(currentPersonalContext) !== proposalInput.personalContextSignature ||
      !arraysEqual(opportunity.snapshotIds, proposalInput.snapshotIds) ||
      (opportunity.currentNotesRevisionId || null) !== proposalInput.notesRevisionId
    ) {
      throw new Error("Opportunity changed while generating proposal. Re-run proposal generation with the latest score and profile.");
    }

    const createdAt = new Date().toISOString();
    const proposalDraft = createProposalDraftRecord({
      id: crypto.randomUUID(),
      opportunityId,
      rawDraft: rawProposal,
      model: settings.proposalModel,
      inputProfileId: proposalInput.currentProfileId,
      inputProfileVersion: proposalInput.profile?.version || null,
      inputScoreResultId: proposalInput.currentScoreResultId,
      inputMyProfile: proposalInput.personalContext.myProfile,
      selectedPortfolioCases: proposalInput.selectedPortfolioCases,
      createdAt
    });
    validateProposalSourceRefs(proposalDraft, {
      opportunity,
      snapshotIds: proposalInput.snapshotIds,
      notesRevisionId: proposalInput.notesRevisionId,
      profileId: proposalInput.currentProfileId,
      scoreResultId: proposalInput.currentScoreResultId,
      myProfileId: proposalInput.personalContext.myProfile?.id || null,
      portfolioCaseIds: new Set(proposalInput.selectedPortfolioCases.map((item) => item.id))
    });

    store.proposalDrafts.push(proposalDraft);
    store.opportunities[index] = {
      ...opportunity,
      currentProposalDraftId: proposalDraft.id,
      updatedAt: proposalDraft.createdAt
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

async function listProposalDrafts(opportunityId, { includeArchived = false } = {}) {
  if (!opportunityId) throw new Error("Opportunity id is required");
  const store = await readStore();
  return store.proposalDrafts
    .filter((item) => item.opportunityId === opportunityId)
    .filter((item) => includeArchived || !item.archivedAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

async function getProposalDraft(id) {
  if (!id) return null;
  const store = await readStore();
  return store.proposalDrafts.find((item) => item.id === id) || null;
}

async function updateProposalDraft(id, patch) {
  if (!id) throw new Error("Proposal draft id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const draftIndex = store.proposalDrafts.findIndex((item) => item.id === id);
    if (draftIndex === -1) throw new Error("Proposal draft not found");
    const draft = store.proposalDrafts[draftIndex];
    if (draft.archivedAt) throw new Error("Archived proposal draft cannot be edited");
    const opportunityIndex = store.opportunities.findIndex((item) => item.id === draft.opportunityId);
    if (opportunityIndex === -1) throw new Error("Opportunity not found");
    const finalText = normalizeText(patch.finalText ?? patch.final_proposal_text ?? patch.text);
    if (!finalText) throw new Error("Proposal final text is required");
    const now = new Date().toISOString();
    const revision = {
      id: crypto.randomUUID(),
      createdAt: now,
      createdBy: "user",
      finalText
    };
    store.proposalDrafts[draftIndex] = {
      ...draft,
      updatedAt: now,
      status: PROPOSAL_DRAFT_STATUS.edited,
      finalText,
      revisions: [...(draft.revisions || []), revision]
    };
    store.opportunities[opportunityIndex] = {
      ...store.opportunities[opportunityIndex],
      currentProposalDraftId: id,
      updatedAt: now
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[opportunityIndex], store);
  });
}

async function archiveProposalDraft(id) {
  if (!id) throw new Error("Proposal draft id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const draftIndex = store.proposalDrafts.findIndex((item) => item.id === id);
    if (draftIndex === -1) throw new Error("Proposal draft not found");
    const draft = store.proposalDrafts[draftIndex];
    const opportunityIndex = store.opportunities.findIndex((item) => item.id === draft.opportunityId);
    if (opportunityIndex === -1) throw new Error("Opportunity not found");
    const now = new Date().toISOString();
    store.proposalDrafts[draftIndex] = {
      ...draft,
      updatedAt: now,
      status: PROPOSAL_DRAFT_STATUS.archived,
      archivedAt: now
    };
    const opportunity = store.opportunities[opportunityIndex];
    store.opportunities[opportunityIndex] = {
      ...opportunity,
      currentProposalDraftId: opportunity.currentProposalDraftId === id ? null : opportunity.currentProposalDraftId,
      updatedAt: now
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[opportunityIndex], store);
  });
}

async function appendOutcomeEvent(opportunityId, eventInput = {}) {
  if (!opportunityId) throw new Error("Opportunity id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const index = store.opportunities.findIndex((item) => item.id === opportunityId);
    if (index === -1) throw new Error("Opportunity not found");
    const event = normalizeOutcomeEventInput(eventInput, {
      opportunity: store.opportunities[index],
      proposalDrafts: store.proposalDrafts,
      outcomeEvents: store.outcomeEvents
    });
    store.outcomeEvents.push(event);
    store.opportunities[index] = {
      ...store.opportunities[index],
      updatedAt: event.recordedAt
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[index], store);
  });
}

async function voidOutcomeEvent(id, reason = "") {
  if (!id) throw new Error("Outcome event id is required");
  return withStorageLock(async () => {
    const store = await readStore();
    const eventIndex = store.outcomeEvents.findIndex((item) => item.id === id);
    if (eventIndex === -1) throw new Error("Outcome event not found");
    const event = store.outcomeEvents[eventIndex];
    if (event.voidedAt) throw new Error("Outcome event is already voided");
    const opportunityIndex = store.opportunities.findIndex((item) => item.id === event.opportunityId);
    if (opportunityIndex === -1) throw new Error("Opportunity not found");
    const now = new Date().toISOString();
    store.outcomeEvents[eventIndex] = {
      ...event,
      notes: reason ? `${event.notes || ""}\n[Voided reason] ${reason}`.trim() : event.notes || "",
      voidedAt: now
    };
    store.opportunities[opportunityIndex] = {
      ...store.opportunities[opportunityIndex],
      updatedAt: now
    };
    await writeStore(store);
    return hydrateOpportunity(store.opportunities[opportunityIndex], store);
  });
}

async function listOutcomeEvents(opportunityId, { includeVoided = false } = {}) {
  if (!opportunityId) throw new Error("Opportunity id is required");
  const store = await readStore();
  return getOutcomeEventsForOpportunity(opportunityId, store.outcomeEvents, { includeVoided });
}

async function getOutcomeSummary(opportunityId) {
  if (!opportunityId) throw new Error("Opportunity id is required");
  const store = await readStore();
  const opportunity = store.opportunities.find((item) => item.id === opportunityId);
  if (!opportunity) throw new Error("Opportunity not found");
  return deriveOutcomeSummary(opportunityId, store.outcomeEvents);
}

function normalizeOutcomeEventInput(input, { opportunity, proposalDrafts, outcomeEvents }) {
  const now = new Date().toISOString();
  const eventType = normalizeText(input.eventType || input.event_type);
  if (!OUTCOME_EVENT_TYPES.includes(eventType)) throw new Error(`Unsupported outcome event type: ${eventType || "(missing)"}`);
  if (eventType === OUTCOME_EVENT_TYPE.captureDetectedStatus) throw new Error("Capture detected outcome events must be created by capture");
  if (eventType === OUTCOME_EVENT_TYPE.voided) throw new Error("Use outcome:voidEvent to void an outcome event");
  const occurredAt = normalizeIsoTime(input.occurredAt || input.occurred_at || now, "occurredAt");
  const recordedAt = now;
  const payload = normalizeOutcomePayload(eventType, input.payload || {}, {
    opportunity,
    proposalDrafts,
    outcomeEvents
  });
  return {
    id: input.id || crypto.randomUUID(),
    opportunityId: opportunity.id,
    schemaVersion: SCHEMA_VERSION,
    eventType,
    occurredAt,
    recordedAt,
    source: "manual",
    snapshotId: normalizeText(input.snapshotId || input.snapshot_id) || null,
    payload,
    notes: normalizeText(input.notes),
    correctionOfEventId: normalizeText(input.correctionOfEventId || input.correction_of_event_id) || null,
    voidedAt: null
  };
}

function normalizeOutcomePayload(eventType, payload, { opportunity, proposalDrafts, outcomeEvents }) {
  if (eventType === OUTCOME_EVENT_TYPE.proposalSent) {
    const proposalDraftId = normalizeText(payload.proposalDraftId || payload.proposal_draft_id || opportunity.currentProposalDraftId);
    if (proposalDraftId && !proposalDrafts.some((item) => item.id === proposalDraftId && item.opportunityId === opportunity.id)) {
      throw new Error("Outcome proposal_sent references missing ProposalDraft");
    }
    return {
      connectsSpent: normalizeNullableNumber(payload.connectsSpent ?? payload.connects_spent),
      bidAmount: normalizeNullableNumber(payload.bidAmount ?? payload.bid_amount),
      bidCurrency: normalizeText(payload.bidCurrency || payload.bid_currency || "USD"),
      bidType: normalizeBidType(payload.bidType || payload.bid_type),
      proposalDraftId: proposalDraftId || null,
      proposalTextRevisionId: normalizeText(payload.proposalTextRevisionId || payload.proposal_text_revision_id) || null
    };
  }
  if (eventType === OUTCOME_EVENT_TYPE.correction) {
    const correctedEventId = normalizeText(payload.correctedEventId || payload.corrected_event_id);
    if (!correctedEventId || !outcomeEvents.some((item) => item.id === correctedEventId && item.opportunityId === opportunity.id)) {
      throw new Error("Outcome correction references missing event");
    }
    return {
      correctedEventId,
      correctedFields: isPlainObject(payload.correctedFields || payload.corrected_fields) ? (payload.correctedFields || payload.corrected_fields) : {},
      reason: normalizeText(payload.reason)
    };
  }
  return isPlainObject(payload) ? payload : {};
}

function getOutcomeEventsForOpportunity(opportunityId, events, { includeVoided = false } = {}) {
  return (events || [])
    .filter((item) => item.opportunityId === opportunityId)
    .filter((item) => includeVoided || !item.voidedAt)
    .sort(compareOutcomeEvents);
}

function deriveOutcomeSummary(opportunityId, events = []) {
  const activeEvents = getOutcomeEventsForOpportunity(opportunityId, events);
  const summary = {
    opportunityId,
    status: OUTCOME_STATUS.notApplied,
    appliedAt: null,
    viewedAt: null,
    repliedAt: null,
    interviewAt: null,
    hiredAt: null,
    lostAt: null,
    connectsSpent: null,
    bidAmount: null,
    bidCurrency: "",
    bidType: "",
    derivedFromEventIds: [],
    updatedAt: null
  };

  for (const event of activeEvents) {
    summary.derivedFromEventIds.push(event.id);
    summary.updatedAt = event.recordedAt || summary.updatedAt;
    const eventStatus = statusFromOutcomeEvent(event);
    if (eventStatus) {
      applyOutcomeStatus(summary, eventStatus, event.occurredAt);
      summary.status = eventStatus;
    }
    if (event.eventType === OUTCOME_EVENT_TYPE.proposalSent) {
      summary.connectsSpent = event.payload?.connectsSpent ?? summary.connectsSpent;
      summary.bidAmount = event.payload?.bidAmount ?? summary.bidAmount;
      summary.bidCurrency = event.payload?.bidCurrency || summary.bidCurrency;
      summary.bidType = event.payload?.bidType || summary.bidType;
    }
  }

  return summary;
}

function statusFromOutcomeEvent(event) {
  if (event.eventType === OUTCOME_EVENT_TYPE.markedNotApplied) return OUTCOME_STATUS.notApplied;
  if (event.eventType === OUTCOME_EVENT_TYPE.markedSkipped) return OUTCOME_STATUS.skipped;
  if (event.eventType === OUTCOME_EVENT_TYPE.proposalSent) return OUTCOME_STATUS.applied;
  if (event.eventType === OUTCOME_EVENT_TYPE.proposalViewed) return OUTCOME_STATUS.viewed;
  if (event.eventType === OUTCOME_EVENT_TYPE.clientReplied) return OUTCOME_STATUS.replied;
  if (event.eventType === OUTCOME_EVENT_TYPE.interviewStarted) return OUTCOME_STATUS.interviewing;
  if (event.eventType === OUTCOME_EVENT_TYPE.hired) return OUTCOME_STATUS.hired;
  if (event.eventType === OUTCOME_EVENT_TYPE.lost) return OUTCOME_STATUS.lost;
  if (event.eventType === OUTCOME_EVENT_TYPE.captureDetectedStatus) {
    const detectedStatus = normalizeText(event.payload?.detectedStatus || event.payload?.detected_status);
    return OUTCOME_STATUSES.includes(detectedStatus) ? detectedStatus : null;
  }
  return null;
}

function applyOutcomeStatus(summary, status, occurredAt) {
  if ([OUTCOME_STATUS.applied, OUTCOME_STATUS.viewed, OUTCOME_STATUS.replied, OUTCOME_STATUS.interviewing, OUTCOME_STATUS.hired, OUTCOME_STATUS.lost].includes(status)) {
    summary.appliedAt = summary.appliedAt || occurredAt;
  }
  if (status === OUTCOME_STATUS.viewed) summary.viewedAt = summary.viewedAt || occurredAt;
  if (status === OUTCOME_STATUS.replied) summary.repliedAt = summary.repliedAt || occurredAt;
  if (status === OUTCOME_STATUS.interviewing) summary.interviewAt = summary.interviewAt || occurredAt;
  if (status === OUTCOME_STATUS.hired) summary.hiredAt = occurredAt;
  if (status === OUTCOME_STATUS.lost) summary.lostAt = occurredAt;
}

function compareOutcomeEvents(left, right) {
  const occurredDelta = new Date(left.occurredAt || left.recordedAt) - new Date(right.occurredAt || right.recordedAt);
  if (occurredDelta !== 0) return occurredDelta;
  return new Date(left.recordedAt) - new Date(right.recordedAt);
}

function arraysEqual(left, right) {
  const leftArray = Array.isArray(left) ? left : [];
  const rightArray = Array.isArray(right) ? right : [];
  if (leftArray.length !== rightArray.length) return false;
  return leftArray.every((value, index) => value === rightArray[index]);
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

async function scoreOpportunityProfile(opportunity, profile, settings, personalContext = {}) {
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
    "Use saved user profile and portfolio only when explicitly provided below; never infer personal experience that is not saved there.",
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
    "Saved user profile JSON:",
    JSON.stringify(personalContext.myProfile || null, null, 2),
    "",
    "Saved portfolio cases JSON:",
    JSON.stringify(personalContext.portfolioCases || [], null, 2),
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

async function generateProposalDraftText({ detail, score, personalContext, selectedPortfolioCases, settings }) {
  const sourceRefSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      source_type: { type: "string", enum: [...PROPOSAL_SOURCE_TYPES] },
      source_id: { type: "string" },
      field_key: { type: "string" },
      label: { type: "string" },
      quote: { type: "string" }
    },
    required: ["source_type", "source_id", "field_key", "label", "quote"]
  };
  const proofBlockSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      source_refs: { type: "array", items: sourceRefSchema }
    },
    required: ["text", "source_refs"]
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      assumptions: { type: "array", items: { type: "string" } },
      unsupported_claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim: { type: "string" },
            reason: { type: "string" },
            source_refs: { type: "array", items: sourceRefSchema }
          },
          required: ["claim", "reason", "source_refs"]
        }
      },
      questions_to_ask: { type: "array", items: { type: "string" } },
      opening_line: { type: "string" },
      fit_summary: { type: "string" },
      relevant_proof: { type: "array", items: proofBlockSchema },
      scope_boundary: { type: "string" },
      suggested_rate_or_bid: proofBlockSchema,
      final_proposal_text: { type: "string" },
      source_refs: { type: "array", items: sourceRefSchema }
    },
    required: [
      "assumptions",
      "unsupported_claims",
      "questions_to_ask",
      "opening_line",
      "fit_summary",
      "relevant_proof",
      "scope_boundary",
      "suggested_rate_or_bid",
      "final_proposal_text",
      "source_refs"
    ]
  };

  const prompt = [
    "Generate an editable Upwork proposal draft. The extension must not write into Upwork or submit anything.",
    "Rules:",
    "- Use only the supplied Opportunity, ScoreResult, saved My Profile, selected Portfolio Cases, and Notes.",
    "- Do not invent experience, outcomes, availability, deadlines, guarantees, or client-specific facts.",
    "- If a useful claim has no source, put it in unsupported_claims instead of final_proposal_text.",
    "- Every proof claim in relevant_proof, suggested_rate_or_bid, and top-level source_refs must include source_refs.",
    "- source_type must be one of: opportunity_field, snapshot_evidence, my_profile, portfolio_case, notes, score_result.",
    "- Keep final_proposal_text concise, direct, English by default, and focused on proof, scope, and next questions.",
    "",
    `Opportunity id: ${detail.id}`,
    `Opportunity title: ${detail.title}`,
    `User notes revision: ${detail.currentNotesRevisionId || ""}`,
    `User notes: ${detail.notes || ""}`,
    "",
    "Effective extracted opportunity fields JSON:",
    JSON.stringify(detail.effectiveProfile || null, null, 2),
    "",
    "ScoreResult JSON:",
    JSON.stringify({
      id: score.id,
      totalScore: score.totalScore,
      decision: score.decision,
      decisionSummary: score.decisionSummary,
      risks: score.risks,
      missingInfoChecklist: score.missingInfoChecklist,
      recommendedBidStrategy: score.recommendedBidStrategy,
      proposalAngle: score.proposalAngle,
      dimensions: score.dimensions
    }, null, 2),
    "",
    "Saved My Profile JSON:",
    JSON.stringify(personalContext.myProfile || null, null, 2),
    "",
    "Selected Portfolio Cases JSON:",
    JSON.stringify(selectedPortfolioCases || [], null, 2),
    "",
    "Snapshot corpus:",
    buildSnapshotCorpus(detail, MAX_PROPOSAL_INPUT_CHARS)
  ].join("\n");

  return callOpenAIJson({
    apiKey: settings.apiKey,
    model: settings.proposalModel,
    reasoningEffort: settings.reasoningEffort || "low",
    prompt,
    schemaName: "upwork_proposal_draft",
    schema
  });
}

function createProposalDraftRecord({ id, opportunityId, rawDraft, model, inputProfileId, inputProfileVersion, inputScoreResultId, inputMyProfile, selectedPortfolioCases, createdAt }) {
  const normalized = normalizeRawProposalDraft(rawDraft);
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    updatedAt: createdAt,
    status: PROPOSAL_DRAFT_STATUS.generated,
    templateId: "default_direct_proof_v1",
    model,
    promptVersion: PROMPT_VERSIONS.proposalPromptVersion,
    inputProfileId: inputProfileId || null,
    inputProfileVersion: inputProfileVersion || null,
    inputScoreResultId,
    inputMyProfileId: inputMyProfile?.id || null,
    inputMyProfileVersion: inputMyProfile?.version || null,
    selectedPortfolioCaseRefs: (selectedPortfolioCases || []).map((item) => ({ id: item.id, version: item.version })),
    assumptions: normalized.assumptions,
    unsupportedClaims: normalized.unsupportedClaims,
    questionsToAsk: normalized.questionsToAsk,
    openingLine: normalized.openingLine,
    fitSummary: normalized.fitSummary,
    relevantProof: normalized.relevantProof,
    scopeBoundary: normalized.scopeBoundary,
    suggestedRateOrBid: normalized.suggestedRateOrBid,
    finalText: normalized.finalText,
    sourceRefs: normalized.sourceRefs,
    revisions: [],
    archivedAt: null
  };
}

function selectRelevantPortfolioCases({ detail, score, portfolioCases }, limit = 3) {
  const corpus = [
    detail?.title,
    detail?.notes,
    JSON.stringify(detail?.effectiveProfile || {}),
    score?.decisionSummary,
    score?.recommendedBidStrategy,
    score?.proposalAngle,
    ...(score?.risks || []),
    ...(score?.missingInfoChecklist || [])
  ].join(" ").toLowerCase();
  const corpusTokens = new Set(corpus.match(/[a-z0-9+#.-]{3,}/g) || []);

  return (portfolioCases || [])
    .filter((item) => !item.archivedAt)
    .map((item) => {
      const weightedTerms = [
        ...(item.applicableKeywords || []).map((term) => [term, 4]),
        ...(item.skillTags || []).map((term) => [term, 3]),
        [item.title, 2],
        [item.summary, 1],
        [item.outcome, 1]
      ];
      let scoreValue = 0;
      for (const [term, weight] of weightedTerms) {
        const tokens = String(term || "").toLowerCase().match(/[a-z0-9+#.-]{3,}/g) || [];
        if (!tokens.length) continue;
        if (tokens.some((token) => corpus.includes(token) || corpusTokens.has(token))) scoreValue += weight;
      }
      return { item, scoreValue };
    })
    .filter(({ scoreValue }) => scoreValue > 0)
    .sort((left, right) => {
      if (right.scoreValue !== left.scoreValue) return right.scoreValue - left.scoreValue;
      return new Date(right.item.updatedAt || right.item.createdAt) - new Date(left.item.updatedAt || left.item.createdAt);
    })
    .slice(0, limit)
    .map(({ item }) => item);
}

function validateProposalSourceRefs(draft, context) {
  for (const ref of collectProposalSourceRefs(draft)) {
    if (!PROPOSAL_SOURCE_TYPES.includes(ref.sourceType)) {
      throw new Error(`ProposalDraft ${draft.id} has unsupported sourceRef sourceType: ${ref.sourceType || "(missing)"}`);
    }
    if (!ref.sourceId) throw new Error(`ProposalDraft ${draft.id} sourceRef missing sourceId`);
    if (ref.sourceType === "opportunity_field" && ref.sourceId !== context.opportunity.id) {
      throw new Error(`ProposalDraft ${draft.id} sourceRef references missing opportunity`);
    }
    if (ref.sourceType === "snapshot_evidence" && !context.snapshotIds.includes(ref.sourceId)) {
      throw new Error(`ProposalDraft ${draft.id} sourceRef references missing snapshot`);
    }
    if (ref.sourceType === "notes" && ref.sourceId !== context.notesRevisionId) {
      throw new Error(`ProposalDraft ${draft.id} sourceRef references missing notes revision`);
    }
    if (ref.sourceType === "my_profile" && ref.sourceId !== context.myProfileId) {
      throw new Error(`ProposalDraft ${draft.id} sourceRef references missing My Profile`);
    }
    if (ref.sourceType === "portfolio_case" && !context.portfolioCaseIds.has(ref.sourceId)) {
      throw new Error(`ProposalDraft ${draft.id} sourceRef references missing selected Portfolio Case`);
    }
    if (ref.sourceType === "score_result" && ref.sourceId !== context.scoreResultId) {
      throw new Error(`ProposalDraft ${draft.id} sourceRef references missing ScoreResult`);
    }
  }
}

function collectProposalSourceRefs(draft = {}) {
  return [
    ...(draft.sourceRefs || []),
    ...flatMapSourceRefs(draft.relevantProof),
    ...flatMapSourceRefs([draft.suggestedRateOrBid]),
    ...flatMapSourceRefs(draft.unsupportedClaims)
  ].map((ref) => ({
    sourceType: normalizeText(ref.sourceType ?? ref.source_type),
    sourceId: normalizeText(ref.sourceId ?? ref.source_id),
    fieldKey: normalizeText(ref.fieldKey ?? ref.field_key),
    label: normalizeText(ref.label),
    quote: normalizeText(ref.quote)
  }));
}

function flatMapSourceRefs(items) {
  return (Array.isArray(items) ? items : [])
    .flatMap((item) => Array.isArray(item?.sourceRefs) ? item.sourceRefs : (Array.isArray(item?.source_refs) ? item.source_refs : []));
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
    fields: mapRawProfileFields(rawProfile, createdAt),
    missingFieldKeys: normalizeMissingProfileFieldKeys(rawProfile?.missing_fields),
    conflicts: [],
    reviewedAt: null,
    reviewedBy: null,
    rawProfile
  };
}

function createScoreRecord({ id, opportunityId, rawScore, model, inputSnapshotIds, inputProfileId, inputProfileVersion, notesRevisionId, profileReviewed, personalContext, createdAt }) {
  const normalized = normalizeRawScore(rawScore);
  const myProfile = personalContext?.myProfile || null;
  const portfolioCases = personalContext?.portfolioCases || [];
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
    inputMyProfileId: myProfile?.id || null,
    inputMyProfileVersion: myProfile?.version || null,
    inputPortfolioCaseRefs: portfolioCases.map((item) => ({ id: item.id, version: item.version })),
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

function hydrateOpportunity(opportunity, store) {
  const snapshots = opportunity.snapshotIds
    .map((id) => store.snapshots.find((item) => item.id === id))
    .filter(Boolean)
    .map(toLegacySnapshot);
  const score = store.scoreResults.find((item) => item.id === opportunity.currentScoreResultId) || null;
  const profile = store.opportunityProfiles.find((item) => item.id === opportunity.currentProfileId) || null;
  const proposalDraft = store.proposalDrafts.find((item) => item.id === opportunity.currentProposalDraftId) || null;
  const outcomeEvents = getOutcomeEventsForOpportunity(opportunity.id, store.outcomeEvents, { includeVoided: true });
  const outcomeSummary = deriveOutcomeSummary(opportunity.id, store.outcomeEvents);
  const notes = getCurrentNotesText(opportunity, store.noteRevisions);
  const scoreStale = Boolean(score && (score.notesRevisionId || null) !== (opportunity.currentNotesRevisionId || null));
  const proposalStale = Boolean(proposalDraft && (
    (proposalDraft.inputScoreResultId || null) !== (opportunity.currentScoreResultId || null) ||
    (proposalDraft.inputProfileId || null) !== (opportunity.currentProfileId || null)
  ));

  return {
    ...opportunity,
    snapshots,
    notes,
    profile: profile ? toProfileViewModel(profile) : null,
    effectiveProfile: profile ? buildEffectiveProfile(profile) : null,
    profileReviewed: Boolean(profile?.reviewedAt),
    profileConflicts: profile?.conflicts || [],
    extractedProfile: profile?.rawProfile || null,
    scoreStale,
    scoreResult: score ? toLegacyScoreResult(score, { scoreStale }) : null,
    proposalStale,
    proposalDraft,
    outcomeSummary,
    outcomeEvents,
    snapshotCount: snapshots.length,
    currentScore: score ? {
      id: score.id,
      totalScore: score.totalScore,
      decision: score.decision,
      decisionSummary: score.decisionSummary,
      scoreStale
    } : null
  };
}

function getCurrentNotesText(opportunity, noteRevisions) {
  const current = noteRevisions.find((item) => item.id === opportunity.currentNotesRevisionId);
  return current?.text || "";
}

function toProfileViewModel(profile) {
  return {
    ...profile,
    effectiveProfile: buildEffectiveProfile(profile),
    profileReviewed: Boolean(profile.reviewedAt)
  };
}

function toLegacySnapshot(snapshot) {
  return {
    ...snapshot,
    title: snapshot.pageTitle
  };
}

function toLegacyScoreResult(score, { scoreStale = false } = {}) {
  return {
    ...(score.rawResult || {}),
    id: score.id,
    model: score.model,
    promptVersion: score.promptVersion,
    scoreVersion: score.scoreVersion,
    inputSnapshotIds: score.inputSnapshotIds,
    inputProfileVersion: score.inputProfileVersion,
    inputMyProfileId: score.inputMyProfileId || null,
    inputMyProfileVersion: score.inputMyProfileVersion || null,
    inputPortfolioCaseRefs: score.inputPortfolioCaseRefs || [],
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
    confidence: score.confidence,
    notesRevisionId: score.notesRevisionId,
    scoreStale
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
    STORAGE_KEYS.noteRevisions,
    STORAGE_KEYS.proposalDrafts,
    STORAGE_KEYS.outcomeEvents
  ]);
  return {
    meta: data[STORAGE_KEYS.meta] || null,
    opportunities: data[STORAGE_KEYS.opportunities] || [],
    snapshots: data[STORAGE_KEYS.snapshots] || [],
    opportunityProfiles: data[STORAGE_KEYS.opportunityProfiles] || [],
    scoreResults: data[STORAGE_KEYS.scoreResults] || [],
    noteRevisions: data[STORAGE_KEYS.noteRevisions] || [],
    proposalDrafts: data[STORAGE_KEYS.proposalDrafts] || [],
    outcomeEvents: data[STORAGE_KEYS.outcomeEvents] || []
  };
}

async function writeStore(store) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.opportunities]: store.opportunities,
    [STORAGE_KEYS.snapshots]: store.snapshots,
    [STORAGE_KEYS.opportunityProfiles]: store.opportunityProfiles,
    [STORAGE_KEYS.scoreResults]: store.scoreResults,
    [STORAGE_KEYS.noteRevisions]: store.noteRevisions,
    [STORAGE_KEYS.proposalDrafts]: store.proposalDrafts || [],
    [STORAGE_KEYS.outcomeEvents]: store.outcomeEvents || []
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
  const data = await chrome.storage.local.get(MANAGED_STORAGE_KEYS);
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
  validateKnownTopLevelKeys(data);
  validateUnimplementedImportKeysAreEmpty(data);

  const opportunities = requireArray(data[STORAGE_KEYS.opportunities], STORAGE_KEYS.opportunities);
  const snapshots = requireArray(data[STORAGE_KEYS.snapshots], STORAGE_KEYS.snapshots);
  const profiles = requireArray(data[STORAGE_KEYS.opportunityProfiles], STORAGE_KEYS.opportunityProfiles);
  const scores = requireArray(data[STORAGE_KEYS.scoreResults], STORAGE_KEYS.scoreResults);
  const notes = requireArray(data[STORAGE_KEYS.noteRevisions], STORAGE_KEYS.noteRevisions);
  const myProfile = data[STORAGE_KEYS.myProfile] ?? null;
  const portfolioCases = requireArray(data[STORAGE_KEYS.portfolioCases] || [], STORAGE_KEYS.portfolioCases);
  const proposalDrafts = requireArray(data[STORAGE_KEYS.proposalDrafts] || [], STORAGE_KEYS.proposalDrafts);
  const outcomeEvents = requireArray(data[STORAGE_KEYS.outcomeEvents] || [], STORAGE_KEYS.outcomeEvents);
  validateEntityShape(opportunities, IMPORT_ENTITY_SCHEMAS.opportunity);
  validateEntityShape(snapshots, IMPORT_ENTITY_SCHEMAS.snapshot);
  validateEntityShape(profiles, IMPORT_ENTITY_SCHEMAS.opportunityProfile);
  validateEntityShape(scores, IMPORT_ENTITY_SCHEMAS.scoreResult);
  validateEntityShape(notes, IMPORT_ENTITY_SCHEMAS.noteRevision);
  validateOptionalEntityShape(myProfile, IMPORT_ENTITY_SCHEMAS.myProfile);
  validateEntityShape(portfolioCases, IMPORT_ENTITY_SCHEMAS.portfolioCase);
  validateEntityShape(proposalDrafts, IMPORT_ENTITY_SCHEMAS.proposalDraft);
  validateEntityShape(outcomeEvents, IMPORT_ENTITY_SCHEMAS.outcomeEvent);
  validateReferences({ opportunities, snapshots, profiles, scores, notes, myProfile, portfolioCases, proposalDrafts, outcomeEvents });

  return {
    schemaVersion: manifest.schemaVersion,
    entityCounts: {
      opportunities: opportunities.length,
      snapshots: snapshots.length,
      opportunityProfiles: profiles.length,
      scoreResults: scores.length,
      noteRevisions: notes.length,
      myProfile: myProfile ? 1 : 0,
      portfolioCases: portfolioCases.length,
      proposalDrafts: proposalDrafts.length,
      outcomeEvents: outcomeEvents.length
    }
  };
}

const IMPORT_ENTITY_SCHEMAS = Object.freeze({
  opportunity: {
    name: "Opportunity",
    required: ["id", "schemaVersion", "createdAt", "updatedAt", "title", "mainUrl", "platform", "status", "snapshotIds"],
    allowed: ["id", "schemaVersion", "createdAt", "updatedAt", "title", "mainUrl", "jobKey", "platform", "status", "clientRecordId", "snapshotIds", "currentProfileId", "currentScoreResultId", "currentProposalDraftId", "currentNotesRevisionId", "archivedAt"]
  },
  snapshot: {
    name: "Snapshot",
    required: ["id", "opportunityId", "schemaVersion", "createdAt", "capturedAt", "sourceUrl", "pageTitle", "pageType", "platform", "textHash", "retentionState"],
    allowed: ["id", "opportunityId", "schemaVersion", "createdAt", "capturedAt", "sourceUrl", "pageTitle", "pageType", "platform", "text", "textHash", "domSummary", "stats", "retentionState"]
  },
  opportunityProfile: {
    name: "OpportunityProfile",
    required: ["id", "opportunityId", "schemaVersion", "version", "createdAt", "updatedAt", "promptVersion", "inputSnapshotIds", "fields", "missingFieldKeys", "conflicts"],
    allowed: ["id", "opportunityId", "schemaVersion", "version", "createdAt", "updatedAt", "model", "promptVersion", "scoreVersion", "inputSnapshotIds", "fields", "missingFieldKeys", "conflicts", "reviewedAt", "reviewedBy", "rawProfile"]
  },
  scoreResult: {
    name: "ScoreResult",
    required: ["id", "opportunityId", "schemaVersion", "createdAt", "promptVersion", "scoreVersion", "inputSnapshotIds", "totalScore", "decision", "dimensions"],
    allowed: ["id", "opportunityId", "schemaVersion", "createdAt", "model", "promptVersion", "scoreVersion", "inputSnapshotIds", "inputProfileId", "inputProfileVersion", "notesRevisionId", "profileReviewed", "inputMyProfileId", "inputMyProfileVersion", "inputPortfolioCaseRefs", "totalScore", "decision", "decisionSummary", "timingPriority", "dimensions", "hardRedFlags", "risks", "missingInfoChecklist", "recommendedBidStrategy", "proposalAngle", "confidence", "archivedAt", "rawResult"]
  },
  noteRevision: {
    name: "OpportunityNoteRevision",
    required: ["id", "opportunityId", "schemaVersion", "text", "createdAt", "createdBy"],
    allowed: ["id", "opportunityId", "schemaVersion", "text", "createdAt", "createdBy"]
  },
  myProfile: {
    name: "MyProfile",
    required: ["id", "schemaVersion", "version", "createdAt", "updatedAt", "displayName", "title", "summary", "skillTags", "serviceCategories", "strengths", "preferredProjects", "rejectRules", "rateCard", "availability", "proposalPreferences", "languagePreferences"],
    allowed: ["id", "schemaVersion", "version", "createdAt", "updatedAt", "displayName", "title", "summary", "skillTags", "serviceCategories", "strengths", "preferredProjects", "rejectRules", "rateCard", "availability", "proposalPreferences", "languagePreferences", "archivedAt"]
  },
  portfolioCase: {
    name: "PortfolioCase",
    required: ["id", "schemaVersion", "version", "createdAt", "updatedAt", "title", "summary", "skillTags", "outcome", "proofPoints", "links", "applicableKeywords", "sourceRefs"],
    allowed: ["id", "schemaVersion", "version", "createdAt", "updatedAt", "title", "summary", "skillTags", "outcome", "proofPoints", "links", "applicableKeywords", "sourceRefs", "archivedAt"]
  },
  proposalDraft: {
    name: "ProposalDraft",
    required: ["id", "opportunityId", "schemaVersion", "createdAt", "updatedAt", "status", "templateId", "model", "promptVersion", "inputScoreResultId", "selectedPortfolioCaseRefs", "assumptions", "unsupportedClaims", "questionsToAsk", "openingLine", "fitSummary", "relevantProof", "scopeBoundary", "suggestedRateOrBid", "finalText", "sourceRefs", "revisions"],
    allowed: ["id", "opportunityId", "schemaVersion", "createdAt", "updatedAt", "status", "templateId", "model", "promptVersion", "inputProfileId", "inputProfileVersion", "inputScoreResultId", "inputMyProfileId", "inputMyProfileVersion", "selectedPortfolioCaseRefs", "assumptions", "unsupportedClaims", "questionsToAsk", "openingLine", "fitSummary", "relevantProof", "scopeBoundary", "suggestedRateOrBid", "finalText", "sourceRefs", "revisions", "archivedAt"]
  },
  outcomeEvent: {
    name: "OutcomeEvent",
    required: ["id", "opportunityId", "schemaVersion", "eventType", "occurredAt", "recordedAt", "source", "payload", "notes"],
    allowed: ["id", "opportunityId", "schemaVersion", "eventType", "occurredAt", "recordedAt", "source", "snapshotId", "payload", "notes", "correctionOfEventId", "voidedAt"]
  }
});

function validateKnownTopLevelKeys(data) {
  const allowedKeys = new Set(MANAGED_STORAGE_KEYS);
  for (const key of Object.keys(data)) {
    if (!allowedKeys.has(key)) throw new Error(`Unknown top-level import key: ${key}`);
  }
}

function validateUnimplementedImportKeysAreEmpty(data) {
  for (const key of UNIMPLEMENTED_IMPORT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = data[key];
    if (isEmptyUnimplementedImportValue(key, value)) continue;
    throw new Error(`${key} import is not supported yet; leave it empty or omit it`);
  }
}

function isEmptyUnimplementedImportValue(key, value) {
  if (key === STORAGE_KEYS.myProfile) return value === null || value === undefined;
  if (key === STORAGE_KEYS.analyticsCache) return value === null || value === undefined || (isPlainObject(value) && Object.keys(value).length === 0);
  return Array.isArray(value) && value.length === 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEntityShape(records, schema) {
  const allowed = new Set(schema.allowed);
  for (const record of records) {
    for (const field of schema.required) {
      if (record[field] === undefined) throw new Error(`${schema.name} ${record.id || "(missing id)"} missing required field: ${field}`);
    }
    for (const field of Object.keys(record)) {
      if (!allowed.has(field)) throw new Error(`${schema.name} ${record.id || "(missing id)"} has unknown field: ${field}`);
    }
    if (record.schemaVersion !== SCHEMA_VERSION) throw new Error(`${schema.name} ${record.id || "(missing id)"} has unsupported schemaVersion`);
  }
}

function validateOptionalEntityShape(record, schema) {
  if (record === null || record === undefined) return;
  validateEntityShape([record], schema);
}

async function importData(importPayload) {
  const preview = validateImportData(importPayload);
  return withStorageLock(async () => {
    const backupKey = await createBackup();
    const currentSettings = await getSettings();
    const importedSettings = normalizeSettings(importPayload.data[STORAGE_KEYS.settings]);
    importedSettings.apiKey = currentSettings.apiKey;
    const now = new Date().toISOString();
    await chrome.storage.local.remove(MANAGED_STORAGE_KEYS);
    await chrome.storage.local.set(buildManagedImportData({
      data: importPayload.data,
      importedSettings,
      backupKey,
      importedAt: now
    }));
    return { backupKey, preview };
  });
}

function buildManagedImportData({ data, importedSettings, backupKey, importedAt }) {
  return {
    ...createEmptyManagedImportData(),
    ...data,
    [STORAGE_KEYS.meta]: {
      schemaVersion: SCHEMA_VERSION,
      storageRevision: 1,
      importedAt,
      importMode: "replace_managed_keys",
      lastBackupAt: importedAt,
      lastBackupKey: backupKey
    },
    [STORAGE_KEYS.settings]: importedSettings
  };
}

function createEmptyManagedImportData() {
  return {
    [STORAGE_KEYS.meta]: { schemaVersion: SCHEMA_VERSION },
    [STORAGE_KEYS.settings]: normalizeSettings(),
    [STORAGE_KEYS.opportunities]: [],
    [STORAGE_KEYS.snapshots]: [],
    [STORAGE_KEYS.opportunityProfiles]: [],
    [STORAGE_KEYS.scoreResults]: [],
    [STORAGE_KEYS.noteRevisions]: [],
    [STORAGE_KEYS.myProfile]: null,
    [STORAGE_KEYS.portfolioCases]: [],
    [STORAGE_KEYS.proposalDrafts]: [],
    [STORAGE_KEYS.outcomeEvents]: [],
    [STORAGE_KEYS.clientRecords]: [],
    [STORAGE_KEYS.fieldSelectors]: [],
    [STORAGE_KEYS.analyticsCache]: {}
  };
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function validateReferences({ opportunities, snapshots, profiles, scores, notes, myProfile, portfolioCases, proposalDrafts, outcomeEvents }) {
  const opportunityIds = new Set(opportunities.map((item) => item.id));
  const snapshotIds = new Set(snapshots.map((item) => item.id));
  const profileIds = new Set(profiles.map((item) => item.id));
  const scoreIds = new Set(scores.map((item) => item.id));
  const noteIds = new Set(notes.map((item) => item.id));
  const portfolioCaseIds = new Set(portfolioCases.map((item) => item.id));
  const proposalDraftIds = new Set(proposalDrafts.map((item) => item.id));
  const outcomeEventIds = new Set(outcomeEvents.map((item) => item.id));
  for (const opportunity of opportunities) {
    for (const snapshotId of opportunity.snapshotIds || []) {
      if (!snapshotIds.has(snapshotId)) throw new Error(`Opportunity ${opportunity.id} references missing snapshot`);
    }
    if (opportunity.currentProfileId && !profileIds.has(opportunity.currentProfileId)) throw new Error(`Opportunity ${opportunity.id} references missing OpportunityProfile`);
    if (opportunity.currentScoreResultId && !scoreIds.has(opportunity.currentScoreResultId)) throw new Error(`Opportunity ${opportunity.id} references missing ScoreResult`);
    if (opportunity.currentNotesRevisionId && !noteIds.has(opportunity.currentNotesRevisionId)) throw new Error(`Opportunity ${opportunity.id} references missing notes revision`);
    if (opportunity.currentProposalDraftId && !proposalDraftIds.has(opportunity.currentProposalDraftId)) throw new Error(`Opportunity ${opportunity.id} references missing ProposalDraft`);
  }
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
  for (const draft of proposalDrafts) {
    if (!Object.values(PROPOSAL_DRAFT_STATUS).includes(draft.status)) throw new Error(`ProposalDraft ${draft.id} has unsupported status`);
    if (!opportunityIds.has(draft.opportunityId)) throw new Error(`ProposalDraft ${draft.id} references missing opportunity`);
    if (draft.inputScoreResultId && !scoreIds.has(draft.inputScoreResultId)) throw new Error(`ProposalDraft ${draft.id} references missing ScoreResult`);
    if (draft.inputProfileId && !profileIds.has(draft.inputProfileId)) throw new Error(`ProposalDraft ${draft.id} references missing OpportunityProfile`);
    if (draft.inputMyProfileId && draft.inputMyProfileId !== myProfile?.id) throw new Error(`ProposalDraft ${draft.id} references missing My Profile`);
    for (const caseRef of draft.selectedPortfolioCaseRefs || []) {
      if (!portfolioCaseIds.has(caseRef.id)) throw new Error(`ProposalDraft ${draft.id} references missing PortfolioCase`);
    }
    const opportunity = opportunities.find((item) => item.id === draft.opportunityId);
    validateProposalSourceRefs(draft, {
      opportunity,
      snapshotIds: (opportunity?.snapshotIds || []).filter((id) => snapshotIds.has(id)),
      notesRevisionId: opportunity?.currentNotesRevisionId && noteIds.has(opportunity.currentNotesRevisionId) ? opportunity.currentNotesRevisionId : null,
      profileId: draft.inputProfileId || null,
      scoreResultId: draft.inputScoreResultId || null,
      myProfileId: draft.inputMyProfileId || null,
      portfolioCaseIds: new Set((draft.selectedPortfolioCaseRefs || []).map((item) => item.id))
    });
  }
  for (const event of outcomeEvents) {
    if (!OUTCOME_EVENT_TYPES.includes(event.eventType)) throw new Error(`OutcomeEvent ${event.id} has unsupported eventType`);
    if (!OUTCOME_EVENT_SOURCES.includes(event.source)) throw new Error(`OutcomeEvent ${event.id} has unsupported source`);
    if (!opportunityIds.has(event.opportunityId)) throw new Error(`OutcomeEvent ${event.id} references missing opportunity`);
    if (event.snapshotId && !snapshotIds.has(event.snapshotId)) throw new Error(`OutcomeEvent ${event.id} references missing snapshot`);
    if (event.correctionOfEventId && !outcomeEventIds.has(event.correctionOfEventId)) throw new Error(`OutcomeEvent ${event.id} references missing corrected event`);
    if (event.eventType === OUTCOME_EVENT_TYPE.proposalSent) {
      const proposalDraftId = event.payload?.proposalDraftId || event.payload?.proposal_draft_id;
      if (proposalDraftId && !proposalDraftIds.has(proposalDraftId)) throw new Error(`OutcomeEvent ${event.id} references missing ProposalDraft`);
      if (proposalDraftId && proposalDrafts.find((item) => item.id === proposalDraftId)?.opportunityId !== event.opportunityId) throw new Error(`OutcomeEvent ${event.id} references ProposalDraft from another opportunity`);
    }
    if (event.eventType === OUTCOME_EVENT_TYPE.captureDetectedStatus) {
      const detectedStatus = event.payload?.detectedStatus || event.payload?.detected_status;
      if (!OUTCOME_STATUSES.includes(detectedStatus)) throw new Error(`OutcomeEvent ${event.id} has unsupported detectedStatus`);
    }
  }
}

function countExportEntities(data) {
  return {
    opportunities: (data[STORAGE_KEYS.opportunities] || []).length,
    snapshots: (data[STORAGE_KEYS.snapshots] || []).length,
    opportunityProfiles: (data[STORAGE_KEYS.opportunityProfiles] || []).length,
    scoreResults: (data[STORAGE_KEYS.scoreResults] || []).length,
    noteRevisions: (data[STORAGE_KEYS.noteRevisions] || []).length,
    myProfile: data[STORAGE_KEYS.myProfile] ? 1 : 0,
    portfolioCases: (data[STORAGE_KEYS.portfolioCases] || []).length,
    proposalDrafts: (data[STORAGE_KEYS.proposalDrafts] || []).length,
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
