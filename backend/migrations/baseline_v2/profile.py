# SPDX-License-Identifier: Apache-2.0
"""个人资料域：资料子表与 2.0 条目标模型。

本文件由 backend/scripts/dump_baseline_ddl.py 从 Base.metadata 生成，不要手工编辑。重新生成：cd backend && python scripts/dump_baseline_ddl.py；漂移检查：python scripts/dump_baseline_ddl.py --check（不一致退出码 1）。
"""

from __future__ import annotations

STATEMENTS: tuple[str, ...] = (
    """\
CREATE TABLE profile_custom_field (
	id INTEGER NOT NULL,
	field_id VARCHAR(32) NOT NULL,
	section_key VARCHAR(48) NOT NULL,
	label VARCHAR(40) NOT NULL,
	label_key VARCHAR(40) NOT NULL,
	field_type VARCHAR(16) NOT NULL,
	default_placement VARCHAR(16),
	material_only BOOLEAN DEFAULT '0' NOT NULL,
	sort_order INTEGER DEFAULT '0' NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	deleted_at DATETIME,
	created_at DATETIME NOT NULL,
	updated_at DATETIME,
	PRIMARY KEY (id),
	UNIQUE (field_id)
)
""",
    """\
CREATE INDEX ix_profile_custom_field_section_key ON profile_custom_field (section_key)
""",
    """\
CREATE UNIQUE INDEX ux_profile_custom_field_active_label ON profile_custom_field (section_key, label_key) WHERE deleted_at IS NULL
""",
    """\
CREATE TABLE profile_custom_section (
	id INTEGER NOT NULL,
	section_id VARCHAR(32) NOT NULL,
	"key" VARCHAR(48) NOT NULL,
	name VARCHAR(40) NOT NULL,
	name_key VARCHAR(40) NOT NULL,
	sort_order INTEGER DEFAULT '0' NOT NULL,
	primary_field_id VARCHAR(32),
	filter_by_job BOOLEAN DEFAULT '0' NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	deleted_at DATETIME,
	created_at DATETIME NOT NULL,
	updated_at DATETIME,
	PRIMARY KEY (id),
	UNIQUE (section_id),
	UNIQUE ("key")
)
""",
    """\
CREATE INDEX ix_profile_custom_section_sort_order ON profile_custom_section (sort_order)
""",
    """\
CREATE UNIQUE INDEX ux_profile_custom_section_active_name ON profile_custom_section (name_key) WHERE deleted_at IS NULL
""",
    """\
CREATE TABLE profile_entry (
	id INTEGER NOT NULL,
	entry_id VARCHAR(32) NOT NULL,
	section_key VARCHAR(48) NOT NULL,
	sort_order INTEGER DEFAULT '0' NOT NULL,
	"values" JSON DEFAULT '{}' NOT NULL,
	field_snapshot JSON DEFAULT '[]' NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	values_schema INTEGER DEFAULT '1' NOT NULL,
	deleted_at DATETIME,
	created_at DATETIME NOT NULL,
	updated_at DATETIME,
	PRIMARY KEY (id),
	CONSTRAINT ck_profile_entry_singleton_sort_order CHECK (section_key NOT IN ('basic_info', 'summary') OR sort_order = 0),
	UNIQUE (entry_id)
)
""",
    """\
CREATE INDEX ix_profile_entry_section_key ON profile_entry (section_key)
""",
    """\
CREATE UNIQUE INDEX ux_profile_entry_active_section_sort ON profile_entry (section_key, sort_order) WHERE deleted_at IS NULL
""",
    """\
CREATE TABLE profile_field_preference (
	id INTEGER NOT NULL,
	section_key VARCHAR(48) NOT NULL,
	field_id VARCHAR(32) NOT NULL,
	hidden BOOLEAN DEFAULT '0' NOT NULL,
	collapsed_override BOOLEAN,
	revision INTEGER DEFAULT '1' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME,
	PRIMARY KEY (id),
	CONSTRAINT uq_profile_field_preference_section_field UNIQUE (section_key, field_id)
)
""",
    """\
CREATE TABLE profile_group (
	id INTEGER NOT NULL,
	group_id VARCHAR(32) NOT NULL,
	name VARCHAR(40) NOT NULL,
	name_key VARCHAR(40) NOT NULL,
	is_default BOOLEAN DEFAULT '0' NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	deleted_at DATETIME,
	created_at DATETIME NOT NULL,
	updated_at DATETIME,
	PRIMARY KEY (id),
	CONSTRAINT ck_profile_group_default_not_deleted CHECK (is_default = 0 OR deleted_at IS NULL),
	UNIQUE (group_id)
)
""",
    """\
CREATE UNIQUE INDEX ux_profile_group_active_name ON profile_group (name_key) WHERE deleted_at IS NULL
""",
    """\
CREATE UNIQUE INDEX ux_profile_group_single_default ON profile_group (is_default) WHERE is_default = 1 AND deleted_at IS NULL
""",
    """\
CREATE TABLE profile_group_member (
	group_id VARCHAR(32) NOT NULL,
	section_key VARCHAR(48) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (group_id, section_key)
)
""",
    """\
CREATE TABLE profile_usage_snapshot (
	id INTEGER NOT NULL,
	snapshot_id VARCHAR(32) NOT NULL,
	task_id INTEGER,
	resume_id INTEGER,
	group_id VARCHAR(32),
	group_name VARCHAR(40) NOT NULL,
	participating JSON DEFAULT '[]' NOT NULL,
	section_order JSON DEFAULT '[]' NOT NULL,
	definition_revision INTEGER DEFAULT '0' NOT NULL,
	data_revision INTEGER DEFAULT '0' NOT NULL,
	layout JSON,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (snapshot_id),
	UNIQUE (task_id),
	UNIQUE (resume_id)
)
""",
    """\
CREATE TABLE profile_workspace_state (
	id INTEGER NOT NULL,
	current_group_id VARCHAR(32) NOT NULL,
	default_group_id VARCHAR(32) NOT NULL,
	section_order JSON DEFAULT '[]' NOT NULL,
	pending_notice JSON,
	notice_id VARCHAR(32),
	revision INTEGER DEFAULT '1' NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME,
	PRIMARY KEY (id),
	CONSTRAINT ck_profile_workspace_state_single_row CHECK (id = 1)
)
""",
    """\
CREATE TABLE award (
	id INTEGER NOT NULL,
	profile_id INTEGER NOT NULL,
	name VARCHAR(128) NOT NULL,
	date VARCHAR(32) NOT NULL,
	description VARCHAR(256) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(profile_id) REFERENCES user_profile (id) ON DELETE CASCADE
)
""",
    """\
CREATE TABLE campus_experience (
	id INTEGER NOT NULL,
	profile_id INTEGER NOT NULL,
	organization VARCHAR(128) NOT NULL,
	role VARCHAR(128) NOT NULL,
	start_date VARCHAR(16) NOT NULL,
	end_date VARCHAR(16) NOT NULL,
	description TEXT NOT NULL,
	reference_file_name VARCHAR(255) NOT NULL,
	reference_content TEXT NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(profile_id) REFERENCES user_profile (id) ON DELETE CASCADE
)
""",
    """\
CREATE TABLE education (
	id INTEGER NOT NULL,
	profile_id INTEGER NOT NULL,
	school VARCHAR(128) NOT NULL,
	department VARCHAR(128) NOT NULL,
	major VARCHAR(128) NOT NULL,
	degree VARCHAR(32) NOT NULL,
	study_mode VARCHAR(32) NOT NULL,
	degree_type VARCHAR(32) NOT NULL,
	start_date VARCHAR(16) NOT NULL,
	end_date VARCHAR(16) NOT NULL,
	gpa VARCHAR(32) NOT NULL,
	cet4_score VARCHAR(16) NOT NULL,
	cet6_score VARCHAR(16) NOT NULL,
	courses TEXT NOT NULL,
	achievements TEXT NOT NULL,
	reference_file_name VARCHAR(255) NOT NULL,
	reference_content TEXT NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(profile_id) REFERENCES user_profile (id) ON DELETE CASCADE
)
""",
    """\
CREATE TABLE experience (
	id INTEGER NOT NULL,
	profile_id INTEGER NOT NULL,
	company VARCHAR(128) NOT NULL,
	role VARCHAR(128) NOT NULL,
	start_date VARCHAR(16) NOT NULL,
	end_date VARCHAR(16) NOT NULL,
	description TEXT NOT NULL,
	reference_file_name VARCHAR(255) NOT NULL,
	reference_content TEXT NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(profile_id) REFERENCES user_profile (id) ON DELETE CASCADE
)
""",
    """\
CREATE TABLE profile_photo (
	id INTEGER NOT NULL,
	profile_id INTEGER NOT NULL,
	name VARCHAR(128) NOT NULL,
	image TEXT NOT NULL,
	is_primary BOOLEAN NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(profile_id) REFERENCES user_profile (id) ON DELETE CASCADE
)
""",
    """\
CREATE INDEX ix_profile_photo_profile_id ON profile_photo (profile_id)
""",
    """\
CREATE TABLE project (
	id INTEGER NOT NULL,
	profile_id INTEGER NOT NULL,
	name VARCHAR(128) NOT NULL,
	role VARCHAR(64) NOT NULL,
	start_date VARCHAR(16) NOT NULL,
	end_date VARCHAR(16) NOT NULL,
	tech_stack VARCHAR(256) NOT NULL,
	description TEXT NOT NULL,
	highlights TEXT NOT NULL,
	reference_file_name VARCHAR(255) NOT NULL,
	reference_content TEXT NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(profile_id) REFERENCES user_profile (id) ON DELETE CASCADE
)
""",
    """\
CREATE TABLE skill (
	id INTEGER NOT NULL,
	profile_id INTEGER NOT NULL,
	name VARCHAR(64) NOT NULL,
	level VARCHAR(32) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(profile_id) REFERENCES user_profile (id) ON DELETE CASCADE
)
""",
)

DOWN_STATEMENTS: tuple[str, ...] = (
    "DROP TABLE IF EXISTS skill",
    "DROP TABLE IF EXISTS project",
    "DROP TABLE IF EXISTS profile_photo",
    "DROP TABLE IF EXISTS experience",
    "DROP TABLE IF EXISTS education",
    "DROP TABLE IF EXISTS campus_experience",
    "DROP TABLE IF EXISTS award",
    "DROP TABLE IF EXISTS profile_workspace_state",
    "DROP TABLE IF EXISTS profile_usage_snapshot",
    "DROP TABLE IF EXISTS profile_group_member",
    "DROP TABLE IF EXISTS profile_group",
    "DROP TABLE IF EXISTS profile_field_preference",
    "DROP TABLE IF EXISTS profile_entry",
    "DROP TABLE IF EXISTS profile_custom_section",
    "DROP TABLE IF EXISTS profile_custom_field",
)

__all__ = ["STATEMENTS", "DOWN_STATEMENTS"]
