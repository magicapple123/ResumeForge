# SPDX-License-Identifier: Apache-2.0
"""FTS5 检索派生表：knowledge_fts 与 7 张 search_fts_*（含触发器与 rebuild）。

本文件由 backend/scripts/dump_baseline_ddl.py 从 Base.metadata 生成，不要手工编辑。重新生成：cd backend && python scripts/dump_baseline_ddl.py；漂移检查：python scripts/dump_baseline_ddl.py --check（不一致退出码 1）。
"""

from __future__ import annotations

STATEMENTS: tuple[str, ...] = (
    """\
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title, content,
    content='knowledge_entry', content_rowid='id',
    tokenize='trigram'
)
""",
    """\
CREATE TRIGGER IF NOT EXISTS knowledge_fts_ai AFTER INSERT ON knowledge_entry BEGIN
    INSERT INTO knowledge_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS knowledge_fts_ad AFTER DELETE ON knowledge_entry BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS knowledge_fts_au AFTER UPDATE ON knowledge_entry BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO knowledge_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
END
""",
    """\
INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')
""",
    """\
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts_job USING fts5(
    title, company, location, description, additional_info, note,
    content='job', content_rowid='id',
    tokenize='trigram'
)
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_job_ai AFTER INSERT ON job BEGIN
    INSERT INTO search_fts_job(rowid, title, company, location, description, additional_info, note)
    VALUES (new.id, new.title, new.company, new.location, new.description, new.additional_info, new.note);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_job_ad AFTER DELETE ON job BEGIN
    INSERT INTO search_fts_job(search_fts_job, rowid, title, company, location, description, additional_info, note)
    VALUES ('delete', old.id, old.title, old.company, old.location, old.description, old.additional_info, old.note);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_job_au AFTER UPDATE ON job BEGIN
    INSERT INTO search_fts_job(search_fts_job, rowid, title, company, location, description, additional_info, note)
    VALUES ('delete', old.id, old.title, old.company, old.location, old.description, old.additional_info, old.note);
    INSERT INTO search_fts_job(rowid, title, company, location, description, additional_info, note)
    VALUES (new.id, new.title, new.company, new.location, new.description, new.additional_info, new.note);
END
""",
    """\
INSERT INTO search_fts_job(search_fts_job) VALUES('rebuild')
""",
    """\
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts_resume_record USING fts5(
    title, job_title, company, content,
    content='resume_record', content_rowid='id',
    tokenize='trigram'
)
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_resume_record_ai AFTER INSERT ON resume_record BEGIN
    INSERT INTO search_fts_resume_record(rowid, title, job_title, company, content)
    VALUES (new.id, new.title, new.job_title, new.company, new.content);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_resume_record_ad AFTER DELETE ON resume_record BEGIN
    INSERT INTO search_fts_resume_record(search_fts_resume_record, rowid, title, job_title, company, content)
    VALUES ('delete', old.id, old.title, old.job_title, old.company, old.content);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_resume_record_au AFTER UPDATE ON resume_record BEGIN
    INSERT INTO search_fts_resume_record(search_fts_resume_record, rowid, title, job_title, company, content)
    VALUES ('delete', old.id, old.title, old.job_title, old.company, old.content);
    INSERT INTO search_fts_resume_record(rowid, title, job_title, company, content)
    VALUES (new.id, new.title, new.job_title, new.company, new.content);
END
""",
    """\
INSERT INTO search_fts_resume_record(search_fts_resume_record) VALUES('rebuild')
""",
    """\
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts_referral USING fts5(
    job_title, company, referrer_name, position, note,
    content='referral', content_rowid='id',
    tokenize='trigram'
)
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_referral_ai AFTER INSERT ON referral BEGIN
    INSERT INTO search_fts_referral(rowid, job_title, company, referrer_name, position, note)
    VALUES (new.id, new.job_title, new.company, new.referrer_name, new.position, new.note);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_referral_ad AFTER DELETE ON referral BEGIN
    INSERT INTO search_fts_referral(search_fts_referral, rowid, job_title, company, referrer_name, position, note)
    VALUES ('delete', old.id, old.job_title, old.company, old.referrer_name, old.position, old.note);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_referral_au AFTER UPDATE ON referral BEGIN
    INSERT INTO search_fts_referral(search_fts_referral, rowid, job_title, company, referrer_name, position, note)
    VALUES ('delete', old.id, old.job_title, old.company, old.referrer_name, old.position, old.note);
    INSERT INTO search_fts_referral(rowid, job_title, company, referrer_name, position, note)
    VALUES (new.id, new.job_title, new.company, new.referrer_name, new.position, new.note);
END
""",
    """\
INSERT INTO search_fts_referral(search_fts_referral) VALUES('rebuild')
""",
    """\
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts_reminder USING fts5(
    title, note,
    content='reminder', content_rowid='id',
    tokenize='trigram'
)
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_reminder_ai AFTER INSERT ON reminder BEGIN
    INSERT INTO search_fts_reminder(rowid, title, note)
    VALUES (new.id, new.title, new.note);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_reminder_ad AFTER DELETE ON reminder BEGIN
    INSERT INTO search_fts_reminder(search_fts_reminder, rowid, title, note)
    VALUES ('delete', old.id, old.title, old.note);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_reminder_au AFTER UPDATE ON reminder BEGIN
    INSERT INTO search_fts_reminder(search_fts_reminder, rowid, title, note)
    VALUES ('delete', old.id, old.title, old.note);
    INSERT INTO search_fts_reminder(rowid, title, note)
    VALUES (new.id, new.title, new.note);
END
""",
    """\
INSERT INTO search_fts_reminder(search_fts_reminder) VALUES('rebuild')
""",
    """\
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts_interview_experience USING fts5(
    title, company, position, content,
    content='interview_experience', content_rowid='id',
    tokenize='trigram'
)
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_interview_experience_ai AFTER INSERT ON interview_experience BEGIN
    INSERT INTO search_fts_interview_experience(rowid, title, company, position, content)
    VALUES (new.id, new.title, new.company, new.position, new.content);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_interview_experience_ad AFTER DELETE ON interview_experience BEGIN
    INSERT INTO search_fts_interview_experience(search_fts_interview_experience, rowid, title, company, position, content)
    VALUES ('delete', old.id, old.title, old.company, old.position, old.content);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_interview_experience_au AFTER UPDATE ON interview_experience BEGIN
    INSERT INTO search_fts_interview_experience(search_fts_interview_experience, rowid, title, company, position, content)
    VALUES ('delete', old.id, old.title, old.company, old.position, old.content);
    INSERT INTO search_fts_interview_experience(rowid, title, company, position, content)
    VALUES (new.id, new.title, new.company, new.position, new.content);
END
""",
    """\
INSERT INTO search_fts_interview_experience(search_fts_interview_experience) VALUES('rebuild')
""",
    """\
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts_claim_record USING fts5(
    title, category, subject, source_fact, candidate_wording,
    content='claim_record', content_rowid='id',
    tokenize='trigram'
)
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_claim_record_ai AFTER INSERT ON claim_record BEGIN
    INSERT INTO search_fts_claim_record(rowid, title, category, subject, source_fact, candidate_wording)
    VALUES (new.id, new.title, new.category, new.subject, new.source_fact, new.candidate_wording);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_claim_record_ad AFTER DELETE ON claim_record BEGIN
    INSERT INTO search_fts_claim_record(search_fts_claim_record, rowid, title, category, subject, source_fact, candidate_wording)
    VALUES ('delete', old.id, old.title, old.category, old.subject, old.source_fact, old.candidate_wording);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_claim_record_au AFTER UPDATE ON claim_record BEGIN
    INSERT INTO search_fts_claim_record(search_fts_claim_record, rowid, title, category, subject, source_fact, candidate_wording)
    VALUES ('delete', old.id, old.title, old.category, old.subject, old.source_fact, old.candidate_wording);
    INSERT INTO search_fts_claim_record(rowid, title, category, subject, source_fact, candidate_wording)
    VALUES (new.id, new.title, new.category, new.subject, new.source_fact, new.candidate_wording);
END
""",
    """\
INSERT INTO search_fts_claim_record(search_fts_claim_record) VALUES('rebuild')
""",
    """\
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts_material USING fts5(
    title, category, content, note, url,
    content='material', content_rowid='id',
    tokenize='trigram'
)
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_material_ai AFTER INSERT ON material BEGIN
    INSERT INTO search_fts_material(rowid, title, category, content, note, url)
    VALUES (new.id, new.title, new.category, new.content, new.note, new.url);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_material_ad AFTER DELETE ON material BEGIN
    INSERT INTO search_fts_material(search_fts_material, rowid, title, category, content, note, url)
    VALUES ('delete', old.id, old.title, old.category, old.content, old.note, old.url);
END
""",
    """\
CREATE TRIGGER IF NOT EXISTS search_fts_material_au AFTER UPDATE ON material BEGIN
    INSERT INTO search_fts_material(search_fts_material, rowid, title, category, content, note, url)
    VALUES ('delete', old.id, old.title, old.category, old.content, old.note, old.url);
    INSERT INTO search_fts_material(rowid, title, category, content, note, url)
    VALUES (new.id, new.title, new.category, new.content, new.note, new.url);
END
""",
    """\
INSERT INTO search_fts_material(search_fts_material) VALUES('rebuild')
""",
)

