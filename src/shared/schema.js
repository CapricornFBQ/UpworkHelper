export const PLAN_VERSION = "0.7.0";
export const SCHEMA_VERSION = 1;

export const STORAGE_KEYS = Object.freeze({
  meta: "uosc_meta",
  settings: "uosc_settings",
  opportunities: "uosc_opportunities",
  snapshots: "uosc_snapshots",
  opportunityProfiles: "uosc_opportunity_profiles",
  scoreResults: "uosc_score_results",
  noteRevisions: "uosc_note_revisions",
  myProfile: "uosc_my_profile",
  portfolioCases: "uosc_portfolio_cases",
  proposalDrafts: "uosc_proposal_drafts",
  outcomeEvents: "uosc_outcome_events",
  clientRecords: "uosc_client_records",
  fieldSelectors: "uosc_field_selectors",
  analyticsCache: "uosc_analytics_cache"
});

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "",
  extractModel: "gpt-5-mini",
  scoreModel: "gpt-5.2",
  proposalModel: "gpt-5.2",
  language: "zh-CN",
  reasoningEffort: "low",
  captureMode: "strict_upwork",
  allowedHosts: [],
  exportPreferences: {
    includeSnapshots: true,
    includeMyProfile: true,
    includePortfolio: true
  }
});

export const OPPORTUNITY_STATUS = Object.freeze({
  draft: "draft",
  captured: "captured",
  scored: "scored",
  archived: "archived"
});

export const SNAPSHOT_RETENTION_STATE = Object.freeze({
  full: "full",
  redacted: "redacted",
  compacted: "compacted",
  deletedReferenceOnly: "deleted_reference_only"
});

export const PROPOSAL_DRAFT_STATUS = Object.freeze({
  generated: "generated",
  edited: "edited",
  archived: "archived"
});

export const OUTCOME_STATUS = Object.freeze({
  notApplied: "not_applied",
  skipped: "skipped",
  applied: "applied",
  viewed: "viewed",
  replied: "replied",
  interviewing: "interviewing",
  hired: "hired",
  lost: "lost"
});

export const OUTCOME_EVENT_TYPE = Object.freeze({
  markedNotApplied: "marked_not_applied",
  markedSkipped: "marked_skipped",
  proposalSent: "proposal_sent",
  proposalViewed: "proposal_viewed",
  clientReplied: "client_replied",
  interviewStarted: "interview_started",
  hired: "hired",
  lost: "lost",
  manualNote: "manual_note",
  captureDetectedStatus: "capture_detected_status",
  correction: "correction",
  voided: "voided"
});

export const PROMPT_VERSIONS = Object.freeze({
  extractPromptVersion: "extract_v1",
  scorePromptVersion: "score_prompt_v1",
  scoreRuleVersion: "score_rules_v1",
  proposalPromptVersion: "proposal_prompt_v1"
});

export const PLATFORM_HOSTS = Object.freeze({
  upwork: "www.upwork.com"
});
