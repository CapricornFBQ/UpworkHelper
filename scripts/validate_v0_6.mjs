import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  OPPORTUNITY_STATUS,
  OUTCOME_EVENT_TYPE,
  OUTCOME_STATUS,
  PLAN_VERSION,
  PLATFORM_HOSTS,
  PROPOSAL_DRAFT_STATUS,
  PROMPT_VERSIONS,
  SCHEMA_VERSION,
  SNAPSHOT_RETENTION_STATE,
  STORAGE_KEYS
} from "../src/shared/schema.js";
import {
  PROFILE_FIELD_DEFINITIONS,
  buildEffectiveProfile,
  mapRawProfileFields,
  normalizeMissingProfileFieldKeys,
  normalizeRawProposalDraft,
  normalizeRawScore,
  profileFieldsToLegacyRawProfile
} from "../src/shared/adapters.js";

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
assert.equal(PLAN_VERSION, "0.6.0");
assert.equal(OPPORTUNITY_STATUS.draft, "draft");
assert.equal(OPPORTUNITY_STATUS.captured, "captured");
assert.equal(OUTCOME_STATUS.applied, "applied");
assert.equal(OUTCOME_EVENT_TYPE.proposalSent, "proposal_sent");
assert.equal(PROPOSAL_DRAFT_STATUS.generated, "generated");
assert.equal(PROPOSAL_DRAFT_STATUS.edited, "edited");
assert.equal(SNAPSHOT_RETENTION_STATE.deletedReferenceOnly, "deleted_reference_only");
assert.equal(PROMPT_VERSIONS.scoreRuleVersion, "score_rules_v1");
assert.equal(PROMPT_VERSIONS.proposalPromptVersion, "proposal_prompt_v1");
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
assert.equal(PROFILE_FIELD_DEFINITIONS.some((definition) => definition.key === "jobTitle"), true);
assert.equal(buildEffectiveProfile({ fields: mappedProfile }).jobTitle, "Chrome extension engineer");
assert.equal(profileFieldsToLegacyRawProfile({ fields: mappedProfile }).title, "Chrome extension engineer");
assert.deepEqual(normalizeMissingProfileFieldKeys(["client_hire_rate", "jobTitle"]), ["clientHireRateText", "jobTitle"]);

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

const fakeProposal = {
  assumptions: ["Client needs MV3 delivery"],
  unsupported_claims: [{
    claim: "24 hour delivery",
    reason: "No saved availability supports this commitment",
    source_refs: []
  }],
  questions_to_ask: ["Which Chrome stores are in scope?"],
  opening_line: "Hi, I can help with this MV3 extension.",
  fit_summary: "Your project matches my saved Chrome extension work.",
  relevant_proof: [{
    text: "I built a Chrome MV3 scoring extension.",
    source_refs: [{
      source_type: "portfolio_case",
      source_id: "case_relevant",
      field_key: "title",
      label: "Relevant portfolio case",
      quote: "MV3 scoring extension"
    }]
  }],
  scope_boundary: "I would first confirm permissions, storage, and review flow.",
  suggested_rate_or_bid: {
    text: "Use the saved minimum project budget as the bid floor.",
    source_refs: [{
      source_type: "my_profile",
      source_id: "my_profile_proposal",
      field_key: "rateCard",
      label: "Rate card",
      quote: "$1000"
    }]
  },
  final_proposal_text: "Hi, I can help with this MV3 extension.\n\nI built a Chrome MV3 scoring extension and would first confirm permissions, storage, and review flow.",
  source_refs: [{
    source_type: "score_result",
    source_id: "score_proposal",
    field_key: "proposalAngle",
    label: "Score proposal angle",
    quote: "Lead with extension experience"
  }]
};
const normalizedProposal = normalizeRawProposalDraft(fakeProposal);
assert.equal(normalizedProposal.questionsToAsk[0], "Which Chrome stores are in scope?");
assert.equal(normalizedProposal.unsupportedClaims[0].claim, "24 hour delivery");
assert.equal(normalizedProposal.relevantProof[0].sourceRefs[0].sourceType, "portfolio_case");
assert.match(normalizedProposal.finalText, /MV3 extension/);

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
unsupportedFutureEntity.data[STORAGE_KEYS.clientRecords] = [{ id: "client_1" }];
const unsupportedFutureEntityPreview = await sendBackgroundMessage({ type: "data:importPreview", data: unsupportedFutureEntity });
assert.equal(unsupportedFutureEntityPreview.ok, false);
assert.match(unsupportedFutureEntityPreview.error, /import is not supported yet/);

