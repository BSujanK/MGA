"""ATS-friendly resume export.

One column, standard section headings, real bullet lists, no tables, text
boxes, images or headers/footers: the layout applicant tracking systems parse
most reliably.
"""
from __future__ import annotations

import io
import re

from .models import ResumeSection

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FLAT = {"skills", "summary"}


def _bottom_border(paragraph) -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    p_pr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    for k, v in {"w:val": "single", "w:sz": "6", "w:space": "1", "w:color": "444444"}.items():
        bottom.set(qn(k), v)
    borders.append(bottom)
    p_pr.append(borders)


def resume_docx(header: list[str], sections: list[ResumeSection]) -> bytes:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Inches, Pt

    doc = Document()
    for s in doc.sections:
        s.top_margin = s.bottom_margin = Inches(0.6)
        s.left_margin = s.right_margin = Inches(0.7)
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(2)

    if header:
        name = doc.add_paragraph()
        name.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = name.add_run(header[0])
        run.bold = True
        run.font.size = Pt(16)
        if len(header) > 1:
            contact = doc.add_paragraph(" | ".join(header[1:]))
            contact.alignment = WD_ALIGN_PARAGRAPH.CENTER

    for sec in sections:
        if not sec.entries:
            continue
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(10)
        h.paragraph_format.space_after = Pt(4)
        run = h.add_run(sec.title.upper())
        run.bold = True
        run.font.size = Pt(11.5)
        _bottom_border(h)
        for entry in sec.entries:
            for i, ln in enumerate(entry.heading):
                p = doc.add_paragraph()
                m = re.match(r"^([^:]{1,40}:)\s*(.+)$", ln.text) if sec.key == "skills" else None
                if m:
                    p.add_run(m.group(1) + " ").bold = True
                    p.add_run(m.group(2))
                else:
                    p.add_run(ln.text).bold = i == 0 and sec.key not in FLAT
            for ln in entry.bullets:
                doc.add_paragraph(ln.text, style="List Bullet")

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
