import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  OPPORTUNITY_STATUS,
  PLAN_VERSION,
  PLATFORM_HOSTS,
  PROMPT_VERSIONS,
  SCHEMA_VERSION,
  SNAPSHOT_RETENTION_STATE,
  STORAGE_KEYS
} from "../src/shared/schema.js";
import { mapRawProfileFields, normalizeRawScore } from "../src/shared/adapters.js";

const jsFiles = [
  "src/shared/schema.js",
  "src/shared/adapters.js",
  "src/background/background.js",
  "src/popup/popup.js",
  "src/options/options.js",
  "src/sidepanel/sidepanel.js"
];
let backgroundImportCounter = 0;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
assert.equal(manifest.version, PLAN_VERSION);
for (const file of jsFiles) {
  execFileSync("node", ["--check", file], { stdio: "pipe" });
}

assert.equal(SCHEMA_VERSION, 1);
assert.equal(DEFAULT_SETTINGS.captureMode, "strict_upwork");
assert.equal(PLATFORM_HOSTS.upwork, "www.upwork.com");
assert.equal(PLAN_VERSION, "0.2.0");
assert.equal(OPPORTUNITY_STATUS.draft, "draft");
assert.equal(OPPORTUNITY_STATUS.captured, "captured");
assert.equal(SNAPSHOT_RETENTION_STATE.deletedReferenceOnly, "deleted_reference_only");
assert.equal(PROMPT_VERSIONS.scoreRuleVersion, "score_rules_v1");
assert.equal(STORAGE_KEYS.snapshots, "uosc_snapshots");
assert.equal(STORAGE_KEYS.noteRevisions, "uosc_note_revisions");

const fakeProfile = {
  title: "Chrome extension engineer",
  job_description_summary: "Build an MV3 extension",
  required_skills: ["JavaScript", "Chrome MV3"],
  budget: "$500",
  proposal_count: "5 to 10",
  raw_evidence: ["Budget: $500"],
  missing_fields: ["client_hire_rate"]
};
const mappedProfile = mapRawProfileFields(fakeProfile, "2026-05-06T00:00:00.000Z");
assert.equal(mappedProfile.jobTitle.value, "Chrome extension engineer");
assert.equal(mappedProfile.descriptionSummary.value, "Build an MV3 extension");
assert.equal(mappedProfile.requiredSkills.value.length, 2);
assert.equal(mappedProfile.proposalCountText.value, "5 to 10");
assert.equal(mappedProfile.job_description_summary, undefined);

const fakeScore = {
  total_score: 125,
  decision: "targeted_apply",
  decision_summary: "Good fit",
  hard_red_flags: ["none"],
  missing_info_checklist: ["timeline"],
  recommended_bid_strategy: "Bid fixed",
  proposal_angle: "Lead with extension proof",
  confidence: 1.5,
  dimensions: [{ key: "fit", score: 20, max_score: 15, confidence: 2 }]
};
const normalizedScore = normalizeRawScore(fakeScore);
assert.equal(normalizedScore.total_score, 100);
assert.equal(normalizedScore.confidence, 1);
assert.equal(normalizedScore.dimensions[0].score, 15);

const sourceFiles = [
  "manifest.json",
  ...jsFiles,
  "src/popup/popup.html",
  "src/options/options.html",
  "src/sidepanel/sidepanel.html"
];
const source = sourceFiles.map((file) => `\n--- ${file} ---\n${readFileSync(file, "utf8")}`).join("\n");

