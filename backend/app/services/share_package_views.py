# SPDX-License-Identifier: Apache-2.0
"""从 ``share_package`` 拆出：分享包的列表摘要 / 详情视图序列化。

只做"数据库行 → 响应 schema"的装配（下载地址由文件清单里的文件名拼出）；
``share_package.py`` 里 re-export，路由的导入路径不变。
"""

from __future__ import annotations

from ..models.share_package import SharePackage
from ..schemas.share_package import ShareFileOut, SharePackageBrief, SharePackageOut


def _download_url(package: SharePackage, name: str) -> str:
    return f"/api/share-packages/{package.id}/files/{name}"


def share_package_brief(package: SharePackage) -> SharePackageBrief:
    """分享包的列表摘要视图。"""
    return SharePackageBrief(
        id=package.id,
        title=package.title,
        resume_id=package.resume_id,
        job_id=package.job_id,
        permission=package.permission,
        file_count=len(package.files or []),
        created_at=package.created_at,
        updated_at=package.updated_at,
    )


def share_package_out(package: SharePackage) -> SharePackageOut:
    """分享包详情视图：文件清单（含下载地址）与脱敏快照、权限、token。"""
    files = [
        ShareFileOut(
            name=str(item.get("name", "")),
            path=str(item.get("path", "")),
            format=str(item.get("format", "")),
            size=int(item.get("size", 0)),
            sha256=str(item.get("sha256", "")),
            download_url=_download_url(package, str(item.get("name", ""))),
        )
        for item in (package.files or [])
    ]
    return SharePackageOut(
        id=package.id,
        title=package.title,
        resume_id=package.resume_id,
        job_id=package.job_id,
        permission=package.permission,
        files=files,
        snapshot=package.snapshot or {},
        comments_file=package.comments_file or "",
        share_token=package.share_token or "",
        redaction_config=package.redaction_config or {},
        created_at=package.created_at,
        updated_at=package.updated_at,
    )
