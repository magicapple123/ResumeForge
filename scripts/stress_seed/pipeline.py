# SPDX-License-Identifier: Apache-2.0
"""Ordered orchestration of the domain generators.

Insertion order mirrors the original script exactly (parents before
children, referenced rows before referencing rows), so the dataset lands
the same way regardless of SQLite foreign-key enforcement settings.
"""

from __future__ import annotations

from . import gen_apply, gen_content, gen_jobs, gen_profile, gen_resume, gen_userfiles
from .context import SeedContext


def seed_all(ctx: SeedContext) -> None:
    """Run every domain generator against ``ctx`` in dependency order."""
    gen_profile.seed_profile(ctx)

    job_rows = gen_jobs.seed_jobs(ctx)
    gen_jobs.seed_candidate_jobs(ctx, job_rows)

    resume_rows, resume_contents = gen_resume.seed_resumes(ctx, job_rows)
    gen_resume.seed_generate_tasks(ctx, job_rows, resume_rows)
    gen_resume.seed_deliveries(ctx, job_rows, resume_rows, resume_contents)

    gen_apply.seed_apply_tasks(ctx)
    gen_apply.seed_apply_items(ctx, job_rows, resume_rows)
    gen_apply.seed_apply_queue(ctx, job_rows, resume_rows)

    gen_jobs.seed_match_analysis(ctx, job_rows)
    gen_jobs.seed_match_batches(ctx, job_rows)

    gen_apply.seed_claims(ctx)
    track_count = gen_apply.seed_tracks(ctx, job_rows, resume_rows)
    gen_apply.seed_track_events(ctx, track_count)

    gen_content.seed_knowledge(ctx)
    gen_content.seed_material(ctx)

    gen_apply.seed_reminders(ctx, job_rows, resume_rows)
    gen_apply.seed_referrals(ctx, job_rows)

    session_count = gen_content.seed_interview_sessions(ctx, job_rows)
    gen_content.seed_interview_messages(ctx, session_count)
    gen_content.seed_interview_extras(ctx, job_rows, resume_rows)

    gen_apply.seed_drills(ctx)

    gen_content.seed_chat(ctx, job_rows)
    gen_content.seed_assistant(ctx)
    gen_resume.seed_resume_templates(ctx)
    gen_content.seed_settings(ctx)
    gen_resume.seed_share_packages(ctx, job_rows, resume_rows, resume_contents)
    gen_content.seed_webform(ctx)

    gen_userfiles.seed_user_files(ctx)