const forbiddenPatterns = [
  /\bsetInterval\s*\(/,
  /chrome\.alarms\b/,
  /chrome\.tabs\.(create|update)\s*\(/,
  /\.submit\s*\(/,
  /\bdispatchEvent\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bwebRequest\b/,
  /api\.upwork/i
];

for (const pattern of forbiddenPatterns) {
  assert.equal(pattern.test(source), false, `Forbidden pattern found: ${pattern}`);
}

const background = readFileSync("src/background/background.js", "utf8");
assert.match(background, /hostname !== PLATFORM_HOSTS\.upwork/);
assert.doesNotMatch(background, /includes\(["']upwork\.com["']\)/);
assert.match(background, /setAccessLevel/);
assert.match(background, /opportunities:listSummary/);
assert.match(background, /opportunities:archive/);
assert.match(background, /not_applicable/);
assert.match(background, /validateKnownTopLevelKeys/);
assert.match(background, /validateEntityShape/);
assert.match(readFileSync("src/shared/schema.js", "utf8"), /uosc_proposal_drafts/);

const sendBackgroundMessage = await loadBackgroundForValidation();
const validImportPayload = {
  manifest: {
    app: "UpworkHelper",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: "2026-05-06T00:00:00.000Z",
    excludes: ["settings.apiKey"]
  },
  data: {
    [STORAGE_KEYS.meta]: { schemaVersion: SCHEMA_VERSION },
    [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, apiKey: "" },
    [STORAGE_KEYS.opportunities]: [],
    [STORAGE_KEYS.snapshots]: [],
    [STORAGE_KEYS.opportunityProfiles]: [],
    [STORAGE_KEYS.scoreResults]: [],
    [STORAGE_KEYS.noteRevisions]: []
  }
};
const validPreview = await sendBackgroundMessage({ type: "data:importPreview", data: validImportPayload });
assert.equal(validPreview.ok, true);
assert.equal(validPreview.preview.entityCounts.opportunities, 0);

const unknownTopLevel = structuredClone(validImportPayload);
unknownTopLevel.data.uosc_unknown = [];
const unknownTopLevelPreview = await sendBackgroundMessage({ type: "data:importPreview", data: unknownTopLevel });
assert.equal(unknownTopLevelPreview.ok, false);
assert.match(unknownTopLevelPreview.error, /Unknown top-level import key/);

const missingRequired = structuredClone(validImportPayload);
missingRequired.data[STORAGE_KEYS.opportunities] = [{
  id: "opp_missing_title",
  schemaVersion: SCHEMA_VERSION,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  mainUrl: "https://www.upwork.com/jobs/example",
  platform: "upwork",
  status: "captured",
  snapshotIds: []
}];
const missingRequiredPreview = await sendBackgroundMessage({ type: "data:importPreview", data: missingRequired });
assert.equal(missingRequiredPreview.ok, false);
assert.match(missingRequiredPreview.error, /missing required field: title/);

const missingReference = structuredClone(validImportPayload);
missingReference.data[STORAGE_KEYS.snapshots] = [{
  id: "snap_missing_opp",
  opportunityId: "missing_opp",
  schemaVersion: SCHEMA_VERSION,
  createdAt: "2026-05-06T00:00:00.000Z",
  capturedAt: "2026-05-06T00:00:00.000Z",
  sourceUrl: "https://www.upwork.com/jobs/example",
  pageTitle: "Example",
  pageType: "job_detail",
  platform: "upwork",
  text: "",
  textHash: "hash",
  domSummary: {},
  stats: {},
  retentionState: "full"
}];
const missingReferencePreview = await sendBackgroundMessage({ type: "data:importPreview", data: missingReference });
assert.equal(missingReferencePreview.ok, false);
assert.match(missingReferencePreview.error, /references missing opportunity/);

const unsupportedFutureEntity = structuredClone(validImportPayload);
unsupportedFutureEntity.data[STORAGE_KEYS.proposalDrafts] = [{ id: "draft_1" }];
const unsupportedFutureEntityPreview = await sendBackgroundMessage({ type: "data:importPreview", data: unsupportedFutureEntity });
assert.equal(unsupportedFutureEntityPreview.ok, false);
assert.match(unsupportedFutureEntityPreview.error, /import is not supported yet/);

sendBackgroundMessage.storageData[STORAGE_KEYS.settings] = { ...DEFAULT_SETTINGS, apiKey: "local-secret" };
sendBackgroundMessage.storageData[STORAGE_KEYS.opportunities] = [{
  id: "opp_stale",
  schemaVersion: SCHEMA_VERSION,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  title: "Stale opportunity",
  mainUrl: "https://www.upwork.com/jobs/stale",
  platform: "upwork",
  status: "captured",
  snapshotIds: []
}];
sendBackgroundMessage.storageData[STORAGE_KEYS.proposalDrafts] = [{ id: "stale_future_entity" }];
const importCommit = await sendBackgroundMessage({ type: "data:importCommit", data: validImportPayload });
assert.equal(importCommit.ok, true);
const importBackup = sendBackgroundMessage.storageData[importCommit.result.backupKey];
assert.ok(importBackup);
assert.equal(importBackup.data[STORAGE_KEYS.opportunities][0].id, "opp_stale");
assert.equal(importBackup.data[STORAGE_KEYS.proposalDrafts][0].id, "stale_future_entity");
assert.equal(sendBackgroundMessage.storageData[STORAGE_KEYS.settings].apiKey, "local-secret");
assert.equal(sendBackgroundMessage.storageData[STORAGE_KEYS.opportunities].length, 0);
assert.equal(sendBackgroundMessage.storageData[STORAGE_KEYS.proposalDrafts].length, 0);
assert.equal(sendBackgroundMessage.storageData[STORAGE_KEYS.meta].importMode, "replace_managed_keys");

await runSettingsExportBackupTests();
await runMigrationTests();
await runCaptureTests();
await runSnapshotRetentionTests();
await runArchiveRestoreDeleteTests();
await runNotesStaleTests();
await runScoreTests();

console.log("v0.2 validation passed");

async function runSettingsExportBackupTests() {
  const harness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.opportunities]: [makeOpportunity("opp_export", { snapshotIds: ["snap_export"] })],
      [STORAGE_KEYS.snapshots]: [makeSnapshot("snap_export", "opp_export")]
    }
  });

  const saved = await harness({
    type: "settings:save",
    settings: {
      apiKey: "  local-secret  ",
      extractModel: " gpt-5-mini ",
      scoreModel: " gpt-5.2 "
    }
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.apiKey, "local-secret");

  const loaded = await harness({ type: "settings:get" });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.settings.apiKey, "local-secret");

  const exported = await harness({ type: "data:export" });
  assert.equal(exported.ok, true);
  assert.equal(exported.exportData.manifest.entityCounts.opportunities, 1);
  assert.equal(exported.exportData.manifest.entityCounts.snapshots, 1);
  assert.equal(exported.exportData.data[STORAGE_KEYS.settings].apiKey, "");
  assert.equal(JSON.stringify(exported.exportData).includes("local-secret"), false);

  const backup = await harness({ type: "data:createBackup" });
  assert.equal(backup.ok, true);
  assert.ok(harness.storageData[backup.backupKey]);
  assert.equal(harness.storageData[backup.backupKey].data[STORAGE_KEYS.settings].apiKey, "local-secret");
  assert.equal(harness.storageData[STORAGE_KEYS.meta].lastBackupKey, backup.backupKey);
}

async function runMigrationTests() {
  const legacyOpportunities = [
    {
      id: "legacy_scored",
      title: "Legacy scored job",
      mainUrl: "https://www.upwork.com/jobs/details/legacy-scored",
      status: "draft",
      snapshots: [{
        id: "legacy_snap_scored",
        text: "Legacy captured text",
        capturedAt: "2026-05-06T00:00:00.000Z",
        sourceUrl: "https://www.upwork.com/jobs/details/legacy-scored",
        pageTitle: "Legacy scored job"
      }],
      extractedProfile: fakeProfile,
      scoreResult: fakeScore,
      notes: "legacy notes"
    },
    {
      id: "legacy_captured",
      title: "Legacy captured job",
      mainUrl: "https://www.upwork.com/jobs/details/legacy-captured",
      status: "draft",
      snapshots: [{
        id: "legacy_snap_captured",
        text: "Legacy captured without score",
        capturedAt: "2026-05-06T00:00:00.000Z",
        sourceUrl: "https://www.upwork.com/jobs/details/legacy-captured",
        pageTitle: "Legacy captured job"
      }]
    }
  ];
  const harness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.meta]: undefined,
      [STORAGE_KEYS.opportunities]: legacyOpportunities
    }
  });

  const migrated = await harness({ type: "opportunities:listSummary" });
  assert.equal(migrated.ok, true);
  assert.equal(harness.storageData[STORAGE_KEYS.meta].schemaVersion, SCHEMA_VERSION);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities].length, 2);
  assert.equal(harness.storageData[STORAGE_KEYS.snapshots].length, 2);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.noteRevisions].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities].find((item) => item.id === "legacy_scored").status, OPPORTUNITY_STATUS.scored);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities].find((item) => item.id === "legacy_captured").status, OPPORTUNITY_STATUS.captured);
  assert.ok(Object.keys(harness.storageData).some((key) => key.startsWith("uosc_backup_v0_to_v1_")));

  await harness({ type: "opportunities:listSummary" });
  assert.equal(harness.storageData[STORAGE_KEYS.snapshots].length, 2);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.noteRevisions].length, 1);
}

