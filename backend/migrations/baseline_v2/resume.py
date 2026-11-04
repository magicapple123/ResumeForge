# SPDX-License-Identifier: Apache-2.0
"""简历域：简历记录、版本血缘、来源标注、模板与导出产物。

本文件由 backend/scripts/dump_baseline_ddl.py 从 Base.metadata 生成，不要手工编辑。重新生成：cd backend && python scripts/dump_baseline_ddl.py；漂移检查：python scripts/dump_baseline_ddl.py --check（不一致退出码 1）。
"""

from __future__ import annotations

STATEMENTS: tuple[str, ...] = (
    """\
CREATE TABLE resume_export_preset (
	id INTEGER NOT NULL,
	name VARCHAR(64) NOT NULL,
	description VARCHAR(255) DEFAULT '' NOT NULL,
	config JSON DEFAULT '{}' NOT NULL,
	is_default BOOLEAN DEFAULT '0' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE UNIQUE INDEX ix_resume_export_preset_name ON resume_export_preset (name)
""",
    """\
CREATE TABLE resume_glossary_term (
	id INTEGER NOT NULL,
	source_term VARCHAR(128) NOT NULL,
	target_term VARCHAR(128) NOT NULL,
	language_from VARCHAR(16) NOT NULL,
	language_to VARCHAR(16) NOT NULL,
	category VARCHAR(16) NOT NULL,
	locked BOOLEAN DEFAULT '1' NOT NULL,
	note VARCHAR(256) DEFAULT '' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	CONSTRAINT uq_glossary_term UNIQUE (source_term, language_to)
)
""",
    """\
CREATE INDEX ix_resume_glossary_term_deleted_at ON resume_glossary_term (deleted_at)
""",
    """\
CREATE INDEX ix_resume_glossary_term_language_to ON resume_glossary_term (language_to)
""",
    """\
CREATE TABLE resume_source (
	id INTEGER NOT NULL,
	kind VARCHAR(16) NOT NULL,
	external_ref VARCHAR(64),
	title VARCHAR(256) NOT NULL,
	current_fingerprint VARCHAR(64) DEFAULT '' NOT NULL,
	metadata JSON DEFAULT '{}' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_resume_source_kind_ref UNIQUE (kind, external_ref)
)
""",
    """\
CREATE INDEX ix_resume_source_kind ON resume_source (kind)
""",
    """\
CREATE TABLE resume_template (
	id INTEGER NOT NULL,
	name VARCHAR(64) NOT NULL,
	kind VARCHAR(16) NOT NULL,
	description VARCHAR(255) NOT NULL,
	html TEXT NOT NULL,
	config JSON NOT NULL,
	source_name VARCHAR(255) NOT NULL,
	enabled BOOLEAN NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)
""",
    """\
CREATE UNIQUE INDEX ix_resume_template_name ON resume_template (name)
""",
    """\
CREATE TABLE resume_record (
	id INTEGER NOT NULL,
	title VARCHAR(256) NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) NOT NULL,
	company VARCHAR(128) NOT NULL,
	content JSON NOT NULL,
	warnings JSON NOT NULL,
	source VARCHAR(16) NOT NULL,
	favorite BOOLEAN NOT NULL,
	draft BOOLEAN DEFAULT '0' NOT NULL,
	revision INTEGER DEFAULT '0' NOT NULL,
	document_mode VARCHAR(16) DEFAULT 'resume' NOT NULL,
	document_version INTEGER DEFAULT '2' NOT NULL,
	model VARCHAR(64) NOT NULL,
	tone VARCHAR(32) NOT NULL,
	enhancement_enabled BOOLEAN NOT NULL,
	enhancement_level VARCHAR(16) NOT NULL,
	template VARCHAR(32) DEFAULT 'classic' NOT NULL,
	format_name VARCHAR(64) DEFAULT '' NOT NULL,
	format_config JSON DEFAULT '{}' NOT NULL,
	page_limit INTEGER DEFAULT '1' NOT NULL,
	font_scale VARCHAR(16) DEFAULT 'standard' NOT NULL,
	language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL,
	custom_instruction TEXT DEFAULT '' NOT NULL,
	note TEXT DEFAULT '' NOT NULL,
	parse_error TEXT NOT NULL,
	coverage_notes JSON DEFAULT '[]' NOT NULL,
	fact_annotations JSON DEFAULT '[]' NOT NULL,
	rationale TEXT DEFAULT '' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME,
	deleted_at DATETIME,
	parent_revision_id INTEGER,
	context_snapshot JSON,
	PRIMARY KEY (id),
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(parent_revision_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_resume_record_created_at ON resume_record (created_at)
""",
    """\
CREATE INDEX ix_resume_record_job_id ON resume_record (job_id)
""",
    """\
CREATE INDEX ix_resume_record_updated_at ON resume_record (updated_at)
""",
    """\
CREATE TABLE resume_source_revision (
	id INTEGER NOT NULL,
	source_id INTEGER NOT NULL,
	revision_no INTEGER NOT NULL,
	fingerprint VARCHAR(64) NOT NULL,
	summary VARCHAR(300) DEFAULT '' NOT NULL,
	captured_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_resume_source_revision_no UNIQUE (source_id, revision_no),
	FOREIGN KEY(source_id) REFERENCES resume_source (id) ON DELETE CASCADE
)
""",
    """\
CREATE INDEX ix_resume_source_revision_source_id ON resume_source_revision (source_id)
""",
    """\
CREATE TABLE resume_block_source (
	id INTEGER NOT NULL,
	resume_id INTEGER NOT NULL,
	source_id INTEGER NOT NULL,
	source_revision_id INTEGER,
	object_id VARCHAR(32),
	point_id VARCHAR(32),
	path VARCHAR(256) NOT NULL,
	field VARCHAR(64) NOT NULL,
	source_fingerprint VARCHAR(64) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE CASCADE,
	FOREIGN KEY(source_id) REFERENCES resume_source (id) ON DELETE CASCADE,
	FOREIGN KEY(source_revision_id) REFERENCES resume_source_revision (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_resume_block_source_resume_id ON resume_block_source (resume_id)
""",
    """\
CREATE INDEX ix_resume_block_source_source_id ON resume_block_source (source_id)
""",
    """\
CREATE TABLE resume_fact_lock (
	id INTEGER NOT NULL,
	resume_id INTEGER NOT NULL,
	object_id VARCHAR(32),
	point_id VARCHAR(32),
	path VARCHAR(256) NOT NULL,
	relative_path VARCHAR(64) DEFAULT '' NOT NULL,
	field VARCHAR(64) NOT NULL,
	lock_kind VARCHAR(32) NOT NULL,
	locked_value TEXT NOT NULL,
	label VARCHAR(64) DEFAULT '' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE CASCADE
)
""",
    """\
CREATE INDEX ix_resume_fact_lock_lock_kind ON resume_fact_lock (lock_kind)
""",
    """\
CREATE INDEX ix_resume_fact_lock_resume_id ON resume_fact_lock (resume_id)
""",
    """\
CREATE TABLE resume_generate_task (
	id INTEGER NOT NULL,
	status VARCHAR(16) NOT NULL,
	resume_id INTEGER,
	error TEXT NOT NULL,
	message TEXT NOT NULL,
	received_chars INTEGER NOT NULL,
	job_id INTEGER,
	title VARCHAR(256) NOT NULL,
	options JSON NOT NULL,
	context_snapshot JSON,
	created_at DATETIME NOT NULL,
	started_at DATETIME,
	finished_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL,
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_resume_generate_task_created_at ON resume_generate_task (created_at)
""",
    """\
CREATE INDEX ix_resume_generate_task_job_id ON resume_generate_task (job_id)
""",
    """\
CREATE INDEX ix_resume_generate_task_status ON resume_generate_task (status)
""",
    """\
CREATE TABLE resume_phrase (
	id INTEGER NOT NULL,
	text TEXT NOT NULL,
	kind VARCHAR(16) DEFAULT 'custom' NOT NULL,
	language VARCHAR(16) DEFAULT '' NOT NULL,
	source_claim_id INTEGER,
	source_resume_id INTEGER,
	source_object_id VARCHAR(32),
	job_tags JSON DEFAULT '[]' NOT NULL,
	quality_note VARCHAR(256) DEFAULT '' NOT NULL,
	usage_count INTEGER DEFAULT '0' NOT NULL,
	last_used_at DATETIME,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	deleted_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(source_claim_id) REFERENCES claim_record (id) ON DELETE SET NULL,
	FOREIGN KEY(source_resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_resume_phrase_created_at ON resume_phrase (created_at)
""",
    """\
CREATE INDEX ix_resume_phrase_deleted_at ON resume_phrase (deleted_at)
""",
    """\
CREATE INDEX ix_resume_phrase_kind ON resume_phrase (kind)
""",
    """\
CREATE INDEX ix_resume_phrase_language ON resume_phrase (language)
""",
    """\
CREATE TABLE resume_version (
	id INTEGER NOT NULL,
	resume_id INTEGER NOT NULL,
	name VARCHAR(256) NOT NULL,
	change_summary TEXT DEFAULT '' NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) DEFAULT '' NOT NULL,
	company VARCHAR(128) DEFAULT '' NOT NULL,
	content JSON NOT NULL,
	render_context JSON DEFAULT '{}' NOT NULL,
	content_sha256 VARCHAR(64) DEFAULT '' NOT NULL,
	params_sha256 VARCHAR(64) DEFAULT '' NOT NULL,
	source_revision INTEGER DEFAULT '0' NOT NULL,
	parent_version_id INTEGER,
	frozen BOOLEAN DEFAULT '0' NOT NULL,
	source VARCHAR(16) DEFAULT 'manual' NOT NULL,
	context_snapshot JSON,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE CASCADE,
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(parent_version_id) REFERENCES resume_version (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_resume_version_created_at ON resume_version (created_at)
""",
    """\
CREATE INDEX ix_resume_version_resume_id ON resume_version (resume_id)
""",
    """\
CREATE TABLE resume_review_annotation (
	id INTEGER NOT NULL,
	share_package_id INTEGER,
	resume_id INTEGER,
	document_version_id INTEGER,
	snapshot_sha256 VARCHAR(64) DEFAULT '' NOT NULL,
	external_id VARCHAR(64) NOT NULL,
	object_id VARCHAR(32),
	point_id VARCHAR(32),
	path VARCHAR(256),
	field VARCHAR(64),
	quoted_text VARCHAR(200) DEFAULT '' NOT NULL,
	text TEXT NOT NULL,
	reviewer VARCHAR(64) DEFAULT '' NOT NULL,
	status VARCHAR(16) DEFAULT 'open' NOT NULL,
	resolved_at DATETIME,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_annotation_pkg_external UNIQUE (share_package_id, external_id),
	FOREIGN KEY(share_package_id) REFERENCES share_package (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL,
	FOREIGN KEY(document_version_id) REFERENCES resume_version (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_annotation_resume_status ON resume_review_annotation (resume_id, status)
""",
    """\
CREATE INDEX ix_resume_review_annotation_created_at ON resume_review_annotation (created_at)
""",
    """\
CREATE TABLE resume_variant (
	id INTEGER NOT NULL,
	resume_id INTEGER NOT NULL,
	name VARCHAR(256) NOT NULL,
	job_id INTEGER,
	job_title VARCHAR(128) DEFAULT '' NOT NULL,
	company VARCHAR(128) DEFAULT '' NOT NULL,
	content JSON NOT NULL,
	render_context JSON DEFAULT '{}' NOT NULL,
	layout JSON,
	content_sha256 VARCHAR(64) DEFAULT '' NOT NULL,
	base_version_id INTEGER,
	last_synced_version_id INTEGER,
	synced_at DATETIME,
	language VARCHAR(16) DEFAULT '' NOT NULL,
	variant_group_id INTEGER,
	context_snapshot JSON,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE CASCADE,
	FOREIGN KEY(job_id) REFERENCES job (id) ON DELETE SET NULL,
	FOREIGN KEY(base_version_id) REFERENCES resume_version (id) ON DELETE SET NULL,
	FOREIGN KEY(last_synced_version_id) REFERENCES resume_version (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_resume_variant_created_at ON resume_variant (created_at)
""",
    """\
CREATE INDEX ix_resume_variant_resume_id ON resume_variant (resume_id)
""",
    """\
CREATE TABLE resume_export_artifact (
	id INTEGER NOT NULL,
	delivery_id INTEGER,
	resume_id INTEGER,
	kind VARCHAR(16) DEFAULT 'rendered' NOT NULL,
	export_format VARCHAR(16) DEFAULT '' NOT NULL,
	filename VARCHAR(256) DEFAULT '' NOT NULL,
	media_type VARCHAR(128) DEFAULT '' NOT NULL,
	size_bytes INTEGER DEFAULT '0' NOT NULL,
	sha256 VARCHAR(64) DEFAULT '' NOT NULL,
	disk_name VARCHAR(128) DEFAULT '' NOT NULL,
	resource_manifest JSON DEFAULT '{}' NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(delivery_id) REFERENCES resume_delivery_record (id) ON DELETE SET NULL,
	FOREIGN KEY(resume_id) REFERENCES resume_record (id) ON DELETE SET NULL
)
""",
    """\
CREATE INDEX ix_resume_export_artifact_delivery_id ON resume_export_artifact (delivery_id)
""",
    """\
CREATE INDEX ix_resume_export_artifact_disk_name ON resume_export_artifact (disk_name)
""",
    """\
CREATE INDEX ix_resume_export_artifact_resume_id ON resume_export_artifact (resume_id)
""",
)

DOWN_STATEMENTS: tuple[str, ...] = (
    "DROP TABLE IF EXISTS resume_export_artifact",
    "DROP TABLE IF EXISTS resume_variant",
    "DROP TABLE IF EXISTS resume_review_annotation",
    "DROP TABLE IF EXISTS resume_version",
    "DROP TABLE IF EXISTS resume_phrase",
    "DROP TABLE IF EXISTS resume_generate_task",
    "DROP TABLE IF EXISTS resume_fact_lock",
    "DROP TABLE IF EXISTS resume_block_source",
    "DROP TABLE IF EXISTS resume_source_revision",
    "DROP TABLE IF EXISTS resume_record",
    "DROP TABLE IF EXISTS resume_template",
    "DROP TABLE IF EXISTS resume_source",
    "DROP TABLE IF EXISTS resume_glossary_term",
    "DROP TABLE IF EXISTS resume_export_preset",
)

__all__ = ["STATEMENTS", "DOWN_STATEMENTS"]
