import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SETTINGS,
  OPPORTUNITY_STATUS,
  SCHEMA_VERSION,
  STORAGE_KEYS
} from "../src/shared/schema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = findChrome();
const port = Number(process.env.UOSC_CDP_PORT || 47000 + Math.floor(Math.random() * 1000));
const userDataDir = mkdtempSync(join(tmpdir(), "uosc-extension-smoke-"));
const headless = process.env.UOSC_SMOKE_HEADLESS !== "0";
const smokeOpportunityId = "opp_smoke_notes_failure";
const smokeProfileId = "profile_smoke_notes_failure";
let chromeProcess = null;
let client = null;

async function main() {
  try {
    chromeProcess = spawn(chromePath, buildChromeArgs(), {
      stdio: process.env.UOSC_SMOKE_CHROME_LOGS ? "inherit" : "ignore"
    });
    chromeProcess.once("exit", (code, signal) => {
      if (code || signal) {
        process.exitCode = process.exitCode || 1;
      }
    });

    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    client = await CdpClient.connect(version.webSocketDebuggerUrl);
    const extensionId = await waitForExtensionId();
    assert.match(extensionId, /^[a-p]{32}$/);

    await smokeOptionsPage(extensionId);
    await smokeStaticExtensionPage(extensionId, "src/popup/popup.html", {
      title: "Upwork Scorer",
      selectors: ["#captureButton", "#opportunitySelect"]
    });
    await smokeSidePanelPage(extensionId);

    console.log(`unpacked extension smoke passed: ${extensionId}`);
  } finally {
    client?.close();
    if (chromeProcess && !chromeProcess.killed) {
      chromeProcess.kill("SIGTERM");
      await delay(300);
      if (!chromeProcess.killed) chromeProcess.kill("SIGKILL");
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

function buildChromeArgs() {
  const args = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    `--disable-extensions-except=${repoRoot}`,
    `--load-extension=${repoRoot}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-popup-blocking",
    "--window-size=1280,900",
    "about:blank"
  ];
  if (headless) {
    args.unshift("--headless=new", "--disable-gpu");
  }
  return args;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chrome executable not found. Set CHROME_PATH to run the unpacked extension smoke.");
  return found;
}

async function smokeOptionsPage(extensionId) {
  const page = await openExtensionPage(extensionId, "src/options/options.html");
  assert.equal(await evaluate(page.sessionId, "document.title"), "Upwork Scorer Options");
  assert.equal(await hasSelectors(page.sessionId, [
    "#settingsForm",
    "#compactSnapshotsButton",
    "#redactSnapshotsButton",
    "#previewImportButton",
    "#commitImportButton"
  ]), true);

  const settingsResponse = JSON.parse(await evaluate(page.sessionId, `
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "settings:get" }, (response) => resolve(JSON.stringify(response)));
    })
  `));
  assert.equal(settingsResponse.ok, true);

  const retentionResponse = JSON.parse(await evaluate(page.sessionId, `
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "snapshots:getRetentionSummary" }, (response) => resolve(JSON.stringify(response)));
    })
  `));
  assert.equal(retentionResponse.ok, true);
  assert.equal(typeof retentionResponse.summary.totalSnapshots, "number");
}

async function smokeStaticExtensionPage(extensionId, pagePath, expected) {
  const page = await openExtensionPage(extensionId, pagePath);
  assert.equal(await evaluate(page.sessionId, "document.title"), expected.title);
  assert.equal(await hasSelectors(page.sessionId, expected.selectors), true);
}

async function smokeSidePanelPage(extensionId) {
  const page = await openExtensionPage(extensionId, "src/sidepanel/sidepanel.html");
  assert.equal(await evaluate(page.sessionId, "document.title"), "Opportunity");
  assert.equal(await hasSelectors(page.sessionId, [
    "#captureButton",
    "#scoreButton",
    "#deleteButton",
    "#permanentDeleteButton",
    "#refreshButton",
    "#notesInput",
    "#saveNotesButton",
    "#extractProfileButton",
    "#saveProfileButton",
    "#clearProfileButton",
    "#profileFieldsPanel",
    "#profileConflictsPanel",
    "#panelStatus"
  ]), true);

  await seedSmokeOpportunity(page.sessionId);
  await evaluate(page.sessionId, `document.querySelector("#refreshButton").click()`);
  await waitUntil(async () => {
    return evaluate(page.sessionId, `
      document.querySelector("#opportunitySelect").value === ${JSON.stringify(smokeOpportunityId)} &&
      document.querySelector("#notesInput").value === "" &&
      document.querySelector("#profileReviewBadge").textContent === "Reviewed" &&
      document.querySelector('[data-profile-field="jobTitle"]').value === "Corrected smoke title" &&
      document.querySelector("#profileConflictsPanel").textContent.includes("AI extracted") &&
      document.querySelector("#profileConflictsPanel").textContent.includes("Corrected smoke title") &&
      !document.querySelector("#saveNotesButton").disabled
    `);
  });

  await evaluate(page.sessionId, `
    chrome.storage.local.set(${JSON.stringify({ [STORAGE_KEYS.opportunities]: [] })})
  `);
  await evaluate(page.sessionId, `
    document.querySelector("#notesInput").value = "note written during smoke failure";
    document.querySelector("#saveNotesButton").click();
  `);
  await waitUntil(async () => {
    return evaluate(page.sessionId, `
      document.querySelector("#panelStatus").textContent === "Opportunity not found" &&
      !document.querySelector("#saveNotesButton").disabled
    `);
  });

  const noteRevisionCount = await evaluate(page.sessionId, `
    chrome.storage.local.get(${JSON.stringify(STORAGE_KEYS.noteRevisions)})
      .then((data) => (data[${JSON.stringify(STORAGE_KEYS.noteRevisions)}] || []).length)
  `);
  assert.equal(noteRevisionCount, 0);
}

async function seedSmokeOpportunity(sessionId) {
  const now = "2026-05-06T00:00:00.000Z";
  await evaluate(sessionId, `
    chrome.storage.local.set(${JSON.stringify({
      [STORAGE_KEYS.meta]: {
        schemaVersion: SCHEMA_VERSION,
        storageRevision: 1,
        migratedAt: now,
        lastMigrationAt: now,
        lastBackupAt: null,
        lastBackupKey: null
      },
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, apiKey: "" },
      [STORAGE_KEYS.opportunities]: [{
        id: smokeOpportunityId,
        schemaVersion: SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        title: "Smoke notes failure",
        mainUrl: "https://www.upwork.com/jobs/details/smoke-notes-failure",
        jobKey: "smoke-notes-failure",
        platform: "upwork",
        status: OPPORTUNITY_STATUS.captured,
        snapshotIds: [],
        currentProfileId: smokeProfileId,
        currentScoreResultId: null,
        currentNotesRevisionId: null,
        archivedAt: null
      }],
      [STORAGE_KEYS.snapshots]: [],
      [STORAGE_KEYS.opportunityProfiles]: [{
        id: smokeProfileId,
        opportunityId: smokeOpportunityId,
        schemaVersion: SCHEMA_VERSION,
        version: 1,
        createdAt: now,
        updatedAt: now,
        model: "smoke-model",
        promptVersion: "extract_v1",
        scoreVersion: "not_applicable",
        inputSnapshotIds: [],
        fields: {
          jobTitle: {
            value: "Corrected smoke title",
            valueKind: "text",
            effectiveSource: "user_corrected",
            sources: [
              {
                source: "ai_extracted",
                value: "AI smoke title",
                confidence: null,
                evidenceRefs: [],
                snapshotId: null,
                selectorId: null,
                createdAt: now
              },
              {
                source: "user_corrected",
                value: "Corrected smoke title",
                confidence: 1,
                evidenceRefs: [],
                snapshotId: null,
                selectorId: null,
                createdAt: now
              }
            ],
            confidence: 1,
            evidenceRefs: [],
            correctedAt: now,
            correctedBy: "user"
          }
        },
        missingFieldKeys: [],
        conflicts: [{
          fieldKey: "jobTitle",
          label: "Job title",
          selectedSource: "user_corrected",
          sources: [
            { source: "ai_extracted", value: "AI smoke title", confidence: null },
            { source: "user_corrected", value: "Corrected smoke title", confidence: 1 }
          ]
        }],
        reviewedAt: now,
        reviewedBy: "user",
        rawProfile: { title: "AI smoke title", missing_fields: [] }
      }],
      [STORAGE_KEYS.scoreResults]: [],
      [STORAGE_KEYS.noteRevisions]: [],
      [STORAGE_KEYS.myProfile]: null,
      [STORAGE_KEYS.portfolioCases]: [],
      [STORAGE_KEYS.proposalDrafts]: [],
      [STORAGE_KEYS.outcomeEvents]: [],
      [STORAGE_KEYS.clientRecords]: [],
      [STORAGE_KEYS.fieldSelectors]: [],
      [STORAGE_KEYS.analyticsCache]: {}
    })})
  `);
}

async function openExtensionPage(extensionId, pagePath) {
  const url = `chrome-extension://${extensionId}/${pagePath}`;
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  const navigation = await client.send("Page.navigate", { url }, sessionId);
  if (navigation.errorText) throw new Error(`Failed to navigate to ${url}: ${navigation.errorText}`);
  try {
    await waitUntil(async () => {
      return evaluate(sessionId, `
        location.href === ${JSON.stringify(url)} &&
        Boolean(document.body) &&
        (document.readyState === "interactive" || document.readyState === "complete")
      `);
    });
  } catch (error) {
    const debug = await evaluate(sessionId, `JSON.stringify({
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      body: document.body ? document.body.innerText.slice(0, 240) : null
    })`);
    throw new Error(`Timed out loading ${url}: ${debug}`);
  }
  return { targetId, sessionId };
}

