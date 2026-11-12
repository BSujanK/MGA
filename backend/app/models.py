"""Pydantic schemas shared by the engine and the API. See docs/API.md."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# Input limits: well above any real resume or posting, far below abuse.
MAX_RESUME_CHARS = 60_000
MAX_JOB_CHARS = 50_000
MAX_OVERRIDES = 300
MAX_TURNS = 40


class Importance(str, Enum):
    must = "must"
    nice = "nice"


class GapStatus(str, Enum):
    strong = "strong"            # candidate meets or exceeds the required level
    partial = "partial"          # candidate has the skill, but below the required level
    transferable = "transferable"  # candidate lacks it but has a closely related skill
    missing = "missing"          # no evidence at all


class Evidence(BaseModel):
    text: str = Field(description="The sentence or line the skill was found in")
    section: Optional[str] = None


# ---------- job side ----------

class JobSkill(BaseModel):
    skill_id: str
    name: str
    category: str
    importance: Importance
    required_level: float = Field(ge=0, le=5, description="1=aware, 2=basic, 3=working, 4=strong, 5=expert")
    weight: float
    years: Optional[float] = None
    alternatives: list[str] = Field(default=[], description="Other skill ids that satisfy this requirement ('MySQL or PostgreSQL')")
    evidence: list[Evidence] = []


class JobProfile(BaseModel):
    title: Optional[str] = None
    company: Optional[str] = None
    skills: list[JobSkill]
    unmapped: list[str] = Field(default=[], description="Skill phrases the AI found that are not in the taxonomy yet")
    extractor: str = "rules"


# ---------- candidate side ----------

class CandidateSkill(BaseModel):
    skill_id: str
    name: str
    category: str
    level: float = Field(ge=0, le=5, description="Evidence-backed level used for scoring")
    claimed_level: Optional[float] = None
    evidence: list[Evidence] = []


class CandidateProfile(BaseModel):
    skills: list[CandidateSkill]
    unmapped: list[str] = []
    extractor: str = "rules"


class SkillOverride(BaseModel):
    """Lets a candidate correct the engine (e.g. after a quiz or self-assessment)."""
    skill_id: str
    level: float = Field(ge=0, le=5)


# ---------- learning ----------

class Resource(BaseModel):
    title: str
    provider: str
    url: str
    kind: str = Field(description="docs | course | video | practice | book")
    cost: str = Field(description="free | paid | freemium")
    level: str = Field(description="beginner | intermediate | advanced")
    hours: Optional[float] = None


# ---------- gap report ----------

class SkillGap(BaseModel):
    skill_id: str
    name: str
    category: str
    importance: Importance
    required_level: float
    candidate_level: float
    effective_level: float = Field(description="Candidate level after giving credit for related skills")
    gap: float
    status: GapStatus
    transfer_from: Optional[str] = Field(default=None, description="Related skill that earned partial credit")
    satisfied_by: Optional[str] = Field(default=None, description="Alternative skill the candidate has that meets this requirement")
    alternatives: list[str] = Field(default=[], description="Names of other skills that would also meet this requirement")
    est_hours: float
    market_frequency: Optional[float] = Field(default=None, description="Share of market postings that ask for this skill")
    job_evidence: list[Evidence] = []
    candidate_evidence: list[Evidence] = []
    resources: list[Resource] = []


class GapSummary(BaseModel):
    readiness: float = Field(description="0-100, weighted share of required skill levels the candidate already covers")
    must_have_coverage: float = Field(description="0-100, readiness over must-have skills only")
    strong: int
    partial: int
    transferable: int
    missing: int
    est_hours_to_close: float
    headline: str


class GapReport(BaseModel):
    job: JobProfile
    candidate: CandidateProfile
    summary: GapSummary
    gaps: list[SkillGap] = Field(description="Every job skill, sorted by learning priority")
    extra_skills: list[CandidateSkill] = Field(default=[], description="Candidate skills the job did not ask for")


# ---------- market ----------

class MarketSkill(BaseModel):
    skill_id: str
    name: str
    category: str
    frequency: float = Field(description="Share of postings (0-1) that mention the skill")
    must_rate: float = Field(description="Of postings mentioning it, share that list it as must-have")
    avg_required_level: float
    postings: int


class MarketReport(BaseModel):
    role: str
    location: Optional[str] = None
    postings_analyzed: int
    skills: list[MarketSkill]
    candidate_gaps: list[SkillGap] = Field(default=[], description="Present when a candidate was supplied: market skills ranked by how much closing them would help")
    market_readiness: Optional[float] = None


# ---------- jobs ----------

class JobPosting(BaseModel):
    id: str
    title: str
    company: str
    location: str
    experience: Optional[str] = None
    employment_type: Optional[str] = None
    apply_url: Optional[str] = None
    posted_at: Optional[str] = None
    source: str = "sample"
    description: str

    @field_validator("apply_url")
    @classmethod
    def _safe_url(cls, v: Optional[str]) -> Optional[str]:
        """Job boards are untrusted: only plain http(s) links, never javascript: or data: URLs."""
        if not v:
            return None
        v = v.strip()
        if not v.lower().startswith(("http://", "https://")) or any(ord(ch) < 33 or ord(ch) == 127 for ch in v):
            return None
        return v[:1000]


# ---------- requests ----------

class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_JOB_CHARS)
    use_llm: Optional[bool] = Field(default=None, description="Force AI extraction on/off. Default: on when an API key is configured")


class GapRequest(BaseModel):
    resume_text: Optional[str] = Field(default=None, max_length=MAX_RESUME_CHARS)
    overrides: list[SkillOverride] = Field(default=[], max_length=MAX_OVERRIDES)
    job_text: Optional[str] = Field(default=None, max_length=MAX_JOB_CHARS)
    job_id: Optional[str] = None
    use_llm: Optional[bool] = None
    include_resources: bool = True


class MarketRequest(BaseModel):
    role: str = Field(max_length=100)
    location: Optional[str] = Field(default=None, max_length=100)
    resume_text: Optional[str] = Field(default=None, max_length=MAX_RESUME_CHARS)
    overrides: list[SkillOverride] = Field(default=[], max_length=MAX_OVERRIDES)
    use_llm: Optional[bool] = None
    top: int = Field(default=25, ge=1, le=100)


# ---------- resume tuner ----------

class JobRef(BaseModel):
    """A target job: one of the stored postings, or pasted text."""
    job_id: Optional[str] = Field(default=None, max_length=200)
    job_text: Optional[str] = Field(default=None, max_length=MAX_JOB_CHARS)


class ChatTurn(BaseModel):
    question_id: str = Field(max_length=120)
    skill_id: Optional[str] = Field(default=None, max_length=60)
    question: str = Field(max_length=1000)
    answer: str = Field(default="", max_length=4000, description="Empty means the candidate skipped the question")


class ChatQuestion(BaseModel):
    id: str
    kind: str = Field(description="gap | followup | general")
    skill_id: Optional[str] = None
    skill_name: Optional[str] = None
    status: Optional[GapStatus] = None
    question: str
    why: str = Field(description="Why we are asking, in plain words")


class AnswerFinding(BaseModel):
    """A skill the candidate's own answers give evidence for."""
    question_id: str
    skill_id: str
    name: str
    level: float
    evidence: str


