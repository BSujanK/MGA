# MGA: product spec

**MGA (Market Gap Analysis)** shows a job seeker exactly where they stand against a specific job, and against the whole market for a role, skill by skill. It then closes the gap with a learning plan, a tailored resume, interview prep, job listings and a calendar.

## Who it's for (v1)

**Early-career tech candidates in India**: final-year students, freshers, and people with 0–2 years of experience targeting SDE, full-stack, frontend, data analyst, data engineer, ML/AI, DevOps, QA and mobile roles.

**Platform:** web first (responsive and installable as a PWA). Native mobile apps come later.

**Team:** the founder plus Claude. No fixed deadline. Build it properly, ship in small usable slices.

## Core principle: no verdicts, only gaps

MGA never says "not eligible". For every skill a job asks for, it says:

| Status | Meaning |
|---|---|
| **Strong** | You meet or beat the required level |
| **Partial** | You have it, but below the level asked |
| **Transferable** | You don't have it, but a related skill gets you part of the way (React → Next.js) |
| **Missing** | No evidence yet |

Each line shows the evidence on both sides (the sentence in the posting, the line in your resume), the hours to close the gap, and the best resources to learn it.

## Features

### 1. Core engine: gap analysis (built: v0.1)
- **Candidate vs. one job:** paste a posting or pick one from the job feed.
- **Candidate vs. the market:** aggregate every posting for a role ("SDE in Bengaluru") into skill demand, then rank the candidate's gaps by how much of the market each unlocks. This is the moat: a single ChatGPT chat can't do it, because it needs a continuously collected posting database.
- Evidence-based levels: a skill only *listed* on a resume counts less than one *used in a project or internship*.
- Understands posting language: must-have vs. nice-to-have, "strong" vs. "familiar", years of experience, "MySQL **or** PostgreSQL".

### 2. Learning recommender (seed: v0.1)
- A curated catalog of resources mapped to skill IDs, ranked by fit to the candidate's current level, then cost (free first).
- **Never** let AI invent links. Every URL comes from the curated catalog and is checked by `backend/scripts/check_links.py`.
- Next: progress tracking (mark a resource done → take a short check → level goes up → gap report updates).

### 3. Resume tuner (next)
- A chat that interviews the candidate to surface skills and achievements their resume leaves out.
- Then rewrites and reorders the resume for one target posting. ATS-friendly PDF/DOCX export.
- **Hard rule: never fabricate.** Only real experience gets emphasized and reworded. Gaps are flagged and sent to the learning plan, never papered over.

### 4. Beginner prep kit (later)
For a target company and role:
- DSA practice plan
- Online assessment (OA) patterns
- Aptitude
- Company background and culture questions
- A portfolio project designed to close the candidate's specific gaps

Questions are original or link to the source. Never copy LeetCode or GeeksforGeeks content. "Commonly asked at X" claims carry their source.

### 5. Job feed (seed: v0.1)
- Sources: public ATS job boards (Greenhouse and Lever are implemented; next: Ashby, SmartRecruiters, Workday, Keka, Darwinbox), the Adzuna API, and companies posting directly once we have an employer side.
- **Never scrape sites whose terms forbid it** (LinkedIn, Naukri, Indeed).
- Every posting gets pre-analyzed, so the gap % shows right in the job list.

### 6. Calendar (later)
- Applications, interview dates, OA deadlines and hiring drives, with reminders.
- Google Calendar sync and `.ics` export.

### 7. Employer side (later)
- Companies see candidates with explained, skill-level gaps.
- Humans make every decision. **No auto-reject.**
- This is a regulated area (EU AI Act lists CV-sorting tools as high-risk; India's DPDP Act requires consent), so it gets built after the candidate side, with consent, audit logs and bias checks.

## Business model (open decision)

Candidates come first; they are the supply that brings employers. Options to decide later:
- **Candidate freemium:** free gap reports; paid resume tuning, unlimited market reports and prep kits.
- **College licensing:** sold to training & placement (T&P) cells. Probably the easiest early revenue in India.
- **Employer subscription:** access to pre-analyzed, consenting candidates.

## Accuracy is the product

- Build a labeled evaluation set: about 100 posting/resume pairs with hand-checked skills and levels.
- Track extraction precision/recall and gap-status agreement.
- Every change to the engine has to hold or improve those numbers.
- Make no "most accurate" claims until the numbers exist.

## Privacy and trust

- Resumes are personal data. Collect consent, store them encrypted, let users delete everything, and never share with employers without explicit opt-in.
- No personal data in the repo (it's a startup codebase; keep samples synthetic).
