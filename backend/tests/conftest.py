import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="nexus_test_")
os.environ["NEXUS_DATA_DIR"] = _tmp

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def upload_and_commit(client, path, **over):
    with open(path, "rb") as f:
        up = client.post("/api/uploads", files={"file": (os.path.basename(path), f.read())})
    assert up.status_code == 200, up.text
    uid = up.json()["upload_id"]
    sheet = up.json()["sheets"][0]
    pv = client.get(f"/api/uploads/{uid}/preview", params={"sheet": sheet, "header_row": 1,
                                                          **({"dataset_id": over["dataset_id"]} if over.get("dataset_id") else {})}).json()
    body = {"upload_id": uid, "sheet": sheet, "header_row": 1, "dataset_name": "Pruebas", "institution": "Sintética",
            "period": "2026-01", "cutoff": "2026-01-31", "mode": "new", "data_kind": "movements",
            "mapping": pv["proposed_mapping"], **over}
    return client.post("/api/imports", json=body), pv
