import pytest

from app.engine.taxonomy import load_taxonomy

tax = load_taxonomy()


def ids(text):
    return [m.skill_id for m in tax.find(text)]


@pytest.mark.parametrize("text,expected", [
    ("Python, Go, C++, C#, Java", ["python", "go", "cpp", "csharp", "java"]),
    ("JavaScript and Java", ["javascript", "java"]),
    ("HTML/CSS", ["html", "css"]),
    ("React Native and ReactJS", ["react_native", "react"]),
    ("Node.js backend", ["nodejs"]),
    ("Languages: C, R, SQL.", ["c", "r", "sql"]),
    ("a Python-based tool", ["python"]),
])
def test_finds_skills(text, expected):
    assert ids(text) == expected


@pytest.mark.parametrize("text", [
    "Go to market and react to feedback",
    "the rest of the team will express interest",
    "Objective-C and R&D",
    "a tree node in spring",
])
def test_ignores_ordinary_words(text):
    assert ids(text) == []


def test_resolve_variants():
    assert tax.resolve("Python 3.11") == "python"
    assert tax.resolve("ReactJS") == "react"
    assert tax.resolve("k8s") == "kubernetes"
    assert tax.resolve("Docker containers") == "docker"
    assert tax.resolve("Underwater basket weaving") is None


def test_taxonomy_is_consistent():
    for s in tax.skills.values():
        for other in [*s.related, *s.implies]:
            assert other in tax.skills, f"{s.id} points to unknown {other}"
        assert all(0 < w <= 1 for w in s.related.values())
