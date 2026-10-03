"""用户数据备份：导出为可迁移的压缩包，以及从压缩包恢复。

ResumeForge 的用户数据都在 SQLite 文件里——照片、经历参考文件和助手图片附件都以
base64 存在数据库列中，磁盘上没有其它用户文件。所以一次备份就是「一份一致性快照 +
一份元信息」，用标准库 zipfile 即可，不需要搬运目录。

**但"一份数据"未必只有一个文件**：应用支持多份数据集，每份各占一个数据库文件，而
一次导出默认只带走**当前活动**的那一份。所以导出分两档：只导活动数据集（格式 1，
老版本照常可读）与连同其余数据集一并导出（格式 2，老版本会明确拒收而不是安静地
只恢复一份）。见 ``create_backup_archive`` 与 ``ExtraDatabase``。

导出物**不包含**大模型 API Key：用户可能长期保存或转发这个包。SECURITY: 清空
密钥必须配合 ``VACUUM`` 重建文件，只 UPDATE 是不够的——见 ``_strip_api_keys``；
随包带走的**每一份**数据集都要各做一次，不能只做活动的那份。
"""
import logging

from .api_keys import (
    _assert_no_plaintext_key as _assert_no_plaintext_key,
    _plaintext_api_keys as _plaintext_api_keys,
    _plaintext_api_keys_in as _plaintext_api_keys_in,
    _strip_api_keys as _strip_api_keys,
)
from .export import (
    create_backup_archive as create_backup_archive,
)
from .import_archive import (
    _assert_member_is_a_dataset as _assert_member_is_a_dataset,
    _check_candidate_revision as _check_candidate_revision,
    _database_info as _database_info,
    _read_candidate_revision as _read_candidate_revision,
    _read_manifest as _read_manifest,
    _upgrade_candidate as _upgrade_candidate,
    declared_datasets as declared_datasets,
    extract_database as extract_database,
    extract_member as extract_member,
    inspect_archive as inspect_archive,
    inspect_extra_dataset as inspect_extra_dataset,
)
from .manifest import (
    _revision_chain as _revision_chain,
    _table_counts as _table_counts,
    build_manifest as build_manifest,
    current_head_revision as current_head_revision,
)
from .paths import (
    ARCHIVE_DATASETS_DIRNAME as ARCHIVE_DATASETS_DIRNAME,
    BACKUP_FORMAT_VERSION as BACKUP_FORMAT_VERSION,
    BackupError as BackupError,
    DATABASE_MEMBER as DATABASE_MEMBER,
    EXPORT_DIRNAME as EXPORT_DIRNAME,
    ExtraDatabase as ExtraDatabase,
    MANIFEST_MEMBER as MANIFEST_MEMBER,
    RESTORE_DIRNAME as RESTORE_DIRNAME,
    _STALE_TEMP_SECONDS as _STALE_TEMP_SECONDS,
    _purge_stale as _purge_stale,
    cleanup_temp_directories as cleanup_temp_directories,
    database_path as database_path,
    export_directory as export_directory,
    purge_stale_restores as purge_stale_restores,
    restore_directory as restore_directory,
)

logger = logging.getLogger(__name__)  # 保持拆分前的 logger 名（app.services.data_backup）
