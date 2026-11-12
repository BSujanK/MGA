"""Claude-powered skill extraction (optional).

The rule engine finds skills it has aliases for. Claude reads the text the
way a recruiter would: it tells "must have 2+ years of Kafka" from "exposure
to Kafka is a plus", and "built a Kafka consumer" from "Kafka" in a list.
Its output is normalized back onto our taxonomy, so scoring stays
deterministic and explainable.

Enabled when ANTHROPIC_API_KEY is set (or an `ant auth login` profile exists
and MGA_LLM=1). Every caller must handle LLMUnavailable and fall back to rules.
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Literal, Optional

from pydantic import BaseModel

log = logging.getLogger("mga.llm")

MODEL = os.getenv("MGA_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("MGA_LLM_EFFORT", "low")  # extraction is a reading task; low effort keeps it fast and cheap
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMUnavailable(RuntimeError):
    pass


# ---------- output schemas (what Claude must return) ----------

class LLMJobSkill(BaseModel):
    name: str
    importance: Literal["must", "nice"]
    level: int  # 1-5, see rubric
    years: Optional[float]
    evidence: str


class LLMJobExtraction(BaseModel):
    title: Optional[str]
    company: Optional[str]
    skills: list[LLMJobSkill]


class LLMResumeSkill(BaseModel):
    name: str
    level: int  # 1-5, see rubric
    section: Literal["skills", "experience", "projects", "certifications", "education", "achievements", "summary"]
    evidence: str


class LLMResumeExtraction(BaseModel):
    skills: list[LLMResumeSkill]


LEVEL_RUBRIC = """Skill levels:
1 = aware: has heard of it, read about it
2 = basic: did a course or tutorial, listed it, small exercises
3 = working: used it to build a real project or in an internship/job
4 = strong: used it repeatedly in substantial work, can explain trade-offs, debug and design with it
5 = expert: deep expertise, leads others, years of production use"""

JOB_SYSTEM = f"""You extract the skills a job posting asks for, for a skill-gap analysis engine used by early-career tech candidates in India.

Rules:
- Include technical skills (languages, frameworks, databases, cloud, tools, CS fundamentals like DSA/OOP/OS/DBMS/networks/system design) and soft skills the posting explicitly asks for.
- Use the common canonical name for each skill (e.g. "React", "PostgreSQL", "Data Structures & Algorithms", "Kubernetes"). One entry per skill; merge duplicates.
- importance: "must" if it is stated as required, a core responsibility, or the posting gives no signal; "nice" if it is described as preferred, a plus, good to have, bonus, or exposure.
- level: the level the posting expects, using the rubric. "Strong/proficient/hands-on" is usually 3-4, "familiar/basic/exposure" is 2, "expert/deep" is 4-5. For fresher roles with no qualifier use 3 for must and 2 for nice.
- years: years of experience asked for that skill, or null.
- evidence: copy the exact phrase from the posting that supports the entry. Never invent skills that are not in the text.
- Ignore the company description, benefits and perks.

{LEVEL_RUBRIC}"""

RESUME_SYSTEM = f"""You extract a candidate's skills from their resume for a skill-gap analysis engine used by early-career tech candidates in India.

Rules:
- Include every technical and soft skill the resume shows. Use the common canonical name (e.g. "React", "PostgreSQL", "Data Structures & Algorithms").
- level must reflect EVIDENCE, not claims: a skill only listed in a skills section is at most 2; used in a project or internship is 3; used repeatedly in substantial work with results is 4; 5 only with clear multi-year professional depth. A self-rating ("proficient") can raise a level by at most one step above what the evidence shows.
- Strong competitive programming results (e.g. high ratings, ICPC, many solved problems) count as evidence for Data Structures & Algorithms.
- section: where the strongest evidence for the skill appears.
- evidence: copy the exact line from the resume. Never invent skills or experience that are not in the text.

