from app.engine.extractor import extract_job, extract_resume
from app.engine.taxonomy import load_taxonomy
from app.models import Importance

tax = load_taxonomy()

JD = """About us
We love Kubernetes and Python.
Requirements
- Strong Java and Spring Boot
- 2+ years of SQL (MySQL or PostgreSQL)
- Familiarity with Git
Nice to have
- Docker
- Exposure to Kafka
"""


def job_skills(text=JD):
    return {s.skill_id: s for s in extract_job(text, tax).skills}


def test_sections_set_importance():
    s = job_skills()
    assert s["java"].importance is Importance.must
    assert s["docker"].importance is Importance.nice
    assert s["kafka"].importance is Importance.nice


def test_about_section_is_ignored():
    s = job_skills()
    assert "kubernetes" not in s and "python" not in s


def test_levels_and_years():
    s = job_skills()
    assert s["java"].required_level >= 3.5      # "Strong"
    assert s["git"].required_level == 2.0       # "Familiarity"
    assert s["sql"].years == 2.0


def test_or_makes_alternatives():
    s = job_skills()
    assert s["mysql"].alternatives == ["postgresql"]
    assert s["sql"].alternatives == []          # parent skill stays its own requirement


def test_strong_beats_plus():
    s = job_skills("Requirements\n- Strong DSA (competitive programming is a plus)")
    assert s["dsa"].importance is Importance.must


def test_explicit_nice_beats_duties_mention():
    s = job_skills("What you'll do\n- Deploy services on Kubernetes\nGood to have\n- Kubernetes, Redis")
    assert s["kubernetes"].importance is Importance.nice


RESUME = """Technical Skills
Languages: Java, Python
Tools: Git
Projects
- Built a REST API with Spring Boot and MySQL
- Developed a dashboard in React
- Built a Spring Boot microservice
"""


def resume_skills():
    return {s.skill_id: s for s in extract_resume(RESUME, tax).skills}


def test_resume_inline_skill_lines_are_read():
    s = resume_skills()
    assert {"java", "python", "git"} <= set(s)


def test_resume_levels_follow_evidence():
    s = resume_skills()
    assert s["python"].level == 2.0             # only listed
    assert s["react"].level == 3.0              # used in a project
    assert s["spring"].level > 3.0              # used in two projects


def test_resume_implied_skills():
    s = resume_skills()
    assert s["sql"].level == s["mysql"].level   # MySQL implies SQL
    assert s["javascript"].level == s["react"].level
    assert s["java"].level >= s["spring"].level
