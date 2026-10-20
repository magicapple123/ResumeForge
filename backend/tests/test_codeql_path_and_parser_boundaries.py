# SPDX-License-Identifier: Apache-2.0
"""Canonical IDs, portable names and linear parser separators retain their contracts."""

from time import perf_counter

import pytest
from app.dataset_registry import DatasetError, canonical_dataset_id
from app.services.data_backup import asset_safety
from app.services.data_backup.asset_safety import safe_asset_name
from app.services.data_backup.paths import BackupError
from app.services.job_parser.candidates import _split_leading_location
from app.services.job_parser.metadata import _is_additional_preamble_line


@pytest.mark.parametrize(
    "value",
    ["main", "0000000000000000", "0000000000000001", "0123456789abcdef", "ffffffffffffffff"],
)
def test_dataset_canonicalization_preserves_all_accepted_identity_shapes(value):
    assert canonical_dataset_id(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "../main",
        "MAIN",
        "0123456789abcde/",
        "0123456789ABCDEf",
        "C:0123456789abcd",
        "0123456789abcdef\n",
        "００００００００００００００００",
    ],
)
def test_dataset_canonicalization_never_accepts_a_path_or_noncanonical_alias(value):
    with pytest.raises(DatasetError):
        canonical_dataset_id(value)


def test_primary_id_is_not_a_generated_dataset_filename():
    with pytest.raises(DatasetError):
        canonical_dataset_id("main", allow_main=False)


@pytest.mark.parametrize("value", ["简历材料.pdf", "résumé.docx", "image-1.png"])
def test_basename_boundary_does_not_rename_valid_unicode_assets(value):
    assert safe_asset_name(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "../image.png",
        "nested/image.png",
        "nested\\image.png",
        "C:image.png",
        "image.png:stream",
        "CON.txt",
    ],
)
def test_basename_boundary_rejects_instead_of_normalizing_an_invalid_asset(value):
    with pytest.raises(BackupError):
        safe_asset_name(value)


def test_path_containment_is_independent_of_basename_validation(tmp_path, monkeypatch):
    root = tmp_path / "assets"
    root.mkdir()
    # Fault injection: even a future basename-validator regression must not turn
    # a lexical root prefix into permission to access a sibling directory.
    monkeypatch.setattr(asset_safety, "safe_asset_name", lambda value: value)
    with pytest.raises(BackupError, match="受控目录"):
        asset_safety.safe_asset_path(root, "../assets-sibling/private.txt")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("北京 | 后端工程师", ("北京", "后端工程师")),
        ("北京" + " " * 80 + "—  后端工程师", ("北京", "后端工程师")),
        ("北京-2年经验", None),
        ("北京-后端工程师", ("北京", "后端工程师")),
        ("北京| ", ("北京", "")),
        ("北京|\n岗位", ("北京", "岗位")),
        ("北京|岗位\n正文", None),
    ],
)
def test_location_separator_keeps_existing_single_line_semantics(value, expected):
    assert _split_leading_location(value) == expected


def test_separator_parsing_remains_bounded_for_the_codeql_adversarial_shape():
    started = perf_counter()
    assert _split_leading_location("北京|" + " " * 100_000 + "!\nnext") is None
    assert _is_additional_preamble_line("公司" + " " * 100_000 + "- engineering")
    assert perf_counter() - started < 2.0


@pytest.mark.parametrize("value", ["总部-研发", "总部-分部 / Server", "总部" + " " * 80 + "- 研发"])
def test_org_direction_allows_internal_separators_and_long_padding(value):
    assert _is_additional_preamble_line(value)
