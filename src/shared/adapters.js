const SCORE_DECISIONS = ["strong_apply", "targeted_apply", "only_if_strong_fit", "skip"];

export const PROFILE_FIELD_DEFINITIONS = Object.freeze([
  { key: "jobTitle", rawKey: "title", label: "Job title", valueKind: "text" },
  { key: "descriptionSummary", rawKey: "job_description_summary", label: "Description summary", valueKind: "text" },
  { key: "requiredSkills", rawKey: "required_skills", label: "Required skills", valueKind: "array" },
  { key: "budgetText", rawKey: "budget", label: "Budget", valueKind: "text" },
  { key: "pricingType", rawKey: "hourly_or_fixed", label: "Pricing type", valueKind: "text" },
  { key: "proposalCountText", rawKey: "proposal_count", label: "Proposal count", valueKind: "text" },
  { key: "connectsCostText", rawKey: "connects_cost", label: "Connects cost", valueKind: "text" },
  { key: "postedTimeText", rawKey: "posted_time", label: "Posted time", valueKind: "text" },
  { key: "interviewsText", rawKey: "interviews", label: "Interviews", valueKind: "text" },
  { key: "invitesSentText", rawKey: "invites_sent", label: "Invites sent", valueKind: "text" },
  { key: "hiresText", rawKey: "hires", label: "Hires", valueKind: "text" },
  { key: "clientPaymentVerifiedText", rawKey: "client_payment_verified", label: "Payment verified", valueKind: "text" },
  { key: "clientRatingText", rawKey: "client_rating", label: "Client rating", valueKind: "text" },
  { key: "clientTotalSpendText", rawKey: "client_total_spend", label: "Client total spend", valueKind: "text" },
  { key: "clientHireRateText", rawKey: "client_hire_rate", label: "Client hire rate", valueKind: "text" },
  { key: "clientAvgHourlyPaidText", rawKey: "client_avg_hourly_paid", label: "Avg hourly paid", valueKind: "text" },
  { key: "clientType", rawKey: "client_type", label: "Client type", valueKind: "text" },
  { key: "testTaskSignal", rawKey: "test_task", label: "Test task signal", valueKind: "text" },
  { key: "longTermSignal", rawKey: "long_term_signal", label: "Long-term signal", valueKind: "text" }
]);
const PROFILE_FIELD_KEYS = new Set(PROFILE_FIELD_DEFINITIONS.map((definition) => definition.key));
const RAW_PROFILE_FIELD_TO_CANONICAL = new Map(PROFILE_FIELD_DEFINITIONS.map((definition) => [definition.rawKey, definition.key]));

export function mapRawProfileFields(rawProfile = {}, createdAt = new Date().toISOString()) {
  const fields = {};
  for (const definition of PROFILE_FIELD_DEFINITIONS) {
    const value = normalizeProfileFieldValue(rawProfile?.[definition.rawKey], definition.valueKind);
    if (isEmptyProfileValue(value)) continue;
    fields[definition.key] = {
      value,
      valueKind: definition.valueKind,
      effectiveSource: "ai_extracted",
      sources: [{
        source: "ai_extracted",
        value,
        confidence: null,
        evidenceRefs: [],
        snapshotId: null,
        selectorId: null,
        createdAt
      }],
      confidence: null,
      evidenceRefs: [],
      correctedAt: null,
      correctedBy: null
    };
  }
  return fields;
}

export function buildEffectiveProfile(profile = {}) {
  const fields = profile.fields || {};
  return Object.fromEntries(PROFILE_FIELD_DEFINITIONS.map((definition) => {
    const value = normalizeProfileFieldValue(fields[definition.key]?.value, definition.valueKind);
    return [definition.key, value];
  }));
}

export function profileFieldsToLegacyRawProfile(profile = {}) {
  const fields = profile.fields || {};
  const result = {};
  for (const definition of PROFILE_FIELD_DEFINITIONS) {
    const value = normalizeProfileFieldValue(fields[definition.key]?.value, definition.valueKind);
    result[definition.rawKey] = isEmptyProfileValue(value)
      ? (definition.valueKind === "array" ? [] : null)
      : value;
  }
  result.raw_evidence = Array.isArray(profile.rawProfile?.raw_evidence) ? profile.rawProfile.raw_evidence : [];
  result.missing_fields = Array.isArray(profile.missingFieldKeys) ? profile.missingFieldKeys : [];
  return result;
}

