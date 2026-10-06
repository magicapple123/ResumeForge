import pytest
from app.schemas.profile import (
    AwardIn,
    CampusExperienceIn,
    EducationIn,
    ExperienceIn,
    ProfileUpdate,
    ProjectIn,
)
from app.services.date_format import normalize_partial_date


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("2024", "2024"),
        ("2024.6", "2024-06"),
        ("2024/6/15", "2024-06-15"),
        ("2024年6月15日", "2024-06-15"),
        ("现在", "至今"),
        ("present", "至今"),
    ],
)
def test_normalize_partial_date_keeps_supported_precision(raw, expected):
    assert normalize_partial_date(raw) == expected


def test_normalize_partial_date_preserves_unrecognized_or_invalid_values():
    assert normalize_partial_date("2024-02-30") == "2024-02-30"
    assert normalize_partial_date("待定") == "待定"


def test_profile_write_schemas_normalize_every_date_field():
    profile = ProfileUpdate(
        birth_date="2004.3",
        educations=[EducationIn(start_date="2022.9", end_date="2026年6月")],
        experiences=[ExperienceIn(start_date="2023/1/2", end_date="至今")],
        campus_experiences=[CampusExperienceIn(start_date="2023", end_date="2024.06")],
        projects=[ProjectIn(start_date="2024.1", end_date="2024-06-15")],
        awards=[AwardIn(date="2024.6.5")],
    )

    assert profile.birth_date == "2004-03"
    assert profile.educations[0].start_date == "2022-09"
    assert profile.educations[0].end_date == "2026-06"
    assert profile.experiences[0].start_date == "2023-01-02"
    assert profile.experiences[0].end_date == "至今"
    assert profile.campus_experiences[0].end_date == "2024-06"
    assert profile.projects[0].start_date == "2024-01"
    assert profile.awards[0].date == "2024-06-05"