async function runCaptureTests() {
  const harness = await loadBackgroundForValidation();
  harness.setActiveTab({ id: 1, url: "http://www.upwork.com/jobs/details/job-a", title: "Insecure Upwork" });
  harness.setCaptureResult(makeCaptureResult("https://www.upwork.com/jobs/details/job-a", "Job A", "Readable text"));
  const insecure = await harness({ type: "capture:currentPage" });
  assert.equal(insecure.ok, false);
  assert.match(insecure.error, /limited to https:\/\/www\.upwork\.com/);

  harness.setActiveTab({ id: 1, url: "https://www.upwork.com/jobs/details/job-a", title: "Job A" });
  harness.setCaptureResult(makeCaptureResult("https://www.upwork.com/jobs/details/job-a", "Job A", ""));
  const empty = await harness({ type: "capture:currentPage" });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /No readable page text/);

  harness.setCaptureResult(makeCaptureResult("https://www.upwork.com/jobs/details/job-a", "Job A - Upwork", "Build a Chrome MV3 extension"));
  const firstCapture = await harness({ type: "capture:currentPage" });
  assert.equal(firstCapture.ok, true);
  const opportunityId = firstCapture.opportunity.id;
  assert.equal(firstCapture.opportunity.status, OPPORTUNITY_STATUS.captured);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.snapshots].length, 1);

  const list = await harness({ type: "opportunities:listSummary" });
  assert.equal(list.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(list.opportunities[0], "snapshots"), false);
  assert.equal(JSON.stringify(list.opportunities).includes("Build a Chrome MV3 extension"), false);

  const detail = await harness({ type: "opportunities:get", id: opportunityId });
  assert.equal(detail.ok, true);
  assert.match(detail.opportunity.snapshots[0].text, /Chrome MV3/);

  harness.setCaptureResult(makeCaptureResult("https://www.upwork.com/jobs/details/job-a", "Job A second", "Second capture text"));
  const secondCapture = await harness({ type: "capture:currentPage" });
  assert.equal(secondCapture.ok, true);
  assert.equal(secondCapture.opportunity.id, opportunityId);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities][0].snapshotIds.length, 2);

  harness.setActiveTab({ id: 1, url: "https://www.upwork.com/jobs/details/job-b", title: "Job B" });
  harness.setCaptureResult(makeCaptureResult("https://www.upwork.com/jobs/details/job-b", "Job B", "Different job text"));
  const mismatch = await harness({ type: "capture:currentPage", opportunityId });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /different Upwork job/);

  await harness({ type: "opportunities:archive", id: opportunityId });
  harness.setActiveTab({ id: 1, url: "https://www.upwork.com/jobs/details/job-a", title: "Job A" });
  harness.setCaptureResult(makeCaptureResult("https://www.upwork.com/jobs/details/job-a", "Job A", "Archived text"));
  const archived = await harness({ type: "capture:currentPage", opportunityId });
  assert.equal(archived.ok, false);
  assert.match(archived.error, /Archived opportunities/);
}