{LEVEL_RUBRIC}"""


@lru_cache(maxsize=1)
def _client():
    try:
        import anthropic
    except ImportError as e:  # pragma: no cover
        raise LLMUnavailable("anthropic package not installed") from e
    return anthropic.Anthropic()


def enabled() -> bool:
    flag = os.getenv("MGA_LLM")
    if flag is not None:
        return flag.strip().lower() in ("1", "true", "yes", "on")
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _parse(system: str, text: str, schema: type[BaseModel], wrap: bool = True) -> BaseModel:
    import anthropic

    content = f"<document>\n{text}\n</document>" if wrap else text
    try:
        resp = _client().beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_format=schema,
            output_config={"effort": EFFORT},
            betas=[FALLBACK_BETA],
            fallbacks="default",  # if a safety classifier declines, the API retries on a fallback model in the same call
        )
    except (anthropic.APIConnectionError, anthropic.RateLimitError, anthropic.APIStatusError, anthropic.AuthenticationError) as e:
        raise LLMUnavailable(f"Claude API error: {e}") from e
    except Exception as e:  # missing credentials raise a plain error at client creation/request time
        raise LLMUnavailable(f"Claude unavailable: {e}") from e
    if resp.stop_reason == "refusal":
        raise LLMUnavailable("Claude declined the request")
    if resp.stop_reason == "max_tokens":
        raise LLMUnavailable("Claude output was cut off (document too long?)")
    parsed = resp.parsed_output
    if parsed is None:
        raise LLMUnavailable("Claude returned no structured output")
    log.info("llm extraction ok model=%s request_id=%s", resp.model, getattr(resp, "_request_id", None))
    return parsed


def extract_job(text: str) -> LLMJobExtraction:
    return _parse(JOB_SYSTEM, text, LLMJobExtraction)  # type: ignore[return-value]


def extract_resume(text: str) -> LLMResumeExtraction:
    return _parse(RESUME_SYSTEM, text, LLMResumeExtraction)  # type: ignore[return-value]


# ---------- resume tuner ----------
# The engine decides WHAT to ask and WHICH lines may change; Claude only words
# the question and rewords lines. Every rewrite is checked by
# engine.resume_doc.check_rewrite before it is shown.

class LLMQuestion(BaseModel):
    question: str


class LLMRewrittenLine(BaseModel):
    id: str
    text: str


class LLMRewrite(BaseModel):
    lines: list[LLMRewrittenLine]


QUESTION_SYSTEM = """You help an early-career tech candidate in India surface real experience their resume leaves out, before they apply to a specific job.

You are given the job, one skill the engine wants to ask about, what the resume currently shows for it, and the conversation so far. Write ONE short, friendly question (at most 2 sentences) that:
- asks whether and how they have used the skill, or (for a follow-up) asks for what they built, their part, and the measurable result;
- is concrete and easy to answer for a student or fresher (course projects, internships, hackathons, personal projects all count);
- never assumes they have the skill and never suggests an answer, tool or number for them;
- does not repeat a question already asked.
Return only the question."""

REWRITE_SYSTEM = """You improve the wording of resume lines so an early-career tech candidate's real experience reads well for one target job.

Hard rules (a checker rejects any line that breaks them):
- Never add a skill, tool, technology, number, metric, employer, title or outcome that the line itself does not state. Do not move facts between lines and do not merge lines.
- Keep every fact the line states. If a line cannot be improved, return it unchanged.

How to rewrite:
- Make each line a concise, ATS-friendly resume bullet: start with a strong past-tense action verb, no first person, no trailing period, under about 30 words.
- Where the line already names a skill the job asks for, put it near the front.
- Lines from "answer" are the candidate's own words from an interview: turn them into resume bullets and drop filler ("yes", "I think"), keeping every fact.
- "summary" lines: tighten the wording under the same rules; keep it as a sentence.
Return every id you were given, exactly once."""


def phrase_question(context: str) -> str:
    out = _parse(QUESTION_SYSTEM, context, LLMQuestion, wrap=False)
    q = out.question.strip()  # type: ignore[attr-defined]
    if not q or len(q) > 400:
        raise LLMUnavailable("Claude returned an unusable question")
    return q


def rewrite_lines(payload: str) -> LLMRewrite:
    return _parse(REWRITE_SYSTEM, payload, LLMRewrite, wrap=False)  # type: ignore[return-value]