DOWN_STATEMENTS: tuple[str, ...] = (
    "DROP TRIGGER IF EXISTS search_fts_material_au",
    "DROP TRIGGER IF EXISTS search_fts_material_ad",
    "DROP TRIGGER IF EXISTS search_fts_material_ai",
    "DROP TABLE IF EXISTS search_fts_material",
    "DROP TRIGGER IF EXISTS search_fts_claim_record_au",
    "DROP TRIGGER IF EXISTS search_fts_claim_record_ad",
    "DROP TRIGGER IF EXISTS search_fts_claim_record_ai",
    "DROP TABLE IF EXISTS search_fts_claim_record",
    "DROP TRIGGER IF EXISTS search_fts_interview_experience_au",
    "DROP TRIGGER IF EXISTS search_fts_interview_experience_ad",
    "DROP TRIGGER IF EXISTS search_fts_interview_experience_ai",
    "DROP TABLE IF EXISTS search_fts_interview_experience",
    "DROP TRIGGER IF EXISTS search_fts_reminder_au",
    "DROP TRIGGER IF EXISTS search_fts_reminder_ad",
    "DROP TRIGGER IF EXISTS search_fts_reminder_ai",
    "DROP TABLE IF EXISTS search_fts_reminder",
    "DROP TRIGGER IF EXISTS search_fts_referral_au",
    "DROP TRIGGER IF EXISTS search_fts_referral_ad",
    "DROP TRIGGER IF EXISTS search_fts_referral_ai",
    "DROP TABLE IF EXISTS search_fts_referral",
    "DROP TRIGGER IF EXISTS search_fts_resume_record_au",
    "DROP TRIGGER IF EXISTS search_fts_resume_record_ad",
    "DROP TRIGGER IF EXISTS search_fts_resume_record_ai",
    "DROP TABLE IF EXISTS search_fts_resume_record",
    "DROP TRIGGER IF EXISTS search_fts_job_au",
    "DROP TRIGGER IF EXISTS search_fts_job_ad",
    "DROP TRIGGER IF EXISTS search_fts_job_ai",
    "DROP TABLE IF EXISTS search_fts_job",
    "DROP TRIGGER IF EXISTS knowledge_fts_au",
    "DROP TRIGGER IF EXISTS knowledge_fts_ad",
    "DROP TRIGGER IF EXISTS knowledge_fts_ai",
    "DROP TABLE IF EXISTS knowledge_fts",
)

__all__ = ["STATEMENTS", "DOWN_STATEMENTS"]
