from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_ready_ok():
    r = client.get("/health/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ready"}


def test_ready_503_when_database_down(monkeypatch):
    class Broken:
        def connect(self):
            raise RuntimeError("db down")

    monkeypatch.setattr("app.db.engine", lambda: Broken())
    r = client.get("/health/ready")
    assert r.status_code == 503
    assert "db down" not in r.text