const personalImport = structuredClone(validImportPayload);
personalImport.data[STORAGE_KEYS.myProfile] = makeMyProfile("my_profile_import");
personalImport.data[STORAGE_KEYS.portfolioCases] = [makePortfolioCase("case_import")];
const personalImportPreview = await sendBackgroundMessage({ type: "data:importPreview", data: personalImport });
assert.equal(personalImportPreview.ok, true);
assert.equal(personalImportPreview.preview.entityCounts.myProfile, 1);
assert.equal(personalImportPreview.preview.entityCounts.portfolioCases, 1);

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
await runMyProfilePortfolioTests();
await runProfileReviewTests();
await runPersonalContextScoreTests();
await runProposalDraftTests();
await runOutcomeEventTests();
await runScoreTests();

console.log("v0.6 validation passed");

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
          currentNotesRevisionId: "note_delete",
          currentProposalDraftId: "proposal_delete"
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
      ],
      [STORAGE_KEYS.proposalDrafts]: [
        makeProposalDraft("proposal_delete", "opp_delete", { inputScoreResultId: "score_delete" }),
        makeProposalDraft("proposal_keep", "opp_keep", { inputScoreResultId: "score_keep" })
      ],
      [STORAGE_KEYS.outcomeEvents]: [
        makeOutcomeEvent("outcome_delete", "opp_delete", { eventType: OUTCOME_EVENT_TYPE.proposalSent }),
        makeOutcomeEvent("outcome_keep", "opp_keep", { eventType: OUTCOME_EVENT_TYPE.proposalSent })
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
  assert.equal(harness.storageData[STORAGE_KEYS.proposalDrafts].some((item) => item.opportunityId === "opp_delete"), false);
  assert.equal(harness.storageData[STORAGE_KEYS.outcomeEvents].some((item) => item.opportunityId === "opp_delete"), false);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities].some((item) => item.id === "opp_keep"), true);
  assert.equal(harness.storageData[STORAGE_KEYS.snapshots].some((item) => item.opportunityId === "opp_keep"), true);
  assert.equal(harness.storageData[STORAGE_KEYS.proposalDrafts].some((item) => item.opportunityId === "opp_keep"), true);
  assert.equal(harness.storageData[STORAGE_KEYS.outcomeEvents].some((item) => item.opportunityId === "opp_keep"), true);
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

async function runMyProfilePortfolioTests() {
  const harness = await loadBackgroundForValidation();

  const emptyProfile = await harness({ type: "myProfile:get" });
  assert.equal(emptyProfile.ok, true);
  assert.equal(emptyProfile.profile, null);

  const savedProfile = await harness({
    type: "myProfile:save",
    profile: {
      displayName: " Fanbingqi ",
      title: "Chrome extension engineer",
      summary: "Builds browser extensions.",
      skillTags: "Chrome MV3\nJavaScript",
      serviceCategories: ["Browser extensions"],
      strengths: ["Storage reliability"],
      preferredProjects: ["Extension tools"],
      rejectRules: ["Free test tasks"],
      rateCard: { currency: "USD", hourlyRateText: "$80/hr", minimumProjectBudgetText: "$500" },
      availability: "Part-time",
      proposalPreferences: ["Lead with proof"],
      languagePreferences: ["English"]
    }
  });
  assert.equal(savedProfile.ok, true);
  assert.equal(savedProfile.profile.version, 1);
  assert.equal(savedProfile.profile.displayName, "Fanbingqi");
  assert.deepEqual(savedProfile.profile.skillTags, ["Chrome MV3", "JavaScript"]);

  const updatedProfile = await harness({
    type: "myProfile:save",
    profile: { summary: "Builds reliable browser extensions." }
  });
  assert.equal(updatedProfile.profile.version, 2);
  assert.equal(updatedProfile.profile.skillTags.length, 2);
  assert.match(updatedProfile.profile.summary, /reliable/);

  const createdCase = await harness({
    type: "portfolio:create",
    portfolioCase: {
      title: "MV3 score helper",
      summary: "Built an MV3 helper.",
      skillTags: ["Chrome MV3"],
      outcome: "Shipped stable extension.",
      proofPoints: ["Storage migration"],
      links: ["https://example.com/mv3"],
      applicableKeywords: ["extension", "score"],
      sourceRefs: []
    }
  });
  assert.equal(createdCase.ok, true);
  assert.equal(createdCase.portfolioCase.version, 1);

  const listed = await harness({ type: "portfolio:list" });
  assert.equal(listed.portfolioCases.length, 1);

  const updatedCase = await harness({
    type: "portfolio:update",
    id: createdCase.portfolioCase.id,
    portfolioCase: { outcome: "Reduced manual review time." }
  });
  assert.equal(updatedCase.portfolioCase.version, 2);
  assert.equal(updatedCase.portfolioCase.title, "MV3 score helper");
  assert.match(updatedCase.portfolioCase.outcome, /Reduced/);

  const exported = await harness({ type: "data:export" });
  assert.equal(exported.exportData.manifest.entityCounts.myProfile, 1);
  assert.equal(exported.exportData.manifest.entityCounts.portfolioCases, 1);

  const archived = await harness({ type: "portfolio:archive", id: createdCase.portfolioCase.id });
  assert.equal(archived.portfolioCase.archivedAt !== null, true);
  const activeAfterArchive = await harness({ type: "portfolio:list" });
  assert.equal(activeAfterArchive.portfolioCases.length, 0);

  const secondCase = await harness({ type: "portfolio:create", portfolioCase: makePortfolioCase("case_clear") });
  assert.equal(secondCase.ok, true);
  const clearCases = await harness({ type: "portfolio:clear" });
  assert.equal(clearCases.archivedCount, 1);
  const activeAfterClear = await harness({ type: "portfolio:list" });
  assert.equal(activeAfterClear.portfolioCases.length, 0);

  const clearedProfile = await harness({ type: "myProfile:clear" });
  assert.equal(clearedProfile.ok, true);
  const profileAfterClear = await harness({ type: "myProfile:get" });
  assert.equal(profileAfterClear.profile, null);
}

