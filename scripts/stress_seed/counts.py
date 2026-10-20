# SPDX-License-Identifier: Apache-2.0
"""Row-count presets per scale level.

``scale`` expresses the target number of ``job`` rows. The classic dataset
was built at ``BASE_SCALE = 1250`` jobs; every other count is derived
proportionally so the shape of the dataset (status distributions, long-text
quotas, relational fan-out) stays comparable across scales.

Track rows must stay a multiple of 12: the generator assigns
``company = COMPANIES[i // 12]`` and ``title = TITLES[i % 12]`` and the
``(company_key, title_key)`` pair is unique.
"""

from __future__ import annotations

from dataclasses import dataclass, fields

from .vocab import COMPANIES

# The track generator (``gen_apply.seed_tracks``) derives
# ``company = COMPANIES[i // 12]``, so the company pool is a hard capacity
# bound: at most ``len(COMPANIES) * 12`` unique (company_key, title_key)
# tracks. 2026-10-13 (PR-17): scale >= 2000 previously derived 2304 tracks
# and crashed with IndexError; the derived value is now capped at capacity.
TRACK_MAX_COUNT = len(COMPANIES) * 12


@dataclass(frozen=True)
class ScaleCounts:
    """Row counts for every scaled domain of the dataset."""

    job: int
    candidate_job: int
    resume: int
    resume_generate_task: int
    resume_delivery_record: int
    apply_task: int
    apply_task_item: int
    application_track: int
    knowledge_entry: int
    material: int
    interview_session: int
    user_file_png: int
    user_file_pdf: int
    user_file_docx: int
    user_file_md: int
    user_file_txt: int

    def validate(self) -> None:
        """Reject combinations the generators cannot produce correctly."""
        problems: list[str] = []
        if self.job < 12:
            problems.append("job must be >= 12 (queue/match generators index into it)")
        if self.application_track < 12 or self.application_track % 12 != 0:
            problems.append("application_track must be a positive multiple of 12")
        if self.resume < 1 or self.knowledge_entry < 1 or self.material < 1:
            problems.append("resume/knowledge/material counts must be >= 1")
        if self.interview_session < 1:
            problems.append("interview_session must be >= 1")
        if (
            min(
                self.user_file_png,
                self.user_file_pdf,
                self.user_file_docx,
                self.user_file_md,
                self.user_file_txt,
            )
            < 1
        ):
            problems.append("every user-file count must be >= 1")
        if problems:
            raise ValueError("; ".join(problems))

    def as_dict(self) -> dict[str, int]:
        return {field.name: getattr(self, field.name) for field in fields(self)}


ALLOWED_SCALES: tuple[int, ...] = (500, 2000, 10000)
BASE_SCALE = 1250


def counts_for_scale(scale: int) -> ScaleCounts:
    """Derive the full count table from a scale level (target job rows)."""
    if scale not in ALLOWED_SCALES:
        raise ValueError(f"scale must be one of {ALLOWED_SCALES}, got {scale!r}")
    factor = scale / BASE_SCALE

    def scaled(base: int, minimum: int = 0) -> int:
        return max(minimum, round(base * factor))

    # Keep the (company_key, title_key) uniqueness contract intact, and cap
    # the derived track count at the company-pool capacity (see
    # TRACK_MAX_COUNT above -- without the cap, scale >= 2000 crashed).
    track = min(TRACK_MAX_COUNT, max(12, (scaled(1440) // 12) * 12))
    counts = ScaleCounts(
        job=scale,
        candidate_job=scaled(420),
        resume=scaled(620),
        resume_generate_task=scaled(320),
        resume_delivery_record=scaled(2560),
        apply_task=scaled(320),
        apply_task_item=scaled(2560),
        application_track=track,
        knowledge_entry=scaled(920),
        material=scaled(320),
        interview_session=scaled(70),
        user_file_png=scaled(120, minimum=1),
        user_file_pdf=scaled(50, minimum=1),
        user_file_docx=scaled(50, minimum=1),
        user_file_md=scaled(50, minimum=1),
        user_file_txt=scaled(40, minimum=1),
    )
    counts.validate()
    return counts


def smoke_counts() -> ScaleCounts:
    """Minimal counts for smoke tests and pipeline sanity runs.

    Not reachable through the CLI on purpose: the CLI only exposes the three
    documented scale levels, while tests need a dataset that builds in
    seconds. Every minimum from :meth:`ScaleCounts.validate` is satisfied.
    """
    counts = ScaleCounts(
        job=12,
        candidate_job=2,
        resume=3,
        resume_generate_task=2,
        resume_delivery_record=4,
        apply_task=2,
        apply_task_item=3,
        application_track=12,
        knowledge_entry=2,
        material=2,
        interview_session=2,
        user_file_png=1,
        user_file_pdf=1,
        user_file_docx=1,
        user_file_md=1,
        user_file_txt=1,
    )
    counts.validate()
    return counts
