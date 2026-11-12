from app.engine.gap import compute_gap, est_hours
from app.engine.taxonomy import load_taxonomy
from app.models import CandidateProfile, CandidateSkill, GapStatus, Importance, JobProfile, JobSkill

tax = load_taxonomy()


def job(*skills):
    out = []
    for sid, imp, lvl, *alts in skills:
        sk = tax.get(sid)
        out.append(JobSkill(skill_id=sid, name=sk.name, category=sk.category, importance=imp,
                            required_level=lvl, weight=1.0 if imp is Importance.must else 0.4,
                            alternatives=alts[0] if alts else []))
    return JobProfile(skills=out)


def cand(**levels):
    return CandidateProfile(skills=[CandidateSkill(skill_id=k, name=tax.get(k).name, category=tax.get(k).category, level=v)
                                    for k, v in levels.items()])


M, N = Importance.must, Importance.nice


def statuses(report):
    return {g.skill_id: g.status for g in report.gaps}


def test_four_statuses():
    r = compute_gap(job(("java", M, 3), ("python", M, 3), ("nextjs", M, 3), ("kubernetes", M, 3)),
                    cand(java=3.5, python=2, react=3), tax)
    st = statuses(r)
    assert st == {"java": GapStatus.strong, "python": GapStatus.partial,
                  "nextjs": GapStatus.transferable, "kubernetes": GapStatus.missing}


def test_transfer_credit_is_capped():
    r = compute_gap(job(("nextjs", M, 4)), cand(react=5), tax)
    g = r.gaps[0]
    assert g.effective_level <= 3.0 and g.status is GapStatus.transferable


def test_alternatives_satisfy_requirement_and_collapse():
    r = compute_gap(job(("mysql", M, 3, ["postgresql"]), ("postgresql", M, 3, ["mysql"])), cand(mysql=3), tax)
    assert len(r.gaps) == 1
    assert r.gaps[0].status is GapStatus.strong and r.gaps[0].alternatives == ["PostgreSQL"]
    assert r.summary.readiness == 100.0


def test_readiness_and_priority():
    r = compute_gap(job(("java", M, 3), ("docker", N, 2), ("dsa", M, 3)), cand(java=3), tax)
    assert 0 < r.summary.readiness < 100
    assert r.gaps[0].skill_id == "dsa"           # missing must-have comes before missing nice-to-have
    assert r.gaps[-1].status is GapStatus.strong
    assert r.summary.missing == 2


def test_extra_skills_listed():
    r = compute_gap(job(("java", M, 3)), cand(java=3, react=3), tax)
    assert [s.skill_id for s in r.extra_skills] == ["react"]


def test_hours():
    assert est_hours(30, 0, 3) == 30
    assert est_hours(30, 3, 3) == 0
    assert est_hours(30, 3, 4) == 18             # beyond level 3 costs more per step