async function runProfileReviewTests() {
  const harness = await loadBackgroundForValidation({
    storageData: makeScoreStorageData("opp_profile"),
    fetchResponses: [
      openAIText(fakeProfile),
      ({ init }) => {
        const request = JSON.parse(init.body);
        const prompt = request.input[0].content[0].text;
        assert.match(prompt, /Corrected extension engineer/);
        assert.doesNotMatch(prompt, /Chrome extension engineer/);
        return openAIText(fakeScore);
      }
    ]
  });

  const extracted = await harness({ type: "profile:extract", opportunityId: "opp_profile" });
  assert.equal(extracted.ok, true);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 1);
  assert.equal(extracted.opportunity.profile.profileReviewed, false);
  assert.equal(extracted.opportunity.profile.fields.jobTitle.value, "Chrome extension engineer");
  assert.equal(extracted.opportunity.profile.missingFieldKeys.includes("clientHireRateText"), true);

  const profile = await harness({ type: "profile:getExtracted", opportunityId: "opp_profile" });
  assert.equal(profile.ok, true);
  assert.equal(profile.profile.effectiveProfile.jobTitle, "Chrome extension engineer");

  const corrected = await harness({
    type: "profile:saveCorrections",
    opportunityId: "opp_profile",
    fields: {
      jobTitle: "Corrected extension engineer",
      descriptionSummary: "Corrected MV3 build",
      requiredSkills: ["MV3", "Storage"]
    }
  });
  assert.equal(corrected.ok, true);
  assert.equal(corrected.opportunity.title, "Corrected extension engineer");
  assert.equal(corrected.opportunity.profile.profileReviewed, true);
  assert.equal(corrected.opportunity.effectiveProfile.jobTitle, "Corrected extension engineer");
  assert.equal(corrected.opportunity.profile.fields.jobTitle.effectiveSource, "user_corrected");
  assert.equal(corrected.opportunity.profile.conflicts.some((item) => item.fieldKey === "jobTitle"), true);

  const scored = await harness({ type: "score:opportunity", opportunityId: "opp_profile" });
  assert.equal(scored.ok, true);
  assert.equal(harness.storageData[STORAGE_KEYS.opportunityProfiles].length, 1);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults][0].profileReviewed, true);
  assert.equal(harness.storageData[STORAGE_KEYS.scoreResults][0].inputProfileId, harness.storageData[STORAGE_KEYS.opportunityProfiles][0].id);

  const cleared = await harness({ type: "profile:clearCorrections", opportunityId: "opp_profile" });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.opportunity.profile.profileReviewed, false);
  assert.equal(cleared.opportunity.profile.conflicts.length, 0);
  assert.equal(cleared.opportunity.effectiveProfile.jobTitle, "Chrome extension engineer");
}

