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


# ---------- fixes found by the evaluation set (eval/) ----------

def test_slash_links_only_its_neighbours():
    from app.engine.extractor import extract_job
    job = extract_job("Good to have: Kubernetes, Terraform, Prometheus/Grafana monitoring", tax)
    assert all(not s.alternatives for s in job.skills)
    job = extract_job("Requirements\n- SQL (MySQL/PostgreSQL)", tax)
    by = {s.skill_id: s for s in job.skills}
    assert by["mysql"].alternatives == ["postgresql"]


def test_short_exact_aliases_in_clear_prose():
    found = lambda s: {m.skill_id for m in tax.find(s)}
    assert "go" in found("Services written in Go handle 2M requests")
    assert "go" in found("Strong Go skills are a must")
    assert "c" in found("Strong C programming skills") and "c" in found("Strong C skills")
    for text in ("Go to the careers page.", "Our clients include C-suite teams and R&D labs.", "Ready to go live soon"):
        assert not found(text) & {"go", "c", "r"}, text


def test_resume_inline_header_opens_section():
    from app.engine.extractor import extract_resume
    text = "Internship: DevOps Intern, Acme (2025)\n- Set up Jenkins CI/CD pipelines that build Docker images"
    levels = {s.skill_id: s.level for s in extract_resume(text, tax).skills}
    assert levels["ci_cd"] == 3.0 and levels["docker"] == 3.0


def test_self_rating_applies_to_its_own_segment():
    from app.engine.extractor import extract_resume
    levels = {s.skill_id: s.level for s in extract_resume("Skills\nPython (advanced), SQL, Git", tax).skills}
    assert levels["python"] == 3.0 and levels["sql"] == 2.0 and levels["git"] == 2.0


def test_learning_section_counts_as_coursework():
    from app.engine.extractor import extract_resume
    text = "Experience\n- Built reports in Excel\nLearning\n- Python for Everybody (online course)"
    levels = {s.skill_id: s.level for s in extract_resume(text, tax).skills}
    assert levels["excel"] == 3.0 and levels["python"] == 2.0


def test_prose_resume_project_sentence():
    from app.engine.extractor import extract_resume
    text = "My capstone, a clinic booking system, uses React on the front end and MongoDB for storage."
    levels = {s.skill_id: s.level for s in extract_resume(text, tax).skills}
    assert levels["react"] == 3.0 and levels["mongodb"] == 3.0


def test_competitive_programming_counts_for_dsa():
    from app.engine.extractor import extract_resume
    levels = {s.skill_id: s.level for s in extract_resume("Achievements\n- Codeforces Expert, ICPC regionalist", tax).skills}
    assert levels["dsa"] == 3.0