class ChatRequest(JobRef):
    resume_text: Optional[str] = Field(default=None, max_length=MAX_RESUME_CHARS)
    overrides: list[SkillOverride] = Field(default=[], max_length=MAX_OVERRIDES)
    turns: list[ChatTurn] = Field(default=[], max_length=MAX_TURNS)
    max_questions: int = Field(default=6, ge=1, le=12)
    use_llm: Optional[bool] = None


class ChatResponse(BaseModel):
    question: Optional[ChatQuestion] = Field(description="Next question, or null when the interview is done")
    done: bool
    asked: int
    planned: int
    findings: list[AnswerFinding] = []
    mode: str = Field(description="scripted | claude")


class ResumeLine(BaseModel):
    id: str = Field(max_length=120)
    text: str = Field(max_length=2000)
    source: str = Field(default="resume", description="resume | answer")
    original: Optional[str] = Field(default=None, description="Text before rewording; set only when the line changed")
    skills: list[str] = Field(default=[], description="Names of job skills this line mentions")
    relevance: float = 0.0


class ResumeEntry(BaseModel):
    """A project or role: optional heading lines (title, dates) and bullets."""
    heading: list[ResumeLine] = []
    bullets: list[ResumeLine] = []
    relevance: float = 0.0


class ResumeSection(BaseModel):
    key: str = Field(description="summary | skills | experience | projects | achievements | certifications | education | answers")
    title: str
    entries: list[ResumeEntry] = []


class GuardrailNote(BaseModel):
    line_id: str
    action: str = Field(description="reverted | dropped")
    reason: str


class KeywordGap(BaseModel):
    skill_id: str
    name: str
    importance: Importance


class TailorRequest(JobRef):
    resume_text: str = Field(min_length=1, max_length=MAX_RESUME_CHARS)
    overrides: list[SkillOverride] = Field(default=[], max_length=MAX_OVERRIDES)
    turns: list[ChatTurn] = Field(default=[], max_length=MAX_TURNS)
    use_llm: Optional[bool] = None