async function runSnapshotRetentionTests() {
  const longText = "Long snapshot text. ".repeat(180);
  const shortText = "Short snapshot text.";
  const harness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.opportunities]: [
        makeOpportunity("opp_retention", { snapshotIds: ["snap_long", "snap_short"] })
      ],
      [STORAGE_KEYS.snapshots]: [
        makeSnapshot("snap_long", "opp_retention", {
          text: longText,
          textHash: "original_long_hash",
          stats: { charCount: longText.length, capturedCharCount: longText.length }
        }),
        makeSnapshot("snap_short", "opp_retention", {
          text: shortText,
          textHash: "original_short_hash",
          stats: { charCount: shortText.length, capturedCharCount: shortText.length }
        })
      ]
    }
  });

  const summary = await harness({ type: "snapshots:getRetentionSummary" });
  assert.equal(summary.ok, true);
  assert.equal(summary.summary.totalSnapshots, 2);
  assert.equal(summary.summary.snapshotsWithText, 2);
  assert.equal(summary.summary.compactableCount, 1);
  assert.equal(summary.summary.counts.full, 2);

  const compact = await harness({ type: "snapshots:compactText" });
  assert.equal(compact.ok, true);
  assert.equal(compact.result.updatedCount, 1);
  assert.ok(compact.result.backupKey);
  assert.equal(harness.storageData[compact.result.backupKey].data[STORAGE_KEYS.snapshots][0].text, longText);
  const compacted = harness.storageData[STORAGE_KEYS.snapshots].find((item) => item.id === "snap_long");
  assert.equal(compacted.retentionState, SNAPSHOT_RETENTION_STATE.compacted);
  assert.ok(compacted.text.length < longText.length);
  assert.equal(compacted.stats.originalTextCharCount, longText.length);
  assert.equal(compacted.stats.originalTextHash, "original_long_hash");
  assert.notEqual(compacted.textHash, "original_long_hash");

  const redact = await harness({ type: "snapshots:redactText" });
  assert.equal(redact.ok, true);
  assert.equal(redact.result.updatedCount, 2);
  assert.ok(redact.result.backupKey);
  for (const snapshot of harness.storageData[STORAGE_KEYS.snapshots]) {
    assert.equal(snapshot.text, "");
    assert.equal(snapshot.retentionState, SNAPSHOT_RETENTION_STATE.redacted);
    assert.ok(snapshot.stats.redactedAt);
  }
  const redactedSummary = await harness({ type: "snapshots:getRetentionSummary" });
  assert.equal(redactedSummary.summary.snapshotsWithText, 0);
  assert.equal(redactedSummary.summary.counts.redacted, 2);
}

