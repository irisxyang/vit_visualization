"""
ImageNet class label loader.

Reads `data/imagenet_classes.csv` once at startup. The CSV must have
two columns: `class_id` (int) and `class_name` (string). A header row
is expected. Class names containing commas must be properly CSV-quoted.

Lookup is O(1) after load. Missing class_ids raise — both the loader's
own validation and downstream consumers (precomputed_loader) treat an
unknown id as a hard error rather than silently returning a placeholder.
"""

from __future__ import annotations

import csv
from typing import Optional

from . import storage

_labels: dict[int, str] = {}


def load() -> None:
    """Read the CSV. Called once at app startup."""
    global _labels

    path = storage.DATA_ROOT / "imagenet_classes.csv"
    if not path.exists():
        raise RuntimeError(f"missing class labels: {path}")

    table: dict[int, str] = {}
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None or "class_id" not in reader.fieldnames or "class_name" not in reader.fieldnames:
            raise RuntimeError(
                f"{path}: expected header with 'class_id' and 'class_name' columns, "
                f"got {reader.fieldnames!r}"
            )
        for i, row in enumerate(reader, start=2):  # row 1 is the header
            try:
                class_id = int(row["class_id"])
            except (TypeError, ValueError) as exc:
                raise RuntimeError(f"{path} line {i}: invalid class_id {row.get('class_id')!r}") from exc
            class_name = row["class_name"]
            if not class_name:
                raise RuntimeError(f"{path} line {i}: empty class_name for class_id {class_id}")
            if class_id in table:
                raise RuntimeError(f"{path} line {i}: duplicate class_id {class_id}")
            table[class_id] = class_name

    _labels = table
    print(f"[class_labels] loaded {len(_labels)} class labels")


def get(class_id: int) -> str:
    """Return the class name, raising if class_id is unknown."""
    name = _labels.get(class_id)
    if name is None:
        raise KeyError(f"unknown class_id {class_id} (no entry in imagenet_classes.csv)")
    return name


def maybe_get(class_id: int) -> Optional[str]:
    return _labels.get(class_id)