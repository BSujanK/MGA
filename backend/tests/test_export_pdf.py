import io
import re
from pathlib import Path

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app import export
from app.main import app
from app.models import ResumeEntry, ResumeLine, ResumeSection

client = TestClient(app)
RESUME = (Path(__file__).resolve().parent.parent / "samples" / "resume_fresher.txt").read_text()


def _lines(*texts):
    return [ResumeLine(id=f"l{i}", text=t) for i, t in enumerate(texts)]


def _extract(data: bytes) -> tuple[str, int]:
    r = PdfReader(io.BytesIO(data))
    text = "\n".join(p.extract_text() for p in r.pages)
    return re.sub(r"\s+", " ", text), len(r.pages)


def _in_order(text: str, needles: list[str]) -> None:
    pos = 0
    for n in needles:
        i = text.find(n, pos)
        assert i >= 0, f"missing or out of order: {n!r}"
        pos = i + len(n)


def test_export_pdf_tailored_resume_is_selectable_and_ordered():
    t = client.post("/resume/tailor", json={"resume_text": RESUME, "job_id": "sde1-kestrel"}).json()
    r = client.post("/resume/export/pdf", json={"header": t["header"], "sections": t["sections"], "filename": "../My Resume"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="My_Resume.pdf"'
    assert r.content.startswith(b"%PDF")
    text, _ = _extract(r.content)
    needles = [t["header"][0]]
    for s in t["sections"]:
        if not s["entries"]:
            continue
        needles.append(s["title"].upper())
        for e in s["entries"]:
            needles += [re.sub(r"\s+", " ", ln["text"]) for ln in e["heading"] + e["bullets"]]
    _in_order(text, needles)
    assert "Smart India Hackathon 2025 finalist" in text


def test_filename_default_and_extension():
    body = {"sections": [{"key": "summary", "title": "Summary", "entries": [{"heading": [{"id": "a", "text": "Hi"}]}]}]}
    assert client.post("/resume/export/pdf", json=body).headers["content-disposition"] == 'attachment; filename="resume.pdf"'
    r = client.post("/resume/export/pdf", json={**body, "filename": "cv.PDF"})
    assert r.headers["content-disposition"] == 'attachment; filename="cv.PDF"'


def test_long_resume_paginates_without_losing_text():
    bullets = [f"Bullet number {i:02d} " + "built a thing with measurable impact " * 3 for i in range(60)]
    sec = ResumeSection(key="experience", title="Experience",
                        entries=[ResumeEntry(heading=_lines("Engineer, Acme"), bullets=_lines(*bullets))])
    data = export.resume_pdf(["Long Person", "a@b.co"], [sec])
    text, pages = _extract(data)
    assert pages > 1
    _in_order(text, [f"Bullet number {i:02d}" for i in range(60)])
    assert text.count("measurable impact") == 60 * 3


def test_very_long_unbroken_line_wraps():
    word = "x" * 300
    sec = ResumeSection(key="projects", title="Projects", entries=[ResumeEntry(bullets=_lines(word))])
    text, _ = _extract(export.resume_pdf(["N"], [sec]))
    assert word in text.replace(" ", "")


def test_unicode_round_trips():
    line = "Saved ₹2 lakh – “quoted” café"
    sec = ResumeSection(key="achievements", title="Achievements", entries=[ResumeEntry(bullets=_lines(line))])
    text, _ = _extract(export.resume_pdf(["Renée O’Brien", "Pune"], [sec]))
    assert line in text
    assert "Renée O’Brien" in text


def test_skills_label_and_contact_line():
    sec = ResumeSection(key="skills", title="Skills",
                        entries=[ResumeEntry(heading=_lines("Languages: Python, Java"))])
    text, _ = _extract(export.resume_pdf(["Name", "a@b.co", "Pune"], [sec]))
    assert "a@b.co | Pune" in text and "Languages: Python, Java" in text


def test_empty_sections_skipped_and_empty_header_ok():
    empty = ResumeSection(key="projects", title="Projects", entries=[])
    full = ResumeSection(key="summary", title="Summary", entries=[ResumeEntry(heading=_lines("Hello there"))])
    text, _ = _extract(export.resume_pdf([], [empty, full]))
    assert "PROJECTS" not in text and "SUMMARY" in text and "Hello there" in text
    assert export.resume_pdf([], []).startswith(b"%PDF")
