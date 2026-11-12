"""Turn uploaded resume files into plain text. PDF, DOCX and TXT."""
from __future__ import annotations

import io
import re

MAX_BYTES = 5 * 1024 * 1024


class UnsupportedFile(ValueError):
    pass


def _tidy(text: str) -> str:
    text = text.replace("\x00", "").replace(" ", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def pdf_to_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def docx_to_text(data: bytes) -> str:
    import docx

    d = docx.Document(io.BytesIO(data))
    lines = [p.text for p in d.paragraphs]
    for table in d.tables:  # many resume templates lay out skills in tables
        for row in table.rows:
            lines.append(" | ".join(c.text.strip() for c in row.cells if c.text.strip()))
    return "\n".join(lines)


def file_to_text(filename: str, data: bytes) -> str:
    if len(data) > MAX_BYTES:
        raise UnsupportedFile("File is larger than 5 MB")
    name = (filename or "").lower()
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        text = pdf_to_text(data)
    elif name.endswith(".docx") or data[:2] == b"PK":
        text = docx_to_text(data)
    elif name.endswith((".txt", ".md")) or not name:
        text = data.decode("utf-8", errors="replace")
    else:
        raise UnsupportedFile("Upload a PDF, DOCX or TXT file")
    text = _tidy(text)
    if len(text) < 30:
        raise UnsupportedFile("Couldn't read text from this file. If it is a scanned image, upload a text-based PDF or DOCX.")
    return text
