# MGA evaluation set (v1)

Accuracy is the product, so every engine change is measured against this set.

```bash
cd backend && python -m eval.run              # rules-only engine
python -m eval.run --llm                      # rules + Claude (needs ANTHROPIC_API_KEY)
python -m eval.run --verbose                  # per-case misses and false positives
python -m eval.run --json eval/last.json      # machine-readable report
python -m eval.run --write-baseline           # accept current numbers as the new baseline
```

`tests/test_eval.py` fails if rules-only numbers drop below `baseline.json` (with a small tolerance). An engine change that lowers them needs a reason, and then a new baseline.

## Layout

- `cases/postings/*.json`: a synthetic job posting and its hand labels
- `cases/resumes/*.json`: a synthetic resume and its hand labels
- `cases/pairs.json`: 30 resume × posting pairs used for gap-status agreement

Every document is **synthetic**: fictional people and companies, no real personal data. Several contain deliberate traps for the extractor: ambiguous words ("Go", "C-suite", "R&D", "excel at", "spring internship"), tech named only in the company description, prose with no section headings, and "X or Y" alternatives.

## Labeling conventions

Labels use skill ids from `app/data/skills.json`. Label what a careful recruiter would read from the text, not what the engine finds.

**Postings** (`skills`: `{id: {importance, level, alts?}}`)
- Include every skill the posting asks the candidate to have or use, including ones that appear only in responsibilities. Skip tech that appears only in "about us", benefits or the company description.
- `importance`: `must` if required, a core duty, or unqualified. `nice` if "plus", "preferred", "bonus", "good to have", "exposure to".
- `level`: 2 = familiar/basic/exposure; 3 = plain requirement or "experience with"; 3.5 = strong/solid/proficient/hands-on; 4 = expert/deep, or 3+ years. A nice-to-have with no qualifier is 2.
- `alts`: other skill ids that satisfy the same requirement ("MySQL or PostgreSQL").
- Soft skills only when the posting asks for them explicitly.

**Resumes** (`skills`: `{id: level}`)
- **Levels by evidence:** 2 = only listed or coursework; 3 = used in a project, internship or job; 3.5 = used in two or more real projects or roles; 4 = substantial repeated professional use with results.
- **Self-ratings:** a self-rating can lift a level by at most one step.
- **Implied skills:** include skills that are clearly implied (Spring Boot ⇒ Java, MySQL ⇒ SQL, React ⇒ JavaScript, Kubernetes ⇒ Docker, pandas ⇒ Python) at the same level as the skill that implies them.
- **Strong competitive programming** (high ratings, many solved problems) counts as DSA evidence.

**Gap status**
- Gold statuses come from running `engine/gap.compute_gap` on the gold profiles. Agreement therefore measures how much *extraction* errors change what the candidate sees, independent of the scoring rules.
- A pair may add `expected_status` to override the derived status where a human judges differently.

These labels were written by Claude for v1 and should be reviewed by a person before the numbers are quoted externally. Grow the set to about 100 pairs (see `docs/PRODUCT.md`), with labels from at least two people and their agreement measured.

## Results (rules-only)

| | First run (v0.2 engine) | After fixes (baseline) |
|---|---|---|
| Postings: precision / recall / F1 | 0.991 / 0.955 / 0.972 | 0.991 / 0.991 / 0.991 |
| Postings: importance accuracy | 0.991 | 0.991 |
| Resumes: precision / recall / F1 | 0.989 / 0.948 / 0.968 | 0.989 / 0.969 / 0.979 |
| Resumes: level MAE (levels within 0.5) | 0.30 (77%) | 0.09 (96%) |
| Gap-status agreement (must-haves) | 0.799 (0.765) | 0.920 (0.898) |
| Readiness MAE | 7.2 points | 2.8 points |

**Read these numbers with care:**
- **Not blind.** The engine was fixed using errors this set exposed, so it is no longer a blind test. The fixes were general rules, not per-document patches:
  - an inline resume heading opens a section;
  - a self-rating applies only to its own comma segment;
  - "Learning" counts as coursework;
  - prose project sentences count as project evidence;
  - "Go", "C" and "R" match in clear prose;
  - a "/" joins only its neighbours;
  - aliases added for competitive programming, "object-oriented design", "component tests" and "take ownership".
- **Optimistic.** The documents were written by someone who knows the taxonomy, so real resumes and postings will score lower, especially PDFs with broken layout.
- **Next step:** add a held-out set written and labeled by other people before quoting any accuracy claim. The PRODUCT.md rule stands: no "most accurate" claims until those numbers exist.

**Known remaining disagreements:**
- Statistics in p03: the posting lists it as a duty and as a nice-to-have, and the engine's precedence rule picks nice.
- Monitoring under MLOps in p05.
- Levels that need judgment the rules can't make: a Codeforces rating, three years of professional Excel, one project counted twice when its title line names the stack.
