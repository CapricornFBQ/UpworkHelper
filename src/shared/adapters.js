const SCORE_DECISIONS = ["strong_apply", "targeted_apply", "only_if_strong_fit", "skip"];

export function mapRawProfileFields(rawProfile = {}, createdAt = new Date().toISOString()) {
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

export function normalizeDimensions(dimensions) {
  return dimensions.map((dimension) => ({
    ...dimension,
    score: clampNumber(dimension.score, 0, dimension.max_score || dimension.maxScore || 100),
    confidence: clampNumber(dimension.confidence, 0, 1)
  }));
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

