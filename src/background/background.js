const STORAGE_KEYS = {
  settings: "uosc_settings",
  opportunities: "uosc_opportunities"
};

const DEFAULT_SETTINGS = {
  apiKey: "",
  extractModel: "gpt-5-mini",
  scoreModel: "gpt-5.2",
  language: "zh-CN",
  reasoningEffort: "low"
};

const MAX_SNAPSHOT_CHARS = 70000;
const MAX_SCORE_INPUT_CHARS = 110000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "settings:get":
      return { ok: true, settings: await getSettings() };
    case "settings:save":
      return { ok: true, settings: await saveSettings(message.settings || {}) };
    case "opportunities:list":
      return { ok: true, opportunities: await listOpportunities() };
    case "opportunities:get":
      return { ok: true, opportunity: await getOpportunity(message.id) };
    case "opportunities:delete":
      await deleteOpportunity(message.id);
      return { ok: true };
    case "opportunities:updateNotes":
      return { ok: true, opportunity: await updateOpportunityNotes(message.id, message.notes || "") };
    case "capture:currentPage":
      return captureCurrentPage(message.opportunityId || null);
    case "score:opportunity":
      return { ok: true, opportunity: await scoreOpportunity(message.opportunityId) };
    default:
      throw new Error(`Unknown message type: ${message?.type || "empty"}`);
  }
}

async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.settings] || {}) };
}

async function saveSettings(partialSettings) {
  const settings = {
    ...(await getSettings()),
    ...partialSettings
  };
  settings.apiKey = String(settings.apiKey || "").trim();
  settings.extractModel = String(settings.extractModel || DEFAULT_SETTINGS.extractModel).trim();
  settings.scoreModel = String(settings.scoreModel || DEFAULT_SETTINGS.scoreModel).trim();
  settings.language = String(settings.language || DEFAULT_SETTINGS.language).trim();
  settings.reasoningEffort = String(settings.reasoningEffort || DEFAULT_SETTINGS.reasoningEffort).trim();
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  return settings;
}

async function listOpportunities() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.opportunities);
  const opportunities = result[STORAGE_KEYS.opportunities] || [];
  return opportunities.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function saveOpportunities(opportunities) {
  await chrome.storage.local.set({ [STORAGE_KEYS.opportunities]: opportunities });
}

async function getOpportunity(id) {
  if (!id) return null;
  const opportunities = await listOpportunities();
  return opportunities.find((item) => item.id === id) || null;
}

async function deleteOpportunity(id) {
  const opportunities = await listOpportunities();
  await saveOpportunities(opportunities.filter((item) => item.id !== id));
}

async function updateOpportunityNotes(id, notes) {
  const opportunities = await listOpportunities();
  const index = opportunities.findIndex((item) => item.id === id);
  if (index === -1) throw new Error("Opportunity not found");
  opportunities[index] = {
    ...opportunities[index],
    notes,
    updatedAt: new Date().toISOString()
  };
  await saveOpportunities(opportunities);
  return opportunities[index];
}

async function captureCurrentPage(opportunityId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  if (!tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error("Current tab is not a normal web page");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: captureVisibleDom,
    args: [MAX_SNAPSHOT_CHARS]
  });

  if (!result?.text) throw new Error("No readable page text found");

  const snapshot = {
    id: crypto.randomUUID(),
    sourceUrl: result.url || tab.url,
    title: result.title || tab.title || "Untitled",
    capturedAt: new Date().toISOString(),
    pageType: inferPageType(result.url || tab.url, result.text),
    text: result.text,
    domSummary: result.domSummary || [],
    stats: result.stats || {}
  };

  const opportunities = await listOpportunities();
  const jobKey = extractUpworkJobKey(snapshot.sourceUrl);
  let opportunity = opportunityId ? opportunities.find((item) => item.id === opportunityId) : null;
  if (!opportunity && jobKey) {
    opportunity = opportunities.find((item) => item.jobKey === jobKey || (item.snapshots || []).some((snap) => extractUpworkJobKey(snap.sourceUrl) === jobKey));
  }

  if (!opportunity) {
    opportunity = {
      id: crypto.randomUUID(),
      title: normalizeTitle(snapshot.title),
      mainUrl: snapshot.sourceUrl,
      jobKey,
      platform: snapshot.sourceUrl.includes("upwork.com") ? "upwork" : "unknown",
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      snapshots: [],
      extractedProfile: null,
      scoreResult: null,
      notes: ""
    };
    opportunities.push(opportunity);
  }

  opportunity.snapshots.push(snapshot);
  opportunity.updatedAt = new Date().toISOString();
  opportunity.title = opportunity.title || normalizeTitle(snapshot.title);
  opportunity.mainUrl = opportunity.mainUrl || snapshot.sourceUrl;
  opportunity.jobKey = opportunity.jobKey || jobKey;

  await saveOpportunities(opportunities);
  return { ok: true, opportunity, snapshot };
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
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("upwork.com")) return null;
    const match = parsed.pathname.match(/\/jobs\/(?:details\/)?([^/?#]+)/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

async function scoreOpportunity(opportunityId) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("OpenAI API key is missing. Set it in Options first.");

  const opportunities = await listOpportunities();
  const index = opportunities.findIndex((item) => item.id === opportunityId);
  if (index === -1) throw new Error("Opportunity not found");
  const opportunity = opportunities[index];
  if (!opportunity.snapshots?.length) throw new Error("No snapshots captured for this opportunity");

  const extractedProfile = await extractOpportunityProfile(opportunity, settings);
  const scoreResult = await scoreOpportunityProfile(opportunity, extractedProfile, settings);

  opportunities[index] = {
    ...opportunity,
    extractedProfile,
    scoreResult,
    status: "scored",
    updatedAt: new Date().toISOString()
  };
  await saveOpportunities(opportunities);
  return opportunities[index];
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
      decision: { type: "string", enum: ["strong_apply", "targeted_apply", "only_if_strong_fit", "skip"] },
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

function buildSnapshotCorpus(opportunity, maxChars) {
  const chunks = [];
  for (const [index, snapshot] of (opportunity.snapshots || []).entries()) {
    chunks.push([
      `--- Snapshot ${index + 1} ---`,
      `Captured at: ${snapshot.capturedAt}`,
      `URL: ${snapshot.sourceUrl}`,
      `Page type: ${snapshot.pageType}`,
      `Title: ${snapshot.title}`,
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
    score: clampNumber(dimension.score, 0, dimension.max_score || 100),
    confidence: clampNumber(dimension.confidence, 0, 1)
  }));
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