export function normalizeMissingProfileFieldKeys(missingFields = []) {
  const keys = [];
  for (const value of Array.isArray(missingFields) ? missingFields : []) {
    const key = RAW_PROFILE_FIELD_TO_CANONICAL.get(value) || (PROFILE_FIELD_KEYS.has(value) ? value : null);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function normalizeProfileFieldValue(value, valueKind = "text") {
  if (valueKind === "array") {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (value === null || value === undefined || value === "") return [];
    return String(value)
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function isEmptyProfileValue(value) {
  return Array.isArray(value) ? value.length === 0 : String(value || "").trim() === "";
}

export function normalizeRawScore(rawScore = {}) {
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

export function normalizeRawProposalDraft(rawDraft = {}) {
  const openingLine = normalizeText(rawDraft.openingLine ?? rawDraft.opening_line);
  const fitSummary = normalizeText(rawDraft.fitSummary ?? rawDraft.fit_summary);
  const relevantProof = normalizeProposalProofList(rawDraft.relevantProof ?? rawDraft.relevant_proof);
  const scopeBoundary = normalizeText(rawDraft.scopeBoundary ?? rawDraft.scope_boundary);
  const suggestedRateOrBid = normalizeProposalBlock(rawDraft.suggestedRateOrBid ?? rawDraft.suggested_rate_or_bid);
  const finalText = normalizeText(
    rawDraft.finalText ??
    rawDraft.final_proposal_text ??
    rawDraft.finalProposalText ??
    [
      openingLine,
      fitSummary,
      ...relevantProof.map((item) => item.text),
      scopeBoundary,
      suggestedRateOrBid.text
    ].filter(Boolean).join("\n\n")
  );

  return {
    assumptions: normalizeTextList(rawDraft.assumptions),
    unsupportedClaims: normalizeUnsupportedClaims(rawDraft.unsupportedClaims ?? rawDraft.unsupported_claims),
    questionsToAsk: normalizeTextList(rawDraft.questionsToAsk ?? rawDraft.questions_to_ask),
    openingLine,
    fitSummary,
    relevantProof,
    scopeBoundary,
    suggestedRateOrBid,
    finalText,
    sourceRefs: normalizeSourceRefs(rawDraft.sourceRefs ?? rawDraft.source_refs)
  };
}

export function normalizeDimensions(dimensions) {
  return dimensions.map((dimension) => ({
    ...dimension,
    score: clampNumber(dimension.score, 0, dimension.max_score || dimension.maxScore || 100),
    confidence: clampNumber(dimension.confidence, 0, 1)
  }));
}

function normalizeProposalProofList(value) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item) => normalizeProposalBlock(item)).filter((item) => item.text || item.sourceRefs.length);
}

function normalizeProposalBlock(value = {}) {
  if (typeof value === "string") {
    return { text: normalizeText(value), sourceRefs: [] };
  }
  return {
    text: normalizeText(value?.text ?? value?.value),
    sourceRefs: normalizeSourceRefs(value?.sourceRefs ?? value?.source_refs)
  };
}

function normalizeUnsupportedClaims(value) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item) => {
    if (typeof item === "string") {
      return { claim: normalizeText(item), reason: "", sourceRefs: [] };
    }
    return {
      claim: normalizeText(item?.claim ?? item?.text),
      reason: normalizeText(item?.reason),
      sourceRefs: normalizeSourceRefs(item?.sourceRefs ?? item?.source_refs)
    };
  }).filter((item) => item.claim || item.reason || item.sourceRefs.length);
}

function normalizeSourceRefs(value) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item) => ({
    sourceType: normalizeText(item?.sourceType ?? item?.source_type),
    sourceId: normalizeText(item?.sourceId ?? item?.source_id),
    fieldKey: normalizeText(item?.fieldKey ?? item?.field_key),
    label: normalizeText(item?.label),
    quote: normalizeText(item?.quote)
  })).filter((item) => item.sourceType || item.sourceId || item.fieldKey || item.label || item.quote);
}

function normalizeTextList(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return normalizeText(value)
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}