async function runArchiveRestoreDeleteTests() {
  const harness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.opportunities]: [
        makeOpportunity("opp_delete", {
          status: OPPORTUNITY_STATUS.scored,
          snapshotIds: ["snap_delete"],
          currentProfileId: "profile_delete",
          currentScoreResultId: "score_delete",
          currentNotesRevisionId: "note_delete"
        }),
        makeOpportunity("opp_keep", {
          snapshotIds: ["snap_keep"],
          currentProfileId: "profile_keep",
          currentScoreResultId: "score_keep",
          currentNotesRevisionId: "note_keep"
        })
      ],
      [STORAGE_KEYS.snapshots]: [
        makeSnapshot("snap_delete", "opp_delete"),
        makeSnapshot("snap_keep", "opp_keep")
      ],
      [STORAGE_KEYS.opportunityProfiles]: [
        makeProfile("profile_delete", "opp_delete"),
        makeProfile("profile_keep", "opp_keep")
      ],
      [STORAGE_KEYS.scoreResults]: [
        makeScore("score_delete", "opp_delete", { inputProfileId: "profile_delete", notesRevisionId: "note_delete" }),
        makeScore("score_keep", "opp_keep", { inputProfileId: "profile_keep", notesRevisionId: "note_keep" })
      ],
      [STORAGE_KEYS.noteRevisions]: [
        makeNote("note_delete", "opp_delete", "delete note"),
        makeNote("note_keep", "opp_keep", "keep note")
      ]
    }
  });

  const archive = await harness({ type: "opportunities:archive", id: "opp_delete" });
  assert.equal(archive.ok, true);
  const archivedList = await harness({ type: "opportunities:listSummary" });
  assert.equal(archivedList.opportunities.some((item) => item.id === "opp_delete"), false);

  const restore = await harness({ type: "opportunities:restore", id: "opp_delete" });
  assert.equal(restore.ok, true);
  assert.equal(restore.opportunity.status, OPPORTUNITY_STATUS.scored);

  const permanentDelete = await harness({ type: "opportunities:deletePermanent", id: "opp_delete" });
  assert.equal(permanentDelete.ok, true);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities].some((item) => item.id === "opp_delete"), false);
  assert.equal(harness.storageData[STORAGE_KEYS.snapshots].some((item) => item.opportunityId === "opp_delete"), false);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].some((item) => item.opportunityId === "opp_delete"), false);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults].some((item) => item.opportunityId === "opp_delete"), false);
  assert.equal(harness.storageData[STORAGE_KEYS.noteRevisions].some((item) => item.opportunityId === "opp_delete"), false);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities].some((item) => item.id === "opp_keep"), true);
  assert.equal(harness.storageData[STORAGE_KEYS.snapshots].some((item) => item.opportunityId === "opp_keep"), true);
}