async function runPersonalContextScoreTests() {
  const harness = await loadBackgroundForValidation({
    storageData: {
      ...makeScoreStorageData("opp_personal"),
      [STORAGE_KEYS.myProfile]: makeMyProfile("my_profile_score", { version: 3 }),
      [STORAGE_KEYS.portfolioCases]: [
        makePortfolioCase("case_score", { version: 2 }),
        makePortfolioCase("case_archived", { title: "Archived case", archivedAt: "2026-05-06T00:00:00.000Z" })
      ]
    },
    fetchResponses: [
      openAIText(fakeProfile),
      ({ init }) => {
        const prompt = JSON.parse(init.body).input[0].content[0].text;
        assert.match(prompt, /Fanbingqi/);
        assert.match(prompt, /MV3 scoring extension/);
        assert.doesNotMatch(prompt, /Archived case/);
        return openAIText(fakeScore);
      },
      ({ init }) => {
        const prompt = JSON.parse(init.body).input[0].content[0].text;
        assert.doesNotMatch(prompt, /Fanbingqi/);
        assert.doesNotMatch(prompt, /MV3 scoring extension/);
        return openAIText(fakeScore);
      }
    ]
  });

  const scored = await harness({ type: "score:opportunity", opportunityId: "opp_personal" });
  assert.equal(scored.ok, true);
  const firstScore = harness.storageData[STORAGE_KEYS.scoreResults][0];
  assert.equal(firstScore.inputMyProfileId, "my_profile_score");
  assert.equal(firstScore.inputMyProfileVersion, 3);
  assert.deepEqual(firstScore.inputPortfolioCaseRefs, [{ id: "case_score", version: 2 }]);

  await harness({ type: "myProfile:clear" });
  await harness({ type: "portfolio:clear" });
  const scoredAfterClear = await harness({ type: "score:opportunity", opportunityId: "opp_personal" });
  assert.equal(scoredAfterClear.ok, true);
  const secondScore = harness.storageData[STORAGE_KEYS.scoreResults][1];
  assert.equal(secondScore.inputMyProfileId, null);
  assert.equal(secondScore.inputMyProfileVersion, null);
  assert.deepEqual(secondScore.inputPortfolioCaseRefs, []);
}

