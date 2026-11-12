import os
import sys
from pathlib import Path

os.environ["MGA_LLM"] = "0"  # tests never call the Claude API
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