async function runNotesStaleTests() {
  const harness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.opportunities]: [makeOpportunity("opp_notes")]
    }
  });

  const firstNotes = await harness({ type: "opportunities:updateNotes", id: "opp_notes", notes: "first note" });
  assert.equal(firstNotes.ok, true);
  const firstNoteId = harness.storageData[STORAGE_KEYS.noteRevisions][0].id;
  harness.storageData[STORAGE_KEYS.scoreResults] = [
    makeScore("score_notes", "opp_notes", { notesRevisionId: firstNoteId })
  ];
  harness.storageData[STORAGE_KEYS.opportunities][0].currentScoreResultId = "score_notes";
  let detail = await harness({ type: "opportunities:get", id: "opp_notes" });
  assert.equal(detail.opportunity.scoreStale, false);
  assert.equal(detail.opportunity.scoreResult.scoreStale, false);

  const secondNotes = await harness({ type: "notes:update", opportunityId: "opp_notes", notes: "second note" });
  assert.equal(secondNotes.ok, true);
  assert.equal(harness.storageData[STORAGE_KEYS.noteRevisions].length, 2);
  detail = await harness({ type: "opportunities:get", id: "opp_notes" });
  assert.equal(detail.opportunity.notes, "second note");
  assert.equal(detail.opportunity.scoreStale, true);
  assert.equal(detail.opportunity.currentScore.scoreStale, true);
  assert.equal(detail.opportunity.scoreResult.scoreStale, true);
}

async function runScoreTests() {
  let harness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.opportunities]: [makeOpportunity("opp_no_key", { snapshotIds: ["snap_no_key"] })],
      [STORAGE_KEYS.snapshots]: [makeSnapshot("snap_no_key", "opp_no_key")]
    }
  });
  const noApiKey = await harness({ type: "score:opportunity", opportunityId: "opp_no_key" });
  assert.equal(noApiKey.ok, false);
  assert.match(noApiKey.error, /API key is missing/);

  harness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, apiKey: "key" },
      [STORAGE_KEYS.opportunities]: [makeOpportunity("opp_no_snapshots")]
    }
  });
  const noSnapshots = await harness({ type: "score:opportunity", opportunityId: "opp_no_snapshots" });
  assert.equal(noSnapshots.ok, false);
  assert.match(noSnapshots.error, /No snapshots captured/);

  harness = await loadBackgroundForValidation({
    fetchResponses: [openAIText(fakeProfile), openAIText(fakeScore)],
    storageData: makeScoreStorageData("opp_score")
  });
  const scored = await harness({ type: "score:opportunity", opportunityId: "opp_score" });
  assert.equal(scored.ok, true);
  assert.equal(scored.opportunity.status, OPPORTUNITY_STATUS.scored);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults].length, 1);
  assert.equal(scored.opportunity.scoreResult.total_score, 100);
  assert.equal(scored.opportunity.scoreResult.dimensions[0].score, 15);
  assert.equal(scored.opportunity.scoreResult.confidence, 1);

  harness = await loadBackgroundForValidation({
    fetchResponses: [openAIText("{not valid json")],
    storageData: makeScoreStorageData("opp_invalid_json")
  });
  const invalidJson = await harness({ type: "score:opportunity", opportunityId: "opp_invalid_json" });
  assert.equal(invalidJson.ok, false);
  assert.match(invalidJson.error, /invalid JSON/);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 0);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults].length, 0);

  harness = await loadBackgroundForValidation({
    fetchResponses: [openAIText(fakeProfile), openAIError("score failed")],
    storageData: makeScoreStorageData("opp_http_error")
  });
  const httpError = await harness({ type: "score:opportunity", opportunityId: "opp_http_error" });
  assert.equal(httpError.ok, false);
  assert.match(httpError.error, /score failed/);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 0);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults].length, 0);

  const profileDeferred = deferred();
  harness = await loadBackgroundForValidation({
    fetchResponses: [profileDeferred.promise, openAIText(fakeScore)],
    storageData: makeScoreStorageData("opp_lock")
  });
  const scoring = harness({ type: "score:opportunity", opportunityId: "opp_lock" });
  await waitUntil(() => harness.fetchCalls.length === 1);
  const notesWhileScoring = harness({ type: "notes:update", opportunityId: "opp_lock", notes: "changed while scoring" });
  const notesResult = await Promise.race([notesWhileScoring, delay(100).then(() => null)]);
  assert.ok(notesResult, "notes update should not wait for OpenAI fetch");
  assert.equal(notesResult.ok, true);
  profileDeferred.resolve(openAIText(fakeProfile));
  const staleScore = await scoring;
  assert.equal(staleScore.ok, false);
  assert.match(staleScore.error, /changed while scoring/);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 0);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults].length, 0);

  const archivedDeferred = deferred();
  harness = await loadBackgroundForValidation({
    fetchResponses: [archivedDeferred.promise, openAIText(fakeScore)],
    storageData: makeScoreStorageData("opp_archive_during_score")
  });
  const scoringArchived = harness({ type: "score:opportunity", opportunityId: "opp_archive_during_score" });
  await waitUntil(() => harness.fetchCalls.length === 1);
  const archivedDuringScore = await harness({ type: "opportunities:archive", id: "opp_archive_during_score" });
  assert.equal(archivedDuringScore.ok, true);
  archivedDeferred.resolve(openAIText(fakeProfile));
  const archivedScore = await scoringArchived;
  assert.equal(archivedScore.ok, false);
  assert.match(archivedScore.error, /changed while scoring/);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities][0].status, OPPORTUNITY_STATUS.archived);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 0);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults].length, 0);
}

