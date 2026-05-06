import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  OPPORTUNITY_STATUS,
  PLATFORM_HOSTS,
  PROMPT_VERSIONS,
  SCHEMA_VERSION,
  SNAPSHOT_RETENTION_STATE,
  STORAGE_KEYS
} from "../src/shared/schema.js";

const jsFiles = [
  "src/shared/schema.js",
  "src/background/background.js",
  "src/popup/popup.js",
  "src/options/options.js",
  "src/sidepanel/sidepanel.js"
];

JSON.parse(readFileSync("manifest.json", "utf8"));
for (const file of jsFiles) {
  execFileSync("node", ["--check", file], { stdio: "pipe" });
}

assert.equal(SCHEMA_VERSION, 1);
assert.equal(DEFAULT_SETTINGS.captureMode, "strict_upwork");
assert.equal(PLATFORM_HOSTS.upwork, "www.upwork.com");
assert.equal(OPPORTUNITY_STATUS.draft, "draft");
assert.equal(OPPORTUNITY_STATUS.captured, "captured");
assert.equal(SNAPSHOT_RETENTION_STATE.deletedReferenceOnly, "deleted_reference_only");
assert.equal(PROMPT_VERSIONS.scoreRuleVersion, "score_rules_v1");
assert.equal(STORAGE_KEYS.snapshots, "uosc_snapshots");
assert.equal(STORAGE_KEYS.noteRevisions, "uosc_note_revisions");

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
assert.match(readFileSync("src/shared/schema.js", "utf8"), /uosc_proposal_drafts/);

console.log("v0.2 validation passed");