class TailoredResume(BaseModel):
    job_title: Optional[str] = None
    company: Optional[str] = None
    header: list[str] = []
    sections: list[ResumeSection] = []
    mode: str = Field(description="rules | claude")
    keywords_matched: list[str] = Field(default=[], description="Job skills the tailored resume mentions")
    keywords_missing: list[KeywordGap] = Field(default=[], description="Job skills with no evidence anywhere: never added, sent to the learning plan")
    coverage_before: float = Field(description="0-100, weighted share of job skills the original resume mentions")
    coverage_after: float
    guardrail: list[GuardrailNote] = []
    notes: list[str] = []
    text: str = Field(description="Plain-text version of the tailored resume")


class ExportRequest(BaseModel):
    header: list[str] = Field(default=[], max_length=10)
    sections: list[ResumeSection] = Field(max_length=40)
    filename: Optional[str] = Field(default=None, max_length=80)


# ---------- prep kit ----------

class PrepTopic(BaseModel):
    id: str
    name: str
    hours: float
    review: bool = Field(default=False, description="Quick review only: the candidate's level already covers it")
    patterns: list[str] = []
    checklist: list[str] = Field(default=[], description="Original practice tasks: 'can you do this?'")


class DSAPlan(BaseModel):
    included: bool
    reason: str
    candidate_level: float = 0
    target_level: float = 0
    topics: list[PrepTopic] = []
    resources: list[Resource] = []


class CoreSubject(BaseModel):
    skill_id: str
    name: str
    status: Optional[GapStatus] = None
    required_level: float
    candidate_level: float
    hours: float
    topics: list[str]
    resources: list[Resource] = []


class OAFormat(BaseModel):
    id: str
    name: str
    what: str
    prepare: list[str]
    relevant: bool = Field(description="Whether this posting points to this format")
    reason: Optional[str] = None


class AptitudeArea(BaseModel):
    area: str
    hours: float
    topics: list[str]


class PrepQuestion(BaseModel):
    question: str
    theme: str
    source: str = Field(description="bank (original MGA question) | posting (built from a quoted line) | ai (Claude, grounded in a quoted line)")
    quote: Optional[str] = Field(default=None, description="Exact text from the posting this question is based on")


class ProjectIdea(BaseModel):
    id: str
    title: str
    pitch: str
    hours: float
    covers: list[str] = Field(description="Your gaps for this job that the project closes")
    builds_on: list[str] = Field(description="Skills you already have that the project uses")
    milestones: list[str]
    stretch: list[str] = []
    score: float


class WeekItem(BaseModel):
    kind: str = Field(description="dsa | core | aptitude | project")
    ref: str
    title: str
    hours: float


class PrepWeek(BaseModel):
    week: int
    hours: float
    items: list[WeekItem]


class PrepRequest(JobRef):
    resume_text: Optional[str] = Field(default=None, max_length=MAX_RESUME_CHARS)
    overrides: list[SkillOverride] = Field(default=[], max_length=MAX_OVERRIDES)
    hours_per_week: float = Field(default=10, ge=2, le=60)
    use_llm: Optional[bool] = None


class PrepKit(BaseModel):
    job_title: Optional[str] = None
    company: Optional[str] = None
    readiness: float
    dsa: DSAPlan
    core: list[CoreSubject] = []
    oa_formats: list[OAFormat] = []
    posting_process: list[str] = Field(default=[], description="Lines from the posting about the hiring process, quoted verbatim")
    aptitude: list[AptitudeArea] = []
    aptitude_note: str = ""
    behavioral: list[PrepQuestion] = []
    company_questions: list[PrepQuestion] = []
    star_tip: str = ""
    projects: list[ProjectIdea] = []
    schedule: list[PrepWeek] = []
    hours_per_week: float
    total_hours: float
    mode: str = Field(description="rules | claude (company questions)")


# ---------- job fit ----------

class JobFitRequest(BaseModel):
    resume_text: Optional[str] = Field(default=None, max_length=MAX_RESUME_CHARS, description="Omit when signed in to use your saved resume")
    overrides: list[SkillOverride] = Field(default=[], max_length=MAX_OVERRIDES)
    role: Optional[str] = Field(default=None, max_length=100)
    location: Optional[str] = Field(default=None, max_length=100)
    q: Optional[str] = Field(default=None, max_length=100)
    limit: int = Field(default=20, ge=1, le=100)


class JobCard(BaseModel):
    id: str
    title: str
    company: str
    location: str
    experience: Optional[str] = None
    employment_type: Optional[str] = None
    apply_url: Optional[str] = None
    posted_at: Optional[str] = None
    source: str


class JobFit(BaseModel):
    job: JobCard
    readiness: float
    must_have_coverage: float
    open_must: list[str] = Field(description="Must-have skills not yet at the level asked, highest priority first")
    est_hours: float


class JobFitResponse(BaseModel):
    jobs: list[JobFit] = Field(description="Closest first")
    considered: int
    used_saved_profile: bool