async function runProposalDraftTests() {
  const proposalStorageData = {
    [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, apiKey: "key" },
    [STORAGE_KEYS.opportunities]: [makeOpportunity("opp_proposal", {
      status: OPPORTUNITY_STATUS.scored,
      snapshotIds: ["snap_proposal"],
      currentProfileId: "profile_proposal",
      currentScoreResultId: "score_proposal",
      currentNotesRevisionId: "note_proposal"
    })],
    [STORAGE_KEYS.snapshots]: [makeSnapshot("snap_proposal", "opp_proposal", {
      text: "Build a Chrome MV3 extension with OpenAI scoring and local storage."
    })],
    [STORAGE_KEYS.opportunityProfiles]: [makeProfile("profile_proposal", "opp_proposal", {
      inputSnapshotIds: ["snap_proposal"],
      fields: mapRawProfileFields(fakeProfile, "2026-05-06T00:00:00.000Z")
    })],
    [STORAGE_KEYS.scoreResults]: [makeScore("score_proposal", "opp_proposal", {
      inputProfileId: "profile_proposal",
      inputProfileVersion: 1,
      notesRevisionId: "note_proposal",
      proposalAngle: "Lead with extension experience"
    })],
    [STORAGE_KEYS.noteRevisions]: [makeNote("note_proposal", "opp_proposal", "Mention MV3 permissions and storage.")],
    [STORAGE_KEYS.myProfile]: makeMyProfile("my_profile_proposal", { version: 5 }),
    [STORAGE_KEYS.portfolioCases]: [
      makePortfolioCase("case_relevant", { version: 2, applicableKeywords: ["mv3", "extension"], skillTags: ["Chrome MV3"] }),
      makePortfolioCase("case_irrelevant", {
        title: "Accounting report",
        summary: "Prepared ledger exports.",
        outcome: "Delivered invoice summaries.",
        proofPoints: ["Tax form cleanup"],
        applicableKeywords: ["ledgerbook", "taxform"],
        skillTags: ["Bookkeeping"]
      })
    ]
  };
  const harness = await loadBackgroundForValidation({
    storageData: proposalStorageData,
    fetchResponses: [
      ({ init }) => {
        const prompt = JSON.parse(init.body).input[0].content[0].text;
        assert.match(prompt, /Fanbingqi/);
        assert.match(prompt, /MV3 scoring extension/);
        assert.doesNotMatch(prompt, /Accounting report/);
        assert.match(prompt, /ScoreResult JSON/);
        return openAIText(fakeProposal);
      }
    ]
  });

  const generated = await harness({ type: "proposal:generate", opportunityId: "opp_proposal" });
  assert.equal(generated.ok, true, generated.error);
  assert.equal(harness.storageData[STORAGE_KEYS.proposalDrafts].length, 1);
  const draft = harness.storageData[STORAGE_KEYS.proposalDrafts][0];
  assert.equal(harness.storageData[STORAGE_KEYS.opportunities][0].currentProposalDraftId, draft.id);
  assert.equal(draft.status, PROPOSAL_DRAFT_STATUS.generated);
  assert.equal(draft.inputScoreResultId, "score_proposal");
  assert.equal(draft.inputMyProfileId, "my_profile_proposal");
  assert.equal(draft.inputMyProfileVersion, 5);
  assert.deepEqual(draft.selectedPortfolioCaseRefs, [{ id: "case_relevant", version: 2 }]);
  assert.equal(draft.questionsToAsk[0], "Which Chrome stores are in scope?");
  assert.equal(draft.unsupportedClaims[0].claim, "24 hour delivery");
  assert.equal(draft.relevantProof[0].sourceRefs[0].sourceType, "portfolio_case");
  assert.match(generated.opportunity.proposalDraft.finalText, /MV3 extension/);

  const listed = await harness({ type: "proposal:list", opportunityId: "opp_proposal" });
  assert.equal(listed.ok, true);
  assert.equal(listed.proposalDrafts.length, 1);
  const fetched = await harness({ type: "proposal:get", id: draft.id });
  assert.equal(fetched.proposalDraft.id, draft.id);

  const edited = await harness({ type: "proposal:updateDraft", id: draft.id, patch: { finalText: "Edited proposal text." } });
  assert.equal(edited.ok, true);
  const editedDraft = harness.storageData[STORAGE_KEYS.proposalDrafts][0];
  assert.equal(editedDraft.status, PROPOSAL_DRAFT_STATUS.edited);
  assert.equal(editedDraft.finalText, "Edited proposal text.");
  assert.equal(editedDraft.revisions.length, 1);

  const proposalExport = await harness({ type: "data:export" });
  assert.equal(proposalExport.exportData.manifest.entityCounts.proposalDrafts, 1);

  const archived = await harness({ type: "proposal:archive", id: draft.id });
  assert.equal(archived.ok, true);
  assert.equal(archived.opportunity.currentProposalDraftId, null);
  const activeDrafts = await harness({ type: "proposal:list", opportunityId: "opp_proposal" });
  assert.equal(activeDrafts.proposalDrafts.length, 0);
  const allDrafts = await harness({ type: "proposal:list", opportunityId: "opp_proposal", includeArchived: true });
  assert.equal(allDrafts.proposalDrafts.length, 1);

  const noScoreHarness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, apiKey: "key" },
      [STORAGE_KEYS.opportunities]: [makeOpportunity("opp_no_score", { snapshotIds: ["snap_no_score"] })],
      [STORAGE_KEYS.snapshots]: [makeSnapshot("snap_no_score", "opp_no_score")]
    }
  });
  const noScore = await noScoreHarness({ type: "proposal:generate", opportunityId: "opp_no_score" });
  assert.equal(noScore.ok, false);
  assert.match(noScore.error, /Score this opportunity/);

  const deferredProposal = deferred();
  const lockHarness = await loadBackgroundForValidation({
    storageData: proposalStorageData,
    fetchResponses: [deferredProposal.promise]
  });
  const generating = lockHarness({ type: "proposal:generate", opportunityId: "opp_proposal" });
  await waitUntil(() => lockHarness.fetchCalls.length === 1);
  const notesWhileGenerating = lockHarness({ type: "notes:update", opportunityId: "opp_proposal", notes: "changed while generating" });
  const notesResult = await Promise.race([notesWhileGenerating, delay(100).then(() => null)]);
  assert.ok(notesResult, "notes update should not wait for proposal fetch");
  assert.equal(notesResult.ok, true);
  deferredProposal.resolve(openAIText(fakeProposal));
  const staleProposal = await generating;
  assert.equal(staleProposal.ok, false);
  assert.match(staleProposal.error, /changed while generating proposal/);
  assert.equal(lockHarness.storageData[STORAGE_KEYS.proposalDrafts].length, 0);

  const proposalImport = structuredClone(validImportPayload);
  proposalImport.data[STORAGE_KEYS.myProfile] = makeMyProfile("my_profile_proposal");
  proposalImport.data[STORAGE_KEYS.portfolioCases] = [makePortfolioCase("case_relevant")];
  proposalImport.data[STORAGE_KEYS.opportunities] = [makeOpportunity("opp_import_proposal", {
    status: OPPORTUNITY_STATUS.scored,
    snapshotIds: ["snap_import_proposal"],
    currentProfileId: "profile_import_proposal",
    currentScoreResultId: "score_import_proposal",
    currentProposalDraftId: "draft_import_proposal"
  })];
  proposalImport.data[STORAGE_KEYS.snapshots] = [makeSnapshot("snap_import_proposal", "opp_import_proposal")];
  proposalImport.data[STORAGE_KEYS.opportunityProfiles] = [makeProfile("profile_import_proposal", "opp_import_proposal", { inputSnapshotIds: ["snap_import_proposal"] })];
  proposalImport.data[STORAGE_KEYS.scoreResults] = [makeScore("score_import_proposal", "opp_import_proposal", { inputProfileId: "profile_import_proposal" })];
  proposalImport.data[STORAGE_KEYS.proposalDrafts] = [makeProposalDraft("draft_import_proposal", "opp_import_proposal", {
    inputProfileId: "profile_import_proposal",
    inputScoreResultId: "score_import_proposal"
  })];
  const proposalImportPreview = await sendBackgroundMessage({ type: "data:importPreview", data: proposalImport });
  assert.equal(proposalImportPreview.ok, true);
  assert.equal(proposalImportPreview.preview.entityCounts.proposalDrafts, 1);

  const badProposalImport = structuredClone(proposalImport);
  badProposalImport.data[STORAGE_KEYS.proposalDrafts][0].inputScoreResultId = "missing_score";
  const badProposalPreview = await sendBackgroundMessage({ type: "data:importPreview", data: badProposalImport });
  assert.equal(badProposalPreview.ok, false);
  assert.match(badProposalPreview.error, /missing ScoreResult/);

  const badSourceImport = structuredClone(proposalImport);
  badSourceImport.data[STORAGE_KEYS.proposalDrafts][0].relevantProof[0].sourceRefs[0].sourceId = "case_missing";
  const badSourcePreview = await sendBackgroundMessage({ type: "data:importPreview", data: badSourceImport });
  assert.equal(badSourcePreview.ok, false);
  assert.match(badSourcePreview.error, /missing selected Portfolio Case/);
}

