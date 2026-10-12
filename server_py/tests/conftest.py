import os
import tempfile

os.environ["DB_PATH"] = os.environ.get(
    "TEST_DB_PATH", os.path.join(tempfile.gettempdir(), "tradehub_py_test.db")
)
os.environ["NODE_ENV"] = "development"
os.environ.setdefault("RUN_SCHEDULER", "false")

if os.path.exists(os.environ["DB_PATH"]):
    os.remove(os.environ["DB_PATH"])