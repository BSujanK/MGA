// Mirrors backend/app/models.py. Keep in sync with docs/API.md.

export type Importance = "must" | "nice";
export type GapStatus = "strong" | "partial" | "transferable" | "missing";

export interface Evidence {
  text: string;
  section?: string | null;
}

export interface Resource {
  title: string;
  provider: string;
  url: string;
  kind: string;
  cost: string;
  level: string;
  hours?: number | null;
}

export interface JobSkill {
  skill_id: string;
  name: string;
  category: string;
  importance: Importance;
  required_level: number;
  weight: number;
  years?: number | null;
  alternatives: string[];
  evidence: Evidence[];
}

export interface JobProfile {
  title?: string | null;
  company?: string | null;
  skills: JobSkill[];
  unmapped: string[];
  extractor: string;
}

export interface CandidateSkill {
  skill_id: string;
  name: string;
  category: string;
  level: number;
  claimed_level?: number | null;
  evidence: Evidence[];
}

export interface CandidateProfile {
  skills: CandidateSkill[];
  unmapped: string[];
  extractor: string;
}

export interface SkillGap {
  skill_id: string;
  name: string;
  category: string;
  importance: Importance;
  required_level: number;
  candidate_level: number;
  effective_level: number;
  gap: number;
  status: GapStatus;
  transfer_from?: string | null;
  satisfied_by?: string | null;
  alternatives: string[];
  est_hours: number;
  market_frequency?: number | null;
  job_evidence: Evidence[];
  candidate_evidence: Evidence[];
  resources: Resource[];
}

export interface GapSummary {
  readiness: number;
  must_have_coverage: number;
  strong: number;
  partial: number;
  transferable: number;
  missing: number;
  est_hours_to_close: number;
  headline: string;
}

export interface GapReport {
  job: JobProfile;
  candidate: CandidateProfile;
  summary: GapSummary;
  gaps: SkillGap[];
  extra_skills: CandidateSkill[];
}

export interface MarketSkill {
  skill_id: string;
  name: string;
  category: string;
  frequency: number;
  must_rate: number;
  avg_required_level: number;
  postings: number;
}

export interface MarketReport {
  role: string;
  location?: string | null;
  postings_analyzed: number;
  skills: MarketSkill[];
  candidate_gaps: SkillGap[];
  market_readiness?: number | null;
}

export interface JobPosting {
  id: string;
  title: string;
  company: string;
  location: string;
  experience?: string | null;
  employment_type?: string | null;
  apply_url?: string | null;
  posted_at?: string | null;
  source: string;
  description: string;
}

export interface SkillOverride {
  skill_id: string;
  level: number;
}

export interface SkillInfo {
  id: string;
  name: string;
  category: string;
}

// ---------- resume tuner ----------

export interface ChatTurn {
  question_id: string;
  skill_id?: string | null;
  question: string;
  answer: string;
}

export interface ChatQuestion {
  id: string;
  kind: "gap" | "followup" | "general";
  skill_id?: string | null;
  skill_name?: string | null;
  status?: GapStatus | null;
  question: string;
  why: string;
}

export interface AnswerFinding {
  question_id: string;
  skill_id: string;
  name: string;
  level: number;
  evidence: string;
}

export interface ChatResponse {
  question: ChatQuestion | null;
  done: boolean;
  asked: number;
  planned: number;
  findings: AnswerFinding[];
  mode: "scripted" | "claude";
}

export interface ResumeLine {
  id: string;
  text: string;
  source: "resume" | "answer" | "added";
  original?: string | null;
  skills: string[];
  relevance: number;
}

export interface ResumeEntry {
  heading: ResumeLine[];
  bullets: ResumeLine[];
  relevance: number;
}

export interface ResumeSection {
  key: string;
  title: string;
  entries: ResumeEntry[];
}

export interface GuardrailNote {
  line_id: string;
  action: "reverted" | "dropped";
  reason: string;
}

export interface KeywordGap {
  skill_id: string;
  name: string;
  importance: Importance;
}

export interface TailoredResume {
  job_title?: string | null;
  company?: string | null;
  header: string[];
  sections: ResumeSection[];
  mode: "rules" | "claude";
  keywords_matched: string[];
  keywords_missing: KeywordGap[];
  coverage_before: number;
  coverage_after: number;
  guardrail: GuardrailNote[];
  notes: string[];
  text: string;
}

/** A target job: one of the stored postings, or pasted text. */
export interface JobRef {
  job_id?: string;
  job_text?: string;
}

// ---------- prep kit ----------

export interface PrepTopic {
  id: string;
  name: string;
  hours: number;
  review: boolean;
  patterns: string[];
  checklist: string[];
}

export interface DSAPlan {
  included: boolean;
  reason: string;
  candidate_level: number;
  target_level: number;
  topics: PrepTopic[];
  resources: Resource[];
}

export interface CoreSubject {
  skill_id: string;
  name: string;
  status?: GapStatus | null;
  required_level: number;
  candidate_level: number;
  hours: number;
  topics: string[];
  resources: Resource[];
}

export interface OAFormat {
  id: string;
  name: string;
  what: string;
  prepare: string[];
  relevant: boolean;
  reason?: string | null;
}

export interface AptitudeArea {
  area: string;
  hours: number;
  topics: string[];
}

export interface PrepQuestion {
  question: string;
  theme: string;
  source: "bank" | "posting" | "ai";
  quote?: string | null;
}

export interface ProjectIdea {
  id: string;
  title: string;
  pitch: string;
  hours: number;
  covers: string[];
  builds_on: string[];
  milestones: string[];
  stretch: string[];
  score: number;
}

export interface WeekItem {
  kind: "dsa" | "core" | "aptitude" | "project";
  ref: string;
  title: string;
  hours: number;
}

export interface PrepWeek {
  week: number;
  hours: number;
  items: WeekItem[];
}

export interface PrepKit {
  job_title?: string | null;
  company?: string | null;
  readiness: number;
  dsa: DSAPlan;
  core: CoreSubject[];
  oa_formats: OAFormat[];
  posting_process: string[];
  aptitude: AptitudeArea[];
  aptitude_note: string;
  behavioral: PrepQuestion[];
  company_questions: PrepQuestion[];
  star_tip: string;
  projects: ProjectIdea[];
  schedule: PrepWeek[];
  hours_per_week: number;
  total_hours: number;
  mode: "rules" | "claude";
}