async function runOutcomeEventTests() {
  const outcomeStorageData = {
    [STORAGE_KEYS.opportunities]: [makeOpportunity("opp_outcome", {
      status: OPPORTUNITY_STATUS.scored,
      snapshotIds: ["snap_outcome"],
      currentScoreResultId: "score_outcome",
      currentProposalDraftId: "draft_outcome"
    })],
    [STORAGE_KEYS.snapshots]: [makeSnapshot("snap_outcome", "opp_outcome")],
    [STORAGE_KEYS.scoreResults]: [makeScore("score_outcome", "opp_outcome")],
    [STORAGE_KEYS.proposalDrafts]: [makeProposalDraft("draft_outcome", "opp_outcome", { inputScoreResultId: "score_outcome" })]
  };
  const harness = await loadBackgroundForValidation({ storageData: outcomeStorageData });

  const sent = await harness({
    type: "outcome:appendEvent",
    opportunityId: "opp_outcome",
    event: {
      eventType: OUTCOME_EVENT_TYPE.proposalSent,
      occurredAt: "2026-05-06T01:00:00.000Z",
      payload: {
        connectsSpent: 12,
        bidAmount: 1500,
        bidCurrency: "USD",
        bidType: "fixed",
        proposalDraftId: "draft_outcome"
      },
      notes: "Submitted manually"
    }
  });
  assert.equal(sent.ok, true);
  assert.equal(harness.storageData[STORAGE_KEYS.outcomeEvents].length, 1);
  assert.equal(sent.opportunity.outcomeSummary.status, OUTCOME_STATUS.applied);
  assert.equal(sent.opportunity.outcomeSummary.connectsSpent, 12);
  assert.equal(sent.opportunity.outcomeSummary.bidAmount, 1500);

  const viewed = await harness({
    type: "outcome:appendEvent",
    opportunityId: "opp_outcome",
    event: {
      eventType: OUTCOME_EVENT_TYPE.proposalViewed,
      occurredAt: "2026-05-06T02:00:00.000Z",
      notes: "Client viewed"
    }
  });
  assert.equal(viewed.opportunity.outcomeSummary.status, OUTCOME_STATUS.viewed);
  assert.equal(viewed.opportunity.outcomeSummary.viewedAt, "2026-05-06T02:00:00.000Z");

  const lost = await harness({
    type: "outcome:create",
    opportunityId: "opp_outcome",
    event: {
      eventType: OUTCOME_EVENT_TYPE.lost,
      occurredAt: "2026-05-06T03:00:00.000Z",
      notes: "Not selected"
    }
  });
  assert.equal(lost.opportunity.outcomeSummary.status, OUTCOME_STATUS.lost);
  const lostEventId = harness.storageData[STORAGE_KEYS.outcomeEvents].find((item) => item.eventType === OUTCOME_EVENT_TYPE.lost).id;

  const listed = await harness({ type: "outcome:listEvents", opportunityId: "opp_outcome" });
  assert.equal(listed.ok, true);
  assert.equal(listed.outcomeEvents.length, 3);

  const voided = await harness({ type: "outcome:voidEvent", id: lostEventId, reason: "Wrong opportunity" });
  assert.equal(voided.ok, true);
  assert.equal(voided.opportunity.outcomeSummary.status, OUTCOME_STATUS.viewed);
  const listedAfterVoid = await harness({ type: "outcome:list", opportunityId: "opp_outcome" });
  assert.equal(listedAfterVoid.outcomeEvents.length, 2);
  const listedWithVoided = await harness({ type: "outcome:list", opportunityId: "opp_outcome", includeVoided: true });
  assert.equal(listedWithVoided.outcomeEvents.length, 3);

  const summary = await harness({ type: "outcome:getSummary", opportunityId: "opp_outcome" });
  assert.equal(summary.ok, true);
  assert.equal(summary.outcomeSummary.status, OUTCOME_STATUS.viewed);

  const summaries = await harness({ type: "opportunities:listSummary" });
  assert.equal(summaries.opportunities[0].outcomeSummary.status, OUTCOME_STATUS.viewed);

  const exported = await harness({ type: "data:export" });
  assert.equal(exported.exportData.manifest.entityCounts.outcomeEvents, 3);

  const invalidType = await harness({
    type: "outcome:appendEvent",
    opportunityId: "opp_outcome",
    event: { eventType: "bad_event", occurredAt: "2026-05-06T04:00:00.000Z" }
  });
  assert.equal(invalidType.ok, false);
  assert.match(invalidType.error, /Unsupported outcome event type/);
  assert.equal(harness.storageData[STORAGE_KEYS.outcomeEvents].length, 3);

  const badDraft = await harness({
    type: "outcome:appendEvent",
    opportunityId: "opp_outcome",
    event: {
      eventType: OUTCOME_EVENT_TYPE.proposalSent,
      occurredAt: "2026-05-06T05:00:00.000Z",
      payload: { proposalDraftId: "missing_draft" }
    }
  });
  assert.equal(badDraft.ok, false);
  assert.match(badDraft.error, /missing ProposalDraft/);

  const captureHarness = await loadBackgroundForValidation({
    storageData: {
      [STORAGE_KEYS.opportunities]: [makeOpportunity("opp_capture_outcome", { snapshotIds: ["snap_existing"] })],
      [STORAGE_KEYS.snapshots]: [makeSnapshot("snap_existing", "opp_capture_outcome")]
    }
  });
  captureHarness.setActiveTab({ id: 1, url: "https://www.upwork.com/jobs/details/opp_capture_outcome", title: "Outcome capture" });
  captureHarness.setCaptureResult(makeCaptureResult(
    "https://www.upwork.com/jobs/details/opp_capture_outcome",
    "Outcome capture",
    "Client viewed your proposal on this job."
  ));
  const captured = await captureHarness({ type: "capture:currentPage", opportunityId: "opp_capture_outcome" });
  assert.equal(captured.ok, true);
  assert.equal(captureHarness.storageData[STORAGE_KEYS.outcomeEvents].length, 1);
  assert.equal(captured.opportunity.outcomeSummary.status, OUTCOME_STATUS.viewed);
  assert.equal(captureHarness.storageData[STORAGE_KEYS.outcomeEvents][0].eventType, OUTCOME_EVENT_TYPE.captureDetectedStatus);

  const outcomeImport = structuredClone(validImportPayload);
  outcomeImport.data[STORAGE_KEYS.opportunities] = [makeOpportunity("opp_import_outcome", {
    snapshotIds: ["snap_import_outcome"],
    currentProposalDraftId: "draft_import_outcome"
  })];
  outcomeImport.data[STORAGE_KEYS.snapshots] = [makeSnapshot("snap_import_outcome", "opp_import_outcome")];
  outcomeImport.data[STORAGE_KEYS.scoreResults] = [makeScore("score_import_outcome", "opp_import_outcome")];
  outcomeImport.data[STORAGE_KEYS.myProfile] = makeMyProfile("my_profile_proposal");
  outcomeImport.data[STORAGE_KEYS.portfolioCases] = [makePortfolioCase("case_relevant")];
  outcomeImport.data[STORAGE_KEYS.proposalDrafts] = [makeProposalDraft("draft_import_outcome", "opp_import_outcome", {
    inputScoreResultId: "score_import_outcome",
    sourceRefs: [{
      sourceType: "score_result",
      sourceId: "score_import_outcome",
      fieldKey: "proposalAngle",
      label: "Score proposal angle",
      quote: "Lead with extension experience"
    }]
  })];
  outcomeImport.data[STORAGE_KEYS.outcomeEvents] = [makeOutcomeEvent("outcome_import", "opp_import_outcome", {
    payload: {
      connectsSpent: 10,
      bidAmount: 900,
      bidCurrency: "USD",
      bidType: "fixed",
      proposalDraftId: "draft_import_outcome",
      proposalTextRevisionId: null
    }
  })];
  const outcomeImportPreview = await sendBackgroundMessage({ type: "data:importPreview", data: outcomeImport });
  assert.equal(outcomeImportPreview.ok, true);
  assert.equal(outcomeImportPreview.preview.entityCounts.outcomeEvents, 1);

  const badOutcomeImport = structuredClone(outcomeImport);
  badOutcomeImport.data[STORAGE_KEYS.outcomeEvents][0].payload.proposalDraftId = "missing_draft";
  const badOutcomePreview = await sendBackgroundMessage({ type: "data:importPreview", data: badOutcomeImport });
  assert.equal(badOutcomePreview.ok, false);
  assert.match(badOutcomePreview.error, /missing ProposalDraft/);
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

function makeMyProfile(id = "my_profile", overrides = {}) {
  const now = "2026-05-06T00:00:00.000Z";
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    version: 1,
    createdAt: now,
    updatedAt: now,
    displayName: "Fanbingqi",
    title: "Chrome extension engineer",
    summary: "Builds reliable browser extensions and automation tooling.",
    skillTags: ["Chrome MV3", "JavaScript"],
    serviceCategories: ["Browser extensions"],
    strengths: ["Storage migration", "Extension UX"],
    preferredProjects: ["MV3 extensions"],
    rejectRules: ["Free test tasks", "Budget below $500"],
    rateCard: {
      currency: "USD",
      hourlyRateText: "$80/hr",
      minimumProjectBudgetText: "$500",
      fixedProjectMinimumText: "$1000"
    },
    availability: "Part-time",
    proposalPreferences: ["Lead with proof"],
    languagePreferences: ["English"],
    archivedAt: null,
    ...overrides
  };
}

