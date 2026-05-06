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

console.log("v0.2 validation passed");

async function loadBackgroundForValidation() {
  let handler = null;
  const storageData = {
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
        async get(keys) {
          if (keys === null) return { ...storageData };
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys
                .filter((key) => Object.prototype.hasOwnProperty.call(storageData, key))
                .map((key) => [key, storageData[key]])
            );
          }
          if (typeof keys === "string") return { [keys]: storageData[keys] };
          return {};
        },
        async set(values) {
          Object.assign(storageData, values);
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
        return [];
      }
    },
    tabs: {
      async query() {
        return [];
      }
    }
  };

  await import(`../src/background/background.js?validate=${Date.now()}`);
  assert.ok(handler, "background onMessage handler not registered");
  const sendMessage = (message) => new Promise((resolve) => handler(message, {}, resolve));
  sendMessage.storageData = storageData;
  return sendMessage;
}