async function loadBackgroundForValidation(options = {}) {
  let handler = null;
  const storageData = {
    ...createDefaultStorageData(),
    ...(options.storageData || {})
  };
  let activeTab = options.activeTab || { id: 1, url: "https://www.upwork.com/jobs/details/default-job", title: "Default job - Upwork" };
  let captureResult = options.captureResult || makeCaptureResult(activeTab.url, activeTab.title, "Default readable Upwork text");
  const fetchQueue = [...(options.fetchResponses || [])];
  const fetchCalls = [];

  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    const next = fetchQueue.shift();
    if (next === undefined) throw new Error("Unexpected fetch call");
    const responseConfig = typeof next === "function" ? await next({ url, init }) : await next;
    return makeFetchResponse(responseConfig);
  };
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          handler = listener;
        }
      }
    },
    sidePanel: {
      setPanelBehavior() {
        return Promise.resolve();
      }
    },
    storage: {
      local: {
        QUOTA_BYTES: 10 * 1024 * 1024,
        async get(keys) {
          if (keys === null) return clone(storageData);
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys
                .filter((key) => Object.prototype.hasOwnProperty.call(storageData, key))
                .map((key) => [key, clone(storageData[key])])
            );
          }
          if (typeof keys === "string") return { [keys]: clone(storageData[keys]) };
          return {};
        },
        async set(values) {
          Object.assign(storageData, clone(values));
        },
        async remove(keys) {
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const key of keyList) delete storageData[key];
        },
        async getBytesInUse() {
          return JSON.stringify(storageData).length;
        },
        async setAccessLevel() {}
      }
    },
    scripting: {
      async executeScript() {
        const result = typeof captureResult === "function" ? await captureResult() : captureResult;
        return [{ result }];
      }
    },
    tabs: {
      async query() {
        return activeTab ? [activeTab] : [];
      }
    }
  };

  backgroundImportCounter += 1;
  await import(`../src/background/background.js?validate=${Date.now()}_${backgroundImportCounter}`);
  assert.ok(handler, "background onMessage handler not registered");
  const sendMessage = (message) => new Promise((resolve) => handler(message, {}, resolve));
  sendMessage.storageData = storageData;
  sendMessage.fetchCalls = fetchCalls;
  sendMessage.setActiveTab = (tab) => {
    activeTab = tab;
  };
  sendMessage.setCaptureResult = (result) => {
    captureResult = result;
  };
  sendMessage.pushFetchResponse = (response) => {
    fetchQueue.push(response);
  };
  return sendMessage;
}