async function hasSelectors(sessionId, selectors) {
  const expression = `(${JSON.stringify(selectors)}).every((selector) => Boolean(document.querySelector(selector)))`;
  return evaluate(sessionId, expression);
}

async function evaluate(sessionId, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return response.result.value;
}

async function waitForExtensionId() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const fromPreferences = getExtensionIdFromPreferences();
    if (fromPreferences) return fromPreferences;
    const fromTargets = await getExtensionIdFromTargets();
    if (fromTargets) return fromTargets;
    await delay(250);
  }
  throw new Error(`Loaded extension id was not found through CDP targets or Chrome preferences: ${await getExtensionDebugInfo()}`);
}

async function getExtensionIdFromTargets() {
  const { targetInfos } = await client.send("Target.getTargets");
  for (const target of targetInfos || []) {
    if (!String(target.url || "").includes("/src/background/background.js")) continue;
    const match = String(target.url || "").match(/^chrome-extension:\/\/([^/]+)\//);
    if (match) return match[1];
  }
  return null;
}

function getExtensionIdFromPreferences() {
  const preferencesPath = join(userDataDir, "Default", "Preferences");
  if (!existsSync(preferencesPath)) return null;
  try {
    const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
    const settings = preferences.extensions?.settings || {};
    for (const [id, setting] of Object.entries(settings)) {
      if (setting?.path === repoRoot || setting?.manifest?.name === "Upwork Opportunity Scorer") return id;
    }
  } catch {
    return null;
  }
  return null;
}

async function getExtensionDebugInfo() {
  const { targetInfos } = await client.send("Target.getTargets").catch(() => ({ targetInfos: [] }));
  const targetUrls = (targetInfos || []).map((target) => `${target.type}:${target.url}`).filter(Boolean);
  const preferencesPath = join(userDataDir, "Default", "Preferences");
  const preferenceExtensions = [];
  if (existsSync(preferencesPath)) {
    try {
      const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
      const settings = preferences.extensions?.settings || {};
      for (const [id, setting] of Object.entries(settings)) {
        preferenceExtensions.push({ id, path: setting?.path, name: setting?.manifest?.name, state: setting?.state });
      }
    } catch {
      preferenceExtensions.push({ error: "preferences parse failed" });
    }
  }
  return JSON.stringify({ repoRoot, targetUrls, preferenceExtensions });
}

async function waitForJson(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await predicate()) return;
    await delay(250);
  }
  throw new Error("Timed out waiting for condition");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => this.handleMessage(event));
    ws.addEventListener("close", () => this.rejectAll(new Error("CDP websocket closed")));
    ws.addEventListener("error", () => this.rejectAll(new Error("CDP websocket error")));
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new CdpClient(ws)), { once: true });
      ws.addEventListener("error", () => reject(new Error("Failed to connect to Chrome DevTools websocket")), { once: true });
    });
  }

  send(method, params = {}, sessionId = null) {
    const id = this.nextId;
    this.nextId += 1;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.ws.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  handleMessage(event) {
    const payload = JSON.parse(String(event.data));
    if (!payload.id) return;
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id);
    if (payload.error) {
      pending.reject(new Error(payload.error.message || "CDP command failed"));
    } else {
      pending.resolve(payload.result || {});
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close() {
    this.ws.close();
  }
}

await main();
