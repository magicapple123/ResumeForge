# SPDX-License-Identifier: Apache-2.0
"""基础域：无外键依赖的根表（岗位、资料主表、会话、知识库、网申快照等）。

本文件由 backend/scripts/dump_baseline_ddl.py 从 Base.metadata 生成，不要手工编辑。重新生成：cd backend && python scripts/dump_baseline_ddl.py；漂移检查：python scripts/dump_baseline_ddl.py --check（不一致退出码 1）。
"""

from __future__ import annotations

STATEMENTS: tuple[str, ...] = (
    """\
CREATE TABLE ai_task (
	id INTEGER NOT NULL,
	status VARCHAR(16) NOT NULL,
	kind VARCHAR(32) NOT NULL,
	label VARCHAR(256) NOT NULL,
	progress INTEGER NOT NULL,
	message TEXT NOT NULL,
	payload JSON NOT NULL,
	result_ref JSON,
	error TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	started_at DATETIME,
	finished_at DATETIME,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_ai_task_created_at ON ai_task (created_at)
""",
    """\
CREATE INDEX ix_ai_task_kind ON ai_task (kind)
""",
    """\
CREATE INDEX ix_ai_task_status ON ai_task (status)
""",
    """\
CREATE TABLE app_setting (
	"key" VARCHAR(64) NOT NULL,
	value TEXT NOT NULL,
	PRIMARY KEY ("key")
)
""",
    """\
CREATE TABLE assistant_skill (
	id INTEGER NOT NULL,
	name VARCHAR(64) NOT NULL,
	description VARCHAR(255) NOT NULL,
	prompt TEXT NOT NULL,
	enabled BOOLEAN NOT NULL,
	source_name VARCHAR(255) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE UNIQUE INDEX ix_assistant_skill_name ON assistant_skill (name)
""",
    """\
CREATE TABLE career_scenario (
	id INTEGER NOT NULL,
	name VARCHAR(40) DEFAULT '' NOT NULL,
	schema_version INTEGER DEFAULT '1' NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	config JSON DEFAULT '{}' NOT NULL,
	archived BOOLEAN DEFAULT '0' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_career_scenario_created_at ON career_scenario (created_at)
""",
    """\
CREATE TABLE chat_conversation (
	id INTEGER NOT NULL,
	title VARCHAR(120) NOT NULL,
	surface VARCHAR(16) DEFAULT 'page' NOT NULL,
	pinned BOOLEAN NOT NULL,
	favorite BOOLEAN NOT NULL,
	archived BOOLEAN DEFAULT '0' NOT NULL,
	group_name VARCHAR(64) DEFAULT '' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_chat_conversation_surface ON chat_conversation (surface)
""",
    """\
CREATE INDEX ix_chat_conversation_updated_at ON chat_conversation (updated_at)
""",
    """\
CREATE TABLE claim_record (
	id INTEGER NOT NULL,
	title VARCHAR(200) NOT NULL,
	category VARCHAR(32) NOT NULL,
	subject VARCHAR(200) NOT NULL,
	source_fact TEXT NOT NULL,
	candidate_wording TEXT NOT NULL,
	sources JSON NOT NULL,
	responsibility_level VARCHAR(32) NOT NULL,
	verification_status VARCHAR(16) NOT NULL,
	allowed_uses JSON NOT NULL,
	interview_details JSON NOT NULL,
	boundary TEXT NOT NULL,
	risk_notes JSON NOT NULL,
	last_verified VARCHAR(10) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_claim_record_category ON claim_record (category)
""",
    """\
CREATE INDEX ix_claim_record_responsibility_level ON claim_record (responsibility_level)
""",
    """\
CREATE INDEX ix_claim_record_subject ON claim_record (subject)
""",
    """\
CREATE INDEX ix_claim_record_verification_status ON claim_record (verification_status)
""",
    """\
CREATE TABLE job (
	id INTEGER NOT NULL,
	title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	location VARCHAR(64) NOT NULL,
	salary VARCHAR(64) NOT NULL,
	job_type VARCHAR(32) NOT NULL,
	description TEXT NOT NULL,
	requirements TEXT NOT NULL,
	additional_info TEXT NOT NULL,
	keywords JSON NOT NULL,
	source VARCHAR(64) NOT NULL,
	source_url VARCHAR(512) NOT NULL,
	posted_at VARCHAR(32) NOT NULL,
	status VARCHAR(16) NOT NULL,
	note TEXT NOT NULL,
	note_images JSON DEFAULT '[]' NOT NULL,
	favorite BOOLEAN NOT NULL,
	recognition_source VARCHAR(32) DEFAULT '' NOT NULL,
	origin_source VARCHAR(64) DEFAULT '' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	analysis_cache JSON DEFAULT '{}' NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_job_created_at ON job (created_at)
""",
    """\
CREATE INDEX ix_job_status ON job (status)
""",
    """\
CREATE TABLE knowledge_entry (
	id INTEGER NOT NULL,
	title VARCHAR(200) NOT NULL,
	category VARCHAR(32) NOT NULL,
	tags JSON NOT NULL,
	content TEXT NOT NULL,
	source VARCHAR(64) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_knowledge_entry_category ON knowledge_entry (category)
""",
    """\
CREATE TABLE llm_config_record (
	id INTEGER NOT NULL,
	name VARCHAR(64) NOT NULL,
	provider VARCHAR(32) NOT NULL,
	base_url VARCHAR(512) NOT NULL,
	api_key TEXT NOT NULL,
	model VARCHAR(128) NOT NULL,
	temperature FLOAT NOT NULL,
	timeout_seconds INTEGER NOT NULL,
	max_tokens INTEGER NOT NULL,
	api_style VARCHAR(16) DEFAULT 'openai' NOT NULL,
	top_p FLOAT,
	frequency_penalty FLOAT,
	presence_penalty FLOAT,
	seed INTEGER,
	top_k INTEGER,
	repetition_penalty FLOAT,
	stop JSON DEFAULT '[]' NOT NULL,
	thinking_budget INTEGER,
	thinking_enabled BOOLEAN DEFAULT '0' NOT NULL,
	thinking_effort VARCHAR(32) DEFAULT '' NOT NULL,
	thinking_style VARCHAR(32) DEFAULT 'auto' NOT NULL,
	extra_body JSON DEFAULT '{}' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
)
""",
    """\
CREATE TABLE material (
	id INTEGER NOT NULL,
	title VARCHAR(256) NOT NULL,
	category VARCHAR(64) NOT NULL,
	content TEXT NOT NULL,
	url VARCHAR(1024) NOT NULL,
	files JSON NOT NULL,
	note TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_material_created_at ON material (created_at)
""",
    """\
CREATE TABLE usage_pricing_record (
	id INTEGER NOT NULL,
	name VARCHAR(64) DEFAULT '' NOT NULL,
	input_cache_hit_per_million FLOAT,
	input_cache_miss_per_million FLOAT,
	output_per_million FLOAT,
	currency VARCHAR(8) DEFAULT 'CNY' NOT NULL,
	is_active BOOLEAN DEFAULT '0' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_usage_pricing_record_created_at ON usage_pricing_record (created_at)
""",
    """\
CREATE INDEX ix_usage_pricing_record_is_active ON usage_pricing_record (is_active)
""",
    """\
CREATE TABLE user_file (
	id INTEGER NOT NULL,
	sha256 VARCHAR(64) NOT NULL,
	disk_name VARCHAR(160) NOT NULL,
	original_name VARCHAR(255) NOT NULL,
	mime VARCHAR(120) NOT NULL,
	size BIGINT NOT NULL,
	source_type VARCHAR(40) NOT NULL,
	source_ref VARCHAR(120) NOT NULL,
	sources_json TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_user_file_sha256 ON user_file (sha256)
""",
    """\
CREATE TABLE user_profile (
	id INTEGER NOT NULL,
	name VARCHAR(64) NOT NULL,
	gender VARCHAR(16) NOT NULL,
	birth_year VARCHAR(16) NOT NULL,
	phone VARCHAR(32) NOT NULL,
	email VARCHAR(128) NOT NULL,
	city VARCHAR(64) NOT NULL,
	target_city VARCHAR(64) NOT NULL,
	job_intent VARCHAR(128) NOT NULL,
	personal_website VARCHAR(256) NOT NULL,
	github VARCHAR(256) NOT NULL,
	photo TEXT NOT NULL,
	summary TEXT NOT NULL,
	section_order JSON NOT NULL,
	updated_at DATETIME NOT NULL,
	wechat VARCHAR(64) NOT NULL,
	birth_date VARCHAR(16) NOT NULL,
	id_type VARCHAR(32) NOT NULL,
	id_number VARCHAR(64) NOT NULL,
	country_region VARCHAR(64) NOT NULL,
	native_place VARCHAR(64) NOT NULL,
	political_status VARCHAR(32) NOT NULL,
	phone_country_code VARCHAR(8) DEFAULT '+86' NOT NULL,
	family_info TEXT NOT NULL,
	expected_salary VARCHAR(64) NOT NULL,
	qq VARCHAR(32) NOT NULL,
	advisor VARCHAR(64) NOT NULL,
	research_direction VARCHAR(128) NOT NULL,
	preferred_industry VARCHAR(128) NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE TABLE web_form_fill_record (
	id INTEGER NOT NULL,
	url VARCHAR(1024) NOT NULL,
	page_title VARCHAR(256) NOT NULL,
	items JSON NOT NULL,
	filled INTEGER NOT NULL,
	unverified INTEGER NOT NULL,
	failed INTEGER NOT NULL,
	page_snapshot JSON NOT NULL,
	source VARCHAR(16) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id)
)
""",
    """\
CREATE TABLE web_form_profile_entry (
	id INTEGER NOT NULL,
	field_key VARCHAR(64) NOT NULL,
	value TEXT NOT NULL,
	label VARCHAR(64) NOT NULL,
	source VARCHAR(16) NOT NULL,
	reuse VARCHAR(16) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_web_form_profile_entry_field_key ON web_form_profile_entry (field_key)
""",
    """\
CREATE TABLE web_form_profile_record (
	id INTEGER NOT NULL,
	group_key VARCHAR(32) NOT NULL,
	sort_order INTEGER NOT NULL,
	payload JSON NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_web_form_profile_record_group_key ON web_form_profile_record (group_key)
""",
    """\
CREATE TABLE web_form_url_history (
	id INTEGER NOT NULL,
	url VARCHAR(2048) NOT NULL,
	title VARCHAR(256) NOT NULL,
	created_at DATETIME NOT NULL,
	last_used_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE INDEX ix_web_form_url_history_last_used_at ON web_form_url_history (last_used_at)
""",
    """\
CREATE UNIQUE INDEX ix_web_form_url_history_url ON web_form_url_history (url)
""",
    """\
CREATE TABLE assistant_skill_file (
	id INTEGER NOT NULL,
	skill_id INTEGER NOT NULL,
	path VARCHAR(255) NOT NULL,
	content TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(skill_id) REFERENCES assistant_skill (id) ON DELETE CASCADE
)
""",
    """\
CREATE INDEX ix_assistant_skill_file_skill_id ON assistant_skill_file (skill_id)
""",
    """\
CREATE TABLE chat_message (
	id INTEGER NOT NULL,
	conversation_id INTEGER NOT NULL,
	role VARCHAR(16) NOT NULL,
	content TEXT NOT NULL,
	quoted_message_id INTEGER,
	attachments JSON NOT NULL,
	context JSON NOT NULL,
	status VARCHAR(16) NOT NULL,
	error TEXT NOT NULL,
	model VARCHAR(128) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(conversation_id) REFERENCES chat_conversation (id) ON DELETE CASCADE
)
""",
    """\
CREATE INDEX ix_chat_message_conversation_id ON chat_message (conversation_id)
""",
    """\
CREATE INDEX ix_chat_message_created_at ON chat_message (created_at)
""",
)

DOWN_STATEMENTS: tuple[str, ...] = (
    "DROP TABLE IF EXISTS chat_message",
    "DROP TABLE IF EXISTS assistant_skill_file",
    "DROP TABLE IF EXISTS web_form_url_history",
    "DROP TABLE IF EXISTS web_form_profile_record",
    "DROP TABLE IF EXISTS web_form_profile_entry",
    "DROP TABLE IF EXISTS web_form_fill_record",
    "DROP TABLE IF EXISTS user_profile",
    "DROP TABLE IF EXISTS user_file",
    "DROP TABLE IF EXISTS usage_pricing_record",
    "DROP TABLE IF EXISTS material",
    "DROP TABLE IF EXISTS llm_config_record",
    "DROP TABLE IF EXISTS knowledge_entry",
    "DROP TABLE IF EXISTS job",
    "DROP TABLE IF EXISTS claim_record",
    "DROP TABLE IF EXISTS chat_conversation",
    "DROP TABLE IF EXISTS career_scenario",
    "DROP TABLE IF EXISTS assistant_skill",
    "DROP TABLE IF EXISTS app_setting",
    "DROP TABLE IF EXISTS ai_task",
)

__all__ = ["STATEMENTS", "DOWN_STATEMENTS"]
