# SPDX-License-Identifier: Apache-2.0
"""其余业务域（面试/演练/题库）以及 app_schema_epoch 的建表与 epoch 播种。

本文件由 backend/scripts/dump_baseline_ddl.py 从 Base.metadata 生成，不要手工编辑。重新生成：cd backend && python scripts/dump_baseline_ddl.py；漂移检查：python scripts/dump_baseline_ddl.py --check（不一致退出码 1）。
"""

from __future__ import annotations

STATEMENTS: tuple[str, ...] = (
    """\
CREATE TABLE app_schema_epoch (
	epoch INTEGER NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (epoch),
	CONSTRAINT ck_app_schema_epoch_positive CHECK (epoch >= 1)
)
""",
    """\
CREATE TABLE drill_session (
	id INTEGER NOT NULL,
	title VARCHAR(128) NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	status VARCHAR(16) NOT NULL,
	feedback_policy VARCHAR(16) NOT NULL,
	claim_ids JSON NOT NULL,
	max_questions INTEGER NOT NULL,
	current_index INTEGER NOT NULL,
	review JSON NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_drill_session_status ON drill_session (status)
""",
    """\
CREATE TABLE interview_experience (
	id INTEGER NOT NULL,
	title VARCHAR(200) NOT NULL,
	company VARCHAR(128) NOT NULL,
	position VARCHAR(128) NOT NULL,
	job_id INTEGER,
	content TEXT NOT NULL,
	questions JSON NOT NULL,
	tags JSON NOT NULL,
	source VARCHAR(16) NOT NULL,
	difficulty VARCHAR(16) NOT NULL,
	round_type VARCHAR(32) NOT NULL,
	interview_date VARCHAR(10) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_interview_experience_company ON interview_experience (company)
""",
    """\
CREATE INDEX ix_interview_experience_job_id ON interview_experience (job_id)
""",
    """\
CREATE TABLE drill_contract (
	id INTEGER NOT NULL,
	session_id INTEGER NOT NULL,
	claim_id INTEGER,
	claim_title VARCHAR(200) NOT NULL,
	question TEXT NOT NULL,
	intent TEXT NOT NULL,
	required_evidence JSON NOT NULL,
	followup_triggers JSON NOT NULL,
	stop_condition TEXT NOT NULL,
	status VARCHAR(24) NOT NULL,
	evidence_found JSON NOT NULL,
	missing JSON NOT NULL,
	contradictions JSON NOT NULL,
	followup_depth INTEGER NOT NULL,
	next_followup_kind VARCHAR(24) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(session_id) REFERENCES drill_session (id) ON DELETE CASCADE,
	FOREIGN KEY(claim_id) REFERENCES claim_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_drill_contract_claim_id ON drill_contract (claim_id)
""",
    """\
CREATE INDEX ix_drill_contract_session_id ON drill_contract (session_id)
""",
    """\
CREATE INDEX ix_drill_contract_status ON drill_contract (status)
""",
    """\
CREATE TABLE interview_review_record (
	id INTEGER NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	resume_id INTEGER,
	resume_title VARCHAR(256) NOT NULL,
	questions JSON NOT NULL,
	analysis JSON NOT NULL,
	suggestions JSON NOT NULL,
	model VARCHAR(64) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_interview_review_record_job_id ON interview_review_record (job_id)
""",
    """\
CREATE TABLE interview_session (
	id INTEGER NOT NULL,
	title VARCHAR(128) NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	resume_id INTEGER,
	resume_title VARCHAR(256) NOT NULL,
	job_material_name VARCHAR(256) NOT NULL,
	job_material_text TEXT NOT NULL,
	resume_material_name VARCHAR(256) NOT NULL,
	resume_material_text TEXT NOT NULL,
	duration_seconds INTEGER NOT NULL,
	interview_type VARCHAR(32) NOT NULL,
	difficulty VARCHAR(16) NOT NULL,
	interviewer_style VARCHAR(32) NOT NULL,
	rounds INTEGER NOT NULL,
	rounds_min INTEGER,
	persona TEXT NOT NULL,
	focus VARCHAR(255) NOT NULL,
	status VARCHAR(16) NOT NULL,
	follow_up_closed_at DATETIME,
	report JSON NOT NULL,
	model VARCHAR(64) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_interview_session_created_at ON interview_session (created_at)
""",
    """\
CREATE INDEX ix_interview_session_job_id ON interview_session (job_id)
""",
    """\
CREATE INDEX ix_interview_session_resume_id ON interview_session (resume_id)
""",
    """\
CREATE INDEX ix_interview_session_status ON interview_session (status)
""",
    """\
CREATE TABLE llm_usage_record (
	id INTEGER NOT NULL,
	task VARCHAR(32) NOT NULL,
	model VARCHAR(64) DEFAULT '' NOT NULL,
	resume_id INTEGER,
	prompt_tokens INTEGER,
	cache_hit_tokens INTEGER,
	cache_miss_tokens INTEGER,
	completion_tokens INTEGER,
	total_tokens INTEGER,
	duration_ms INTEGER,
	finish_reason VARCHAR(32) DEFAULT '' NOT NULL,
	retries INTEGER DEFAULT '0' NOT NULL,
	cost_estimate FLOAT,
	cost_currency VARCHAR(8) DEFAULT '' NOT NULL,
	input_scope VARCHAR(64) DEFAULT '' NOT NULL,
	masked BOOLEAN,
	language VARCHAR(16) DEFAULT '' NOT NULL,
	budget INTEGER,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_llm_usage_record_created_at ON llm_usage_record (created_at)
""",
    """\
CREATE INDEX ix_llm_usage_record_resume_id ON llm_usage_record (resume_id)
""",
    """\
CREATE INDEX ix_llm_usage_record_task ON llm_usage_record (task)
""",
    """\
CREATE TABLE question_bank_record (
	id INTEGER NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	resume_id INTEGER,
	resume_title VARCHAR(256) NOT NULL,
	groups JSON NOT NULL,
	model VARCHAR(64) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_question_bank_record_job_id ON question_bank_record (job_id)
""",
    """\
CREATE TABLE drill_turn (
	id INTEGER NOT NULL,
	session_id INTEGER NOT NULL,
	contract_id INTEGER,
	question TEXT NOT NULL,
	answer TEXT NOT NULL,
	status VARCHAR(24) NOT NULL,
	feedback TEXT NOT NULL,
	next_question TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(session_id) REFERENCES drill_session (id) ON DELETE CASCADE,
	FOREIGN KEY(contract_id) REFERENCES drill_contract (id) ON DELETE CASCADE
)
""",
    """\
CREATE INDEX ix_drill_turn_contract_id ON drill_turn (contract_id)
""",
    """\
CREATE INDEX ix_drill_turn_session_id ON drill_turn (session_id)
""",
    """\
CREATE TABLE interview_message (
	id INTEGER NOT NULL,
	session_id INTEGER NOT NULL,
	role VARCHAR(16) NOT NULL,
	phase VARCHAR(16) NOT NULL,
	content TEXT NOT NULL,
	context JSON NOT NULL,
	status VARCHAR(16) NOT NULL,
	error TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(session_id) REFERENCES interview_session (id) ON DELETE CASCADE
)
""",
    """\
CREATE INDEX ix_interview_message_created_at ON interview_message (created_at)
""",
    """\
CREATE INDEX ix_interview_message_session_id ON interview_message (session_id)
""",
)

DOWN_STATEMENTS: tuple[str, ...] = (
    "DROP TABLE IF EXISTS interview_message",
    "DROP TABLE IF EXISTS drill_turn",
    "DROP TABLE IF EXISTS question_bank_record",
    "DROP TABLE IF EXISTS llm_usage_record",
    "DROP TABLE IF EXISTS interview_session",
    "DROP TABLE IF EXISTS interview_review_record",
    "DROP TABLE IF EXISTS drill_contract",
    "DROP TABLE IF EXISTS interview_experience",
    "DROP TABLE IF EXISTS drill_session",
    "DROP TABLE IF EXISTS app_schema_epoch",
)

EPOCH_SEED_STATEMENTS: tuple[str, ...] = ("INSERT INTO app_schema_epoch (epoch) VALUES (2)",)

__all__ = ["STATEMENTS", "DOWN_STATEMENTS", "EPOCH_SEED_STATEMENTS"]
