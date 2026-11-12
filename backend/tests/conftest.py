import os
import sys
import tempfile
from pathlib import Path

os.environ["MGA_LLM"] = "0"  # tests never call the Claude API
os.environ["MGA_ENV"] = "test"
# A throwaway database per test run. Set MGA_TEST_DATABASE_URL to run the suite on Postgres.
_tmp = tempfile.mkdtemp(prefix="mga-test-")
os.environ["DATABASE_URL"] = os.environ.get("MGA_TEST_DATABASE_URL") or f"sqlite:///{_tmp}/test.db"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if os.environ.get("MGA_TEST_DATABASE_URL"):
    from app.db import reset_for_tests  # start from empty tables on a shared server
    reset_for_tests()


import pytest  # noqa: E402


@pytest.fixture
def llm_on(monkeypatch):
    """Pretend Claude is configured and open to anonymous callers, for tests that fake its responses."""
    from app import limits, llm
    from app.config import Settings
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(limits, "settings", lambda: Settings(llm_public=True))