function makePortfolioCase(id = "case_extension", overrides = {}) {
  const now = "2026-05-06T00:00:00.000Z";
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    version: 1,
    createdAt: now,
    updatedAt: now,
    title: "MV3 scoring extension",
    summary: "Built a Chrome MV3 extension with local storage and scoring flows.",
    skillTags: ["Chrome MV3", "OpenAI"],
    outcome: "Delivered a stable extension workflow.",
    proofPoints: ["Implemented MV3 service worker", "Added regression tests"],
    links: ["https://example.com/case"],
    applicableKeywords: ["extension", "mv3", "scoring"],
    sourceRefs: [],
    archivedAt: null,
    ...overrides
  };
}

function makeProposalDraft(id = "draft_extension", opportunityId = "opp_extension", overrides = {}) {
  const now = "2026-05-06T00:00:00.000Z";
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    status: PROPOSAL_DRAFT_STATUS.generated,
    templateId: "default_direct_proof_v1",
    model: "gpt-5.2",
    promptVersion: PROMPT_VERSIONS.proposalPromptVersion,
    inputProfileId: null,
    inputProfileVersion: null,
    inputScoreResultId: "score_import_proposal",
    inputMyProfileId: "my_profile_proposal",
    inputMyProfileVersion: 1,
    selectedPortfolioCaseRefs: [{ id: "case_relevant", version: 1 }],
    assumptions: ["Client needs extension help"],
    unsupportedClaims: [],
    questionsToAsk: ["Which browsers are in scope?"],
    openingLine: "Hi, I can help with this extension.",
    fitSummary: "This matches my extension work.",
    relevantProof: [{
      text: "I built a Chrome MV3 scoring extension.",
      sourceRefs: [{
        sourceType: "portfolio_case",
        sourceId: "case_relevant",
        fieldKey: "title",
        label: "Relevant portfolio case",
        quote: "MV3 scoring extension"
      }]
    }],
    scopeBoundary: "I would confirm permissions and storage first.",
    suggestedRateOrBid: {
      text: "Use saved minimum project budget.",
      sourceRefs: [{
        sourceType: "my_profile",
        sourceId: "my_profile_proposal",
        fieldKey: "rateCard",
        label: "Rate card",
        quote: "$1000"
      }]
    },
    finalText: "Hi, I can help with this extension.",
    sourceRefs: [{
      sourceType: "score_result",
      sourceId: "score_import_proposal",
      fieldKey: "proposalAngle",
      label: "Score proposal angle",
      quote: "Lead with extension experience"
    }],
    revisions: [],
    archivedAt: null,
    ...overrides
  };
}

function makeOutcomeEvent(id = "outcome_event", opportunityId = "opp_extension", overrides = {}) {
  const now = "2026-05-06T00:00:00.000Z";
  const eventType = overrides.eventType || OUTCOME_EVENT_TYPE.proposalSent;
  const payload = eventType === OUTCOME_EVENT_TYPE.proposalSent
    ? {
      connectsSpent: 8,
      bidAmount: 1200,
      bidCurrency: "USD",
      bidType: "fixed",
      proposalDraftId: null,
      proposalTextRevisionId: null
    }
    : {};
  return {
    id,
    opportunityId,
    schemaVersion: SCHEMA_VERSION,
    eventType,
    occurredAt: now,
    recordedAt: now,
    source: "manual",
    snapshotId: null,
    payload,
    notes: "Outcome note",
    correctionOfEventId: null,
    voidedAt: null,
    ...overrides
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
