"""用户数据备份：导出为可迁移的压缩包，以及从压缩包恢复。

ResumeForge 的用户数据**主要**在 SQLite 文件里——照片、经历参考文件和助手图片附件
以 base64 存在数据库列中。**但磁盘上确实还有一类用户文件**：按内容寻址落盘的
``user_files/`` 副本（"我的文件"）与内推备注图 ``referral_images/``，数据库里只登记
引用（``user_file.disk_name`` / ``referral.note_images``），原件不进库。所以备份包 =
一致性快照 + 元信息 + **按引用收集的附件**（``asset_manifest`` 逐文件记 size/SHA-256，
见 ``asset_manifest.py``）。导入侧先验后发布、绝不覆盖本机同名附件。

**但"一份数据"未必只有一个文件**：应用支持多份数据集，每份各占一个数据库文件，而
一次导出默认只带走**当前活动**的那一份。所以导出分两档：只导活动数据集（格式 1，
老版本照常可读）与连同其余数据集一并导出（格式 2，老版本会明确拒收而不是安静地
只恢复一份）。见 ``create_backup_archive`` 与 ``ExtraDatabase``。

**API Key 默认被剥离**：用户可能长期保存或转发这个包。SECURITY: 清空密钥必须配合
``VACUUM`` 重建文件，只 UPDATE 是不够的——见 ``_strip_api_keys``；随包带走的**每一份**
数据集都要各做一次，不能只做活动的那份。用户可以在导出时**显式勾选**包含 API Key
（格式 3）：密钥按本机存储形态随包走（Windows 上是 DPAPI 密文），导入侧要求清单
显式声明密钥状态，老版本则会在格式校验处明确拒收。
"""

import logging

from .api_keys import (
    _assert_no_plaintext_key as _assert_no_plaintext_key,
)
from .api_keys import (
    _plaintext_api_keys as _plaintext_api_keys,
)
from .api_keys import (
    _plaintext_api_keys_in as _plaintext_api_keys_in,
)
from .api_keys import (
    _strip_api_keys as _strip_api_keys,
)
from .asset_manifest import (
    ASSET_CATEGORIES as ASSET_CATEGORIES,
)
from .asset_manifest import (
    ASSET_MANIFEST_VERSION as ASSET_MANIFEST_VERSION,
)
from .asset_manifest import (
    build_asset_manifest as build_asset_manifest,
)
from .asset_manifest import (
    collect_referenced_names as collect_referenced_names,
)
from .asset_manifest import (
    file_digest as file_digest,
)
from .asset_manifest import (
    manifest_asset_counts as manifest_asset_counts,
)
from .asset_manifest import (
    manifest_asset_notes as manifest_asset_notes,
)
from .asset_manifest import (
    manifest_asset_warnings as manifest_asset_warnings,
)
from .asset_manifest import (
    verify_database_rows as verify_database_rows,
)
from .asset_restore import (
    AssetRestorePlan as AssetRestorePlan,
)
from .asset_restore import (
    restore_assets_from_manifest as restore_assets_from_manifest,
)
from .asset_restore import (
    verify_restored_assets as verify_restored_assets,
)
from .collection_export import (
    create_collection_archive as create_collection_archive,
)
from .export import (
    create_backup_archive as create_backup_archive,
)
from .global_config import GLOBAL_LLM_MEMBER as GLOBAL_LLM_MEMBER
from .import_archive import (
    _assert_member_is_a_dataset as _assert_member_is_a_dataset,
)
from .import_archive import (
    _best_effort_checkpoint as _best_effort_checkpoint,
)
from .import_archive import (
    _check_candidate_revision as _check_candidate_revision,
)
from .import_archive import (
    _database_info as _database_info,
)
from .import_archive import (
    _read_candidate_revision as _read_candidate_revision,
)
from .import_archive import (
    _read_manifest as _read_manifest,
)
from .import_archive import (
    _remove_candidate_files as _remove_candidate_files,
)
from .import_archive import (
    _remove_sqlite_sidecars as _remove_sqlite_sidecars,
)
from .import_archive import (
    _upgrade_candidate as _upgrade_candidate,
)
from .import_archive import (
    declared_datasets as declared_datasets,
)
from .import_archive import (
    extract_database as extract_database,
)
from .import_archive import (
    extract_member as extract_member,
)
from .import_archive import (
    inspect_archive as inspect_archive,
)
from .import_archive import (
    inspect_extra_dataset as inspect_extra_dataset,
)
from .manifest import (
    _revision_chain as _revision_chain,
)
from .manifest import (
    _table_counts as _table_counts,
)
from .manifest import (
    build_manifest as build_manifest,
)
from .manifest import (
    current_head_revision as current_head_revision,
)
from .paths import (
    _STALE_TEMP_SECONDS as _STALE_TEMP_SECONDS,
)
from .paths import (
    ARCHIVE_DATASETS_DIRNAME as ARCHIVE_DATASETS_DIRNAME,
)
from .paths import (
    BACKUP_FORMAT_GLOBAL_CONFIG as BACKUP_FORMAT_GLOBAL_CONFIG,
)
from .paths import (
    BACKUP_FORMAT_MULTI_DATASET as BACKUP_FORMAT_MULTI_DATASET,
)
from .paths import (
    BACKUP_FORMAT_NESTED_COLLECTION as BACKUP_FORMAT_NESTED_COLLECTION,
)
from .paths import (
    BACKUP_FORMAT_VERSION as BACKUP_FORMAT_VERSION,
)
from .paths import (
    BACKUP_FORMAT_WITH_KEYS as BACKUP_FORMAT_WITH_KEYS,
)
from .paths import (
    BACKUP_TRASH_DIRNAME as BACKUP_TRASH_DIRNAME,
)
from .paths import (
    DATABASE_MEMBER as DATABASE_MEMBER,
)
from .paths import (
    EXPORT_DIRNAME as EXPORT_DIRNAME,
)
from .paths import (
    MANIFEST_MEMBER as MANIFEST_MEMBER,
)
from .paths import (
    README_MEMBER as README_MEMBER,
)
from .paths import (
    RESTORE_DIRNAME as RESTORE_DIRNAME,
)
from .paths import (
    BackupError as BackupError,
)
from .paths import (
    ExtraDatabase as ExtraDatabase,
)
from .paths import (
    _purge_stale as _purge_stale,
)
from .paths import (
    cleanup_temp_directories as cleanup_temp_directories,
)
from .paths import (
    database_path as database_path,
)
from .paths import (
    dataset_asset_prefix as dataset_asset_prefix,
)
from .paths import (
    export_directory as export_directory,
)
from .paths import (
    purge_stale_restores as purge_stale_restores,
)
from .paths import (
    restore_directory as restore_directory,
)

logger = logging.getLogger(__name__)  # 保持拆分前的 logger 名（app.services.data_backup）
