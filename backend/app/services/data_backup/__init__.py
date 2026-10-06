"""用户数据备份：导出为可迁移的压缩包，以及从压缩包恢复。

ResumeForge 的用户数据都在 SQLite 文件里——照片、经历参考文件和助手图片附件都以
base64 存在数据库列中，磁盘上没有其它用户文件。所以一次备份就是「一份一致性快照 +
一份元信息」，用标准库 zipfile 即可，不需要搬运目录。

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
from .export import (
    create_backup_archive as create_backup_archive,
)
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
    BACKUP_FORMAT_MULTI_DATASET as BACKUP_FORMAT_MULTI_DATASET,
)
from .paths import (
    BACKUP_FORMAT_VERSION as BACKUP_FORMAT_VERSION,
)
from .paths import (
    BACKUP_FORMAT_WITH_KEYS as BACKUP_FORMAT_WITH_KEYS,
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
    export_directory as export_directory,
)
from .paths import (
    purge_stale_restores as purge_stale_restores,
)
from .paths import (
    restore_directory as restore_directory,
)

logger = logging.getLogger(__name__)  # 保持拆分前的 logger 名（app.services.data_backup）
