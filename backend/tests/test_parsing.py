import io

import docx
import pytest
from fastapi.testclient import TestClient

from app import parsing
from app.main import app

client = TestClient(app)


def make_docx() -> bytes:
    d = docx.Document()
    d.add_paragraph("Technical Skills")
    d.add_paragraph("Languages: Java, Python")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "Databases"
    t.rows[0].cells[1].text = "MySQL, MongoDB"
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def make_pdf() -> bytes:
    # Minimal one-page PDF with a text stream.
    content = b"BT /F1 12 Tf 72 720 Td (Skills: Python, Docker, Kubernetes and React) Tj ET"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i + o + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for off in offsets:
        out.write(b"%010d 00000 n \n" % off)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref))
    return out.getvalue()


def test_docx_includes_tables():
    text = parsing.file_to_text("cv.docx", make_docx())
    assert "Languages: Java, Python" in text and "MySQL, MongoDB" in text


def test_pdf():
    text = parsing.file_to_text("cv.pdf", make_pdf())
    assert "Kubernetes" in text


def test_rejects_unknown_and_empty():
    with pytest.raises(parsing.UnsupportedFile):
        parsing.file_to_text("cv.png", b"\x89PNG....")
    with pytest.raises(parsing.UnsupportedFile):
        parsing.file_to_text("cv.txt", b"hi")


def test_upload_endpoints():
    r = client.post("/resume/parse", files={"file": ("cv.docx", make_docx())})
    assert r.status_code == 200 and "Java" in r.json()["text"]
    r = client.post("/analyze/resume/file", files={"file": ("cv.pdf", make_pdf())})
    ids = {s["skill_id"] for s in r.json()["skills"]}
    assert {"python", "docker", "kubernetes", "react"} <= ids
    assert client.post("/resume/parse", files={"file": ("x.png", b"\x89PNG")}).status_code == 422