function createDefaultStorageData() {
  return {
    [STORAGE_KEYS.meta]: { schemaVersion: SCHEMA_VERSION },
    [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS },
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

function makeOpportunity(id, overrides = {}) {
  const now = "2026-05-06T00:00:00.000Z";
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    title: `Opportunity ${id}`,
    mainUrl: `https://www.upwork.com/jobs/details/${id}`,
    jobKey: id,
    platform: "upwork",
    status: OPPORTUNITY_STATUS.captured,
    clientRecordId: null,
    snapshotIds: [],
    currentProfileId: null,
    currentScoreResultId: null,
    currentProposalDraftId: null,
    currentNotesRevisionId: null,
    archivedAt: null,
    ...overrides
  };
}

function makeSnapshot(id, opportunityId, overrides = {}) {
  const now = "2026-05-06T00:00:00.000Z";
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    capturedAt: now,
    sourceUrl: `https://www.upwork.com/jobs/details/${opportunityId}`,
    pageTitle: `Snapshot ${id}`,
    pageType: "job_detail",
    platform: "upwork",
    text: "Captured opportunity text",
    textHash: `hash_${id}`,
    domSummary: [],
    stats: { charCount: 25, capturedCharCount: 25 },
    retentionState: SNAPSHOT_RETENTION_STATE.full,
    ...overrides
  };
}

function makeProfile(id, opportunityId, overrides = {}) {
  const now = "2026-05-06T00:00:00.000Z";
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    version: 1,
    createdAt: now,
    updatedAt: now,
    model: "gpt-5-mini",
    promptVersion: PROMPT_VERSIONS.extractPromptVersion,
    scoreVersion: "not_applicable",
    inputSnapshotIds: [`snap_${opportunityId}`],
    fields: {},
    missingFieldKeys: [],
    conflicts: [],
    reviewedAt: null,
    reviewedBy: null,
    rawProfile: fakeProfile,
    ...overrides
  };
}

function makeScore(id, opportunityId, overrides = {}) {
  const now = "2026-05-06T00:00:00.000Z";
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    model: "gpt-5.2",
    promptVersion: PROMPT_VERSIONS.scorePromptVersion,
    scoreVersion: PROMPT_VERSIONS.scoreRuleVersion,
    inputSnapshotIds: [`snap_${opportunityId}`],
    inputProfileId: null,
    inputProfileVersion: null,
    notesRevisionId: null,
    profileReviewed: false,
    totalScore: 82,
    decision: "strong_apply",
    decisionSummary: "Strong fit",
    timingPriority: "high",
    dimensions: [],
    hardRedFlags: [],
    risks: [],
    missingInfoChecklist: [],
    recommendedBidStrategy: "Bid normally",
    proposalAngle: "Lead with extension experience",
    confidence: 0.8,
    archivedAt: null,
    rawResult: { ...fakeScore, total_score: 82 },
    ...overrides
  };
}

function makeNote(id, opportunityId, text) {
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    text,
    createdAt: "2026-05-06T00:00:00.000Z",
    createdBy: "user"
  };
}

function makeCaptureResult(url, title, text) {
  return {
    title,
    url,
    text,
    domSummary: [],
    stats: {
      charCount: text.length,
      capturedCharCount: text.length
    }
  };
}

function makeScoreStorageData(opportunityId) {
  return {
    [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, apiKey: "key" },
    [STORAGE_KEYS.opportunities]: [makeOpportunity(opportunityId, { snapshotIds: [`snap_${opportunityId}`] })],
    [STORAGE_KEYS.snapshots]: [makeSnapshot(`snap_${opportunityId}`, opportunityId)]
  };
}

function openAIText(value) {
  return {
    ok: true,
    status: 200,
    body: {
      output_text: typeof value === "string" ? value : JSON.stringify(value)
    }
  };
}

function openAIError(message, status = 500) {
  return {
    ok: false,
    status,
    body: {
      error: { message }
    }
  };
}

function makeFetchResponse(config) {
  return {
    ok: config.ok !== false,
    status: config.status || (config.ok === false ? 500 : 200),
    async json() {
      return config.body || null;
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("Timed out waiting for condition");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
