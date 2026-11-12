"""Score the engine against the hand-labeled evaluation set.

    cd backend && python -m eval.run [--llm] [--verbose] [--json out.json] [--write-baseline]

Reports:
- posting extraction: precision / recall / F1 over skill ids, importance accuracy and level error on matched skills
- resume extraction: precision / recall / F1, level error
- gap status agreement over 30 pairs: engine statuses vs statuses from the gold profiles
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

from app import service  # noqa: E402
from app.engine.extractor import CATEGORY_WEIGHT  # noqa: E402
from app.engine.gap import compute_gap  # noqa: E402
from app.models import (  # noqa: E402
    CandidateProfile, CandidateSkill, GapReport, Importance, JobProfile, JobSkill,
)

CASES = ROOT / "cases"
BASELINE = ROOT / "baseline.json"


def load_cases(cases: Path = CASES) -> tuple[dict, dict, list]:
    postings = {p.stem: json.loads(p.read_text()) for p in sorted((cases / "postings").glob("*.json"))}
    resumes = {p.stem: json.loads(p.read_text()) for p in sorted((cases / "resumes").glob("*.json"))}
    pairs = json.loads((cases / "pairs.json").read_text())["pairs"]
    return postings, resumes, pairs


# ---------- gold profiles ----------

def gold_job(doc: dict) -> JobProfile:
    tax = service.tax()
    skills = []
    for sid, lab in doc["skills"].items():
        sk = tax.get(sid)
        imp = Importance(lab["importance"])
        alts = [a for a in lab.get("alts", []) if a in doc["skills"]]
        base = (1.0 if imp is Importance.must else 0.4) * CATEGORY_WEIGHT.get(sk.category, 1.0)
        skills.append(JobSkill(skill_id=sid, name=sk.name, category=sk.category, importance=imp,
                               required_level=lab["level"], weight=round(base / (1 + len(alts)), 3), alternatives=sorted(alts)))
    return JobProfile(title=doc.get("title"), company=doc.get("company"), skills=skills, extractor="gold")


def gold_resume(doc: dict) -> CandidateProfile:
    tax = service.tax()
    return CandidateProfile(skills=[CandidateSkill(skill_id=sid, name=tax.get(sid).name, category=tax.get(sid).category, level=lvl)
                                    for sid, lvl in doc["skills"].items()], extractor="gold")


# ---------- metrics ----------

@dataclass
class PRF:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    level_err: list[float] = field(default_factory=list)
    imp_ok: int = 0
    misses: Counter = field(default_factory=Counter)
    false_pos: Counter = field(default_factory=Counter)

    def add(self, gold: set[str], pred: set[str]) -> None:
        self.tp += len(gold & pred)
        self.fp += len(pred - gold)
        self.fn += len(gold - pred)
        self.misses.update(gold - pred)
        self.false_pos.update(pred - gold)

    def summary(self) -> dict:
        p = self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0
        r = self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0
        f = 2 * p * r / (p + r) if p + r else 0.0
        out = {"precision": round(p, 3), "recall": round(r, 3), "f1": round(f, 3), "tp": self.tp, "fp": self.fp, "fn": self.fn}
        if self.level_err:
            out["level_mae"] = round(sum(self.level_err) / len(self.level_err), 3)
            out["level_within_0_5"] = round(sum(e <= 0.5 for e in self.level_err) / len(self.level_err), 3)
        if self.tp:
            out["importance_accuracy"] = round(self.imp_ok / self.tp, 3)
        return out


def _groups(report: GapReport) -> list[tuple[set[str], object]]:
    tax = service.tax()
    out = []
    for g in report.gaps:
        ids = {g.skill_id} | {sid for n in g.alternatives if (sid := tax.resolve(n))}
        out.append((ids, g))
    return out


def evaluate(use_llm: bool = False, cases: Path = CASES, verbose: bool = False) -> dict:
    postings, resumes, pairs = load_cases(cases)
    pred_jobs = {k: service.analyze_job(d["text"], use_llm=use_llm, title=d.get("title"), company=d.get("company"))
                 for k, d in postings.items()}
    pred_cands = {k: service.analyze_resume(d["text"], use_llm=use_llm) for k, d in resumes.items()}

    job_m, res_m = PRF(), PRF()
    per_doc: dict[str, dict] = {}
    for k, d in postings.items():
        gold, pred = d["skills"], {s.skill_id: s for s in pred_jobs[k].skills}
        job_m.add(set(gold), set(pred))
        for sid in set(gold) & set(pred):
            job_m.level_err.append(abs(pred[sid].required_level - gold[sid]["level"]))
            job_m.imp_ok += pred[sid].importance.value == gold[sid]["importance"]
        per_doc[k] = {"missed": sorted(set(gold) - set(pred)), "extra": sorted(set(pred) - set(gold)),
                      "importance_wrong": sorted(s for s in set(gold) & set(pred) if pred[s].importance.value != gold[s]["importance"])}
    for k, d in resumes.items():
        gold, pred = d["skills"], {s.skill_id: s for s in pred_cands[k].skills}
        res_m.add(set(gold), set(pred))
        for sid in set(gold) & set(pred):
            res_m.level_err.append(abs(pred[sid].level - gold[sid]))
        per_doc[k] = {"missed": sorted(set(gold) - set(pred)), "extra": sorted(set(pred) - set(gold)),
                      "level_off": sorted(s for s in set(gold) & set(pred) if abs(pred[s].level - gold[s]) > 1)}

    tax = service.tax()
    agree = total = must_agree = must_total = 0
    confusion: dict[str, Counter] = defaultdict(Counter)
    readiness_err: list[float] = []
    pair_rows = []
    for pair in pairs:
        gj, gc = gold_job(postings[pair["posting"]]), gold_resume(resumes[pair["resume"]])
        gold_rep = compute_gap(gj, gc, tax)
        pred_rep = compute_gap(pred_jobs[pair["posting"]], pred_cands[pair["resume"]], tax)
        overrides = pair.get("expected_status", {})
        pred_groups = _groups(pred_rep)
        row_agree = 0
        disagreements = []
        for ids, g in _groups(gold_rep):
            want = overrides.get(g.skill_id, g.status.value)
            match = next((pg for pids, pg in pred_groups if pids & ids), None)
            got = match.status.value if match else "not_extracted"
            confusion[want][got] += 1
            ok = got == want
            total += 1
            agree += ok
            row_agree += ok
            if g.importance is Importance.must:
                must_total += 1
                must_agree += ok
            if not ok:
                disagreements.append(f"{g.name}: gold {want}, engine {got}")
        readiness_err.append(abs(gold_rep.summary.readiness - pred_rep.summary.readiness))
        pair_rows.append({"pair": pair["id"], "agreement": round(row_agree / max(1, len(gold_rep.gaps)), 3),
                          "readiness_gold": gold_rep.summary.readiness, "readiness_engine": pred_rep.summary.readiness,
                          "disagreements": disagreements})

    job_sum = job_m.summary()
    res_sum = res_m.summary()
    res_sum.pop("importance_accuracy", None)
    report = {
        "mode": "rules+claude" if use_llm else "rules",
        "counts": {"postings": len(postings), "resumes": len(resumes), "pairs": len(pairs), "status_lines": total},
        "posting_extraction": job_sum,
        "resume_extraction": res_sum,
        "gap_status": {
            "agreement": round(agree / total, 3) if total else 0.0,
            "must_have_agreement": round(must_agree / must_total, 3) if must_total else 0.0,
            "readiness_mae": round(sum(readiness_err) / len(readiness_err), 2) if readiness_err else 0.0,
            "confusion": {k: dict(v) for k, v in sorted(confusion.items())},
        },
        "most_missed": {"postings": job_m.misses.most_common(8), "resumes": res_m.misses.most_common(8)},
        "most_false_positive": {"postings": job_m.false_pos.most_common(8), "resumes": res_m.false_pos.most_common(8)},
    }
    if verbose:
        report["documents"] = per_doc
        report["pairs"] = pair_rows
    return report


HEADLINE = [("posting_extraction", "f1"), ("posting_extraction", "precision"), ("posting_extraction", "recall"),
            ("posting_extraction", "importance_accuracy"), ("resume_extraction", "f1"), ("resume_extraction", "precision"),
            ("resume_extraction", "recall"), ("gap_status", "agreement"), ("gap_status", "must_have_agreement")]


def headline(report: dict) -> dict:
    return {f"{a}.{b}": report[a].get(b) for a, b in HEADLINE}


def _print(report: dict) -> None:
    pe, re_, gs = report["posting_extraction"], report["resume_extraction"], report["gap_status"]
    c = report["counts"]
    print(f"MGA eval v1 · mode={report['mode']} · {c['postings']} postings, {c['resumes']} resumes, {c['pairs']} pairs\n")
    print(f"Postings  P {pe['precision']:.3f}  R {pe['recall']:.3f}  F1 {pe['f1']:.3f}  "
          f"importance {pe.get('importance_accuracy', 0):.3f}  level MAE {pe.get('level_mae', 0):.2f}")
    print(f"Resumes   P {re_['precision']:.3f}  R {re_['recall']:.3f}  F1 {re_['f1']:.3f}  "
          f"level MAE {re_.get('level_mae', 0):.2f}  within 0.5: {re_.get('level_within_0_5', 0):.3f}")
    print(f"Gap status agreement {gs['agreement']:.3f} (must-haves {gs['must_have_agreement']:.3f}) · "
          f"readiness MAE {gs['readiness_mae']:.1f} points over {c['status_lines']} lines\n")
    print("Confusion (gold → engine):")
    for gold, row in gs["confusion"].items():
        print(f"  {gold:13s} " + "  ".join(f"{k}:{v}" for k, v in sorted(row.items())))
    print("\nMost missed:    postings", report["most_missed"]["postings"], "\n                resumes ", report["most_missed"]["resumes"])
    print("False positive: postings", report["most_false_positive"]["postings"], "\n                resumes ", report["most_false_positive"]["resumes"])
    for k, v in report.get("documents", {}).items():
        if any(v.values()):
            print(f"  {k}: " + "; ".join(f"{a}={b}" for a, b in v.items() if b))
    for row in report.get("pairs", []):
        if row["disagreements"]:
            print(f"  {row['pair']} ({row['agreement']:.2f}): " + " | ".join(row["disagreements"]))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--llm", action="store_true", help="evaluate rules + Claude (needs ANTHROPIC_API_KEY)")
    ap.add_argument("--verbose", action="store_true", help="per-document and per-pair errors")
    ap.add_argument("--json", type=Path, help="write the full report as JSON")
    ap.add_argument("--write-baseline", action="store_true", help="save rules-only headline numbers as the baseline")
    args = ap.parse_args(argv)
    if not args.llm:
        os.environ["MGA_LLM"] = "0"
    report = evaluate(use_llm=args.llm, verbose=args.verbose)
    _print(report)
    if args.json:
        args.json.write_text(json.dumps(report, indent=1))
    if args.write_baseline:
        if args.llm:
            print("Baseline is rules-only; run without --llm.", file=sys.stderr)
            return 2
        BASELINE.write_text(json.dumps(headline(report), indent=1) + "\n")
        print(f"\nWrote {BASELINE.relative_to(ROOT.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
