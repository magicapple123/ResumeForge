# SPDX-License-Identifier: Apache-2.0
"""投递与任务域：投递任务/队列、岗位匹配、跟进与交付记录。

本文件由 backend/scripts/dump_baseline_ddl.py 从 Base.metadata 生成，不要手工编辑。重新生成：cd backend && python scripts/dump_baseline_ddl.py；漂移检查：python scripts/dump_baseline_ddl.py --check（不一致退出码 1）。
"""

from __future__ import annotations

STATEMENTS: tuple[str, ...] = (
    """\
CREATE TABLE apply_task (
	id INTEGER NOT NULL,
	kind VARCHAR(16) NOT NULL,
	status VARCHAR(16) NOT NULL,
	total INTEGER NOT NULL,
	processed INTEGER NOT NULL,
	succeeded INTEGER NOT NULL,
	failed INTEGER NOT NULL,
	skipped INTEGER NOT NULL,
	current_step VARCHAR(32) NOT NULL,
	stop_reason VARCHAR(32) NOT NULL,
	config JSON NOT NULL,
	message TEXT NOT NULL,
	started_at DATETIME,
	finished_at DATETIME,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_apply_task_kind ON apply_task (kind)
""",
    """\
CREATE INDEX ix_apply_task_status ON apply_task (status)
""",
    """\
CREATE TABLE candidate_job (
	id INTEGER NOT NULL,
	title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	raw_text TEXT NOT NULL,
	images JSON NOT NULL,
	note TEXT NOT NULL,
	source VARCHAR(32) NOT NULL,
	job_type VARCHAR(32) DEFAULT '' NOT NULL,
	location VARCHAR(64) DEFAULT '' NOT NULL,
	salary VARCHAR(64) DEFAULT '' NOT NULL,
	source_url VARCHAR(512) DEFAULT '' NOT NULL,
	description TEXT DEFAULT '' NOT NULL,
	requirements TEXT DEFAULT '' NOT NULL,
	additional_info TEXT DEFAULT '' NOT NULL,
	collect_task_id INTEGER,
	status VARCHAR(16) NOT NULL,
	imported_job_id INTEGER,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_candidate_job_created_at ON candidate_job (created_at)
""",
    """\
CREATE INDEX ix_candidate_job_status ON candidate_job (status)
""",
    """\
CREATE TABLE job_match_batch (
	id INTEGER NOT NULL,
	requested_count INTEGER NOT NULL,
	completed_count INTEGER NOT NULL,
	failed_count INTEGER NOT NULL,
	items JSON NOT NULL,
	model VARCHAR(64) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_job_match_batch_created_at ON job_match_batch (created_at)
""",
    """\
CREATE TABLE job_match_analysis (
	id INTEGER NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	result JSON NOT NULL,
	hard_gate VARCHAR(16) NOT NULL,
	requires_confirm BOOLEAN NOT NULL,
	model VARCHAR(64) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_job_match_analysis_hard_gate ON job_match_analysis (hard_gate)
""",
    """\
CREATE UNIQUE INDEX ix_job_match_analysis_job_id ON job_match_analysis (job_id)
""",
    """\
CREATE TABLE application_track (
	id INTEGER NOT NULL,
	company VARCHAR(128) NOT NULL,
	title VARCHAR(128) NOT NULL,
	company_key VARCHAR(128) NOT NULL,
	title_key VARCHAR(128) NOT NULL,
	status VARCHAR(24) NOT NULL,
	stage_note VARCHAR(64) NOT NULL,
	applied_at VARCHAR(16) NOT NULL,
	status_date VARCHAR(16) NOT NULL,
	next_action VARCHAR(255) NOT NULL,
	next_action_date VARCHAR(16) NOT NULL,
	note TEXT NOT NULL,
	evidence TEXT NOT NULL,
	job_id INTEGER,
	resume_id INTEGER,
	resume_title VARCHAR(256) NOT NULL,
	channel VARCHAR(24) NOT NULL,
	source VARCHAR(16) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	CONSTRAINT uq_application_track_company_title UNIQUE (company_key, title_key),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_application_track_company_key ON application_track (company_key)
""",
    """\
CREATE INDEX ix_application_track_job_id ON application_track (job_id)
""",
    """\
CREATE INDEX ix_application_track_status ON application_track (status)
""",
    """\
CREATE INDEX ix_application_track_title_key ON application_track (title_key)
""",
    """\
CREATE TABLE apply_queue_item (
	id INTEGER NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	resume_id INTEGER,
	greeting TEXT NOT NULL,
	sort_order INTEGER NOT NULL,
	status VARCHAR(16) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_apply_queue_item_job_id UNIQUE (job_id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_apply_queue_item_job_id ON apply_queue_item (job_id)
""",
    """\
CREATE INDEX ix_apply_queue_item_sort_order ON apply_queue_item (sort_order)
""",
    """\
CREATE INDEX ix_apply_queue_item_status ON apply_queue_item (status)
""",
    """\
CREATE TABLE apply_task_item (
	id INTEGER NOT NULL,
	task_id INTEGER NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	resume_id INTEGER,
	resume_title VARCHAR(256) NOT NULL,
	greeting TEXT NOT NULL,
	status VARCHAR(16) NOT NULL,
	failure_category VARCHAR(32) NOT NULL,
	failure_detail TEXT NOT NULL,
	failure_step VARCHAR(32) NOT NULL,
	failure_target VARCHAR(64) NOT NULL,
	failure_reason VARCHAR(40) NOT NULL,
	attempt INTEGER NOT NULL,
	sort_order INTEGER NOT NULL,
	started_at DATETIME,
	finished_at DATETIME,
	created_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(task_id) REFERENCES apply_task (id) ON DELETE CASCADE,
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_apply_task_item_job_id ON apply_task_item (job_id)
""",
    """\
CREATE INDEX ix_apply_task_item_status ON apply_task_item (status)
""",
    """\
CREATE INDEX ix_apply_task_item_task_id ON apply_task_item (task_id)
""",
    """\
CREATE TABLE share_package (
	id INTEGER NOT NULL,
	title VARCHAR(200) NOT NULL,
	resume_id INTEGER,
	job_id INTEGER,
	files JSON NOT NULL,
	permission VARCHAR(16) NOT NULL,
	snapshot JSON NOT NULL,
	comments_file VARCHAR(512) NOT NULL,
	share_token VARCHAR(64) NOT NULL,
	redaction_config JSON NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL,
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	UNIQUE (share_token)
)
""",
    """\
CREATE INDEX ix_share_package_resume_id ON share_package (resume_id)
""",
    """\
CREATE TABLE application_track_event (
	id INTEGER NOT NULL,
	track_id INTEGER NOT NULL,
	event_at DATETIME NOT NULL,
	status_date VARCHAR(16) NOT NULL,
	source VARCHAR(16) NOT NULL,
	user_confirmed BOOLEAN NOT NULL,
	from_status VARCHAR(24) NOT NULL,
	to_status VARCHAR(24) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(track_id) REFERENCES application_track (id) ON DELETE CASCADE
)
""",
    """\
CREATE INDEX ix_application_track_event_event_at ON application_track_event (event_at)
""",
    """\
CREATE INDEX ix_application_track_event_track_id ON application_track_event (track_id)
""",
    """\
CREATE TABLE referral (
	id INTEGER NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	referrer_name VARCHAR(128) NOT NULL,
	referrer_contact VARCHAR(128) NOT NULL,
	relation VARCHAR(64) NOT NULL,
	position VARCHAR(128) NOT NULL,
	channel VARCHAR(32) NOT NULL,
	status VARCHAR(16) NOT NULL,
	track_id INTEGER,
	converted BOOLEAN NOT NULL,
	submitted_at VARCHAR(16) NOT NULL,
	note TEXT NOT NULL,
	referral_code VARCHAR(64) NOT NULL,
	note_images JSON NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(track_id) REFERENCES application_track (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_referral_job_id ON referral (job_id)
""",
    """\
CREATE INDEX ix_referral_status ON referral (status)
""",
    """\
CREATE TABLE reminder (
	id INTEGER NOT NULL,
	title VARCHAR(200) NOT NULL,
	remind_at DATETIME NOT NULL,
	kind VARCHAR(32) NOT NULL,
	status VARCHAR(16) NOT NULL,
	track_id INTEGER,
	job_id INTEGER,
	resume_id INTEGER,
	note TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(track_id) REFERENCES application_track (id) ON DELETE SET NULL,
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_reminder_job_id ON reminder (job_id)
""",
    """\
CREATE INDEX ix_reminder_remind_at ON reminder (remind_at)
""",
    """\
CREATE INDEX ix_reminder_status ON reminder (status)
""",
    """\
CREATE TABLE resume_delivery_record (
	id INTEGER NOT NULL,
	resume_id INTEGER,
	job_id INTEGER,
	track_id INTEGER,
	source VARCHAR(16) NOT NULL,
	resume_title VARCHAR(256) NOT NULL,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	content JSON NOT NULL,
	render_context JSON NOT NULL,
	content_sha256 VARCHAR(64) NOT NULL,
	rendered_config_sha256 VARCHAR(64) NOT NULL,
	export_format VARCHAR(16) NOT NULL,
	filename VARCHAR(256) NOT NULL,
	pages INTEGER,
	model VARCHAR(64) NOT NULL,
	source_content_sha256 VARCHAR(64),
	artifact_sha256 VARCHAR(64),
	request_params JSON,
	idempotency_key VARCHAR(128),
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL,
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(track_id) REFERENCES application_track (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_resume_delivery_record_created_at ON resume_delivery_record (created_at)
""",
    """\
CREATE INDEX ix_resume_delivery_record_idempotency_key ON resume_delivery_record (idempotency_key)
""",
    """\
CREATE INDEX ix_resume_delivery_record_job_id ON resume_delivery_record (job_id)
""",
    """\
CREATE INDEX ix_resume_delivery_record_resume_id ON resume_delivery_record (resume_id)
""",
)

DOWN_STATEMENTS: tuple[str, ...] = (
    "DROP TABLE IF EXISTS resume_delivery_record",
    "DROP TABLE IF EXISTS reminder",
    "DROP TABLE IF EXISTS referral",
    "DROP TABLE IF EXISTS application_track_event",
    "DROP TABLE IF EXISTS share_package",
    "DROP TABLE IF EXISTS apply_task_item",
    "DROP TABLE IF EXISTS apply_queue_item",
    "DROP TABLE IF EXISTS application_track",
    "DROP TABLE IF EXISTS job_match_analysis",
    "DROP TABLE IF EXISTS job_match_batch",
    "DROP TABLE IF EXISTS candidate_job",
    "DROP TABLE IF EXISTS apply_task",
)

__all__ = ["STATEMENTS", "DOWN_STATEMENTS"]
