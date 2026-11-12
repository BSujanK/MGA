"""ATS-friendly resume export.

One column, standard section headings, real bullet lists, no tables, text
boxes, images or headers/footers: the layout applicant tracking systems parse
most reliably.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

from .models import ResumeSection

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FLAT = {"skills", "summary"}
PDF_MIME = "application/pdf"
FONT_DIR = Path(__file__).resolve().parent / "data" / "fonts"


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


def resume_pdf(header: list[str], sections: list[ResumeSection]) -> bytes:
    """A4, single column, real text (embedded DejaVu Sans), no tables or images."""
    from fpdf import FPDF
    from fpdf.enums import XPos, YPos

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_margins(18, 15, 18)
    pdf.set_auto_page_break(True, margin=15)
    pdf.set_title((header[0] if header else "Resume"))
    pdf.add_font("DejaVu", "", str(FONT_DIR / "DejaVuSans.ttf"))
    pdf.add_font("DejaVu", "B", str(FONT_DIR / "DejaVuSans-Bold.ttf"))
    pdf.add_page()
    width = pdf.w - pdf.l_margin - pdf.r_margin
    nl = {"new_x": XPos.LMARGIN, "new_y": YPos.NEXT}

    def block(text: str, *, size: float = 10, bold: bool = False, align: str = "L", h: float = 5) -> None:
        pdf.set_font("DejaVu", "B" if bold else "", size)
        pdf.multi_cell(0, h, text, align=align, **nl)

    if header:
        block(header[0], size=16, bold=True, align="C", h=8)
        if len(header) > 1:
            block(" | ".join(header[1:]), size=9.5, align="C")

    for sec in sections:
        if not sec.entries:
            continue
        pdf.ln(3)
        if pdf.get_y() > pdf.h - pdf.b_margin - 25:  # keep heading with its first lines
            pdf.add_page()
        block(sec.title.upper(), size=11, bold=True, h=6)
        y = pdf.get_y()
        pdf.set_draw_color(68, 68, 68)
        pdf.set_line_width(0.25)
        pdf.line(pdf.l_margin, y, pdf.l_margin + width, y)
        pdf.ln(1.5)
        for entry in sec.entries:
            for i, ln in enumerate(entry.heading):
                m = re.match(r"^([^:]{1,40}:)\s*(.+)$", ln.text) if sec.key == "skills" else None
                if m:
                    pdf.set_font("DejaVu", "B", 10)
                    label = m.group(1) + " "
                    pdf.write(5, label)
                    pdf.set_font("DejaVu", "", 10)
                    pdf.multi_cell(0, 5, m.group(2), align="L", **nl)
                else:
                    block(ln.text, bold=i == 0 and sec.key not in FLAT)
            for ln in entry.bullets:
                pdf.set_font("DejaVu", "", 10)
                pdf.set_x(pdf.l_margin + 4)
                pdf.multi_cell(0, 5, "\u2022 " + ln.text, align="L", **nl)
    return bytes(pdf.output())
