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
