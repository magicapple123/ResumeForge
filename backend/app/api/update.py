"""软件更新检查接口（只读，不执行任何自动更新）。"""
import logging

from fastapi import APIRouter, HTTPException, Query

from ..schemas.update import (
    UpdateCheckResult,
    UpdateDownloadRequest,
    UpdateInstallRequest,
    UpdateInstallResult,
    UpdateStatus,
)
from ..services.update_download import (
    clear_install_result,
    download_status,
    read_install_result,
    schedule_install,
    start_download,
)
from ..services.update_check import check_for_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/update", tags=["update"])


@router.get("/check", response_model=UpdateCheckResult)
async def read_update_status(refresh: bool = Query(default=False)):
    """对比本地版本与 GitHub 最新 Release。

    结果缓存 15 分钟；``refresh=true`` 时强制重新请求（用户点「重新检查」）。
    """
    return await check_for_update(refresh=refresh)


@router.get("/download-status", response_model=UpdateStatus)
def read_download_status():
    """返回应用内下载/安装任务的当前进度。"""
    return download_status()


@router.post("/download", response_model=UpdateStatus)
async def download_update(payload: UpdateDownloadRequest):
    """开始后台下载更新包；下载完成前不会替换任何程序文件。"""
    try:
        return await start_download(background=payload.background)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/install", response_model=UpdateStatus)
def install_update(payload: UpdateInstallRequest):
    """安排独立更新器覆盖安装并按需重启。"""
    try:
        return schedule_install(restart=payload.restart)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/install-result", response_model=UpdateInstallResult | None)
def read_last_install_result():
    """上一次应用内更新的结果；没有需要汇报的就返回 ``null``。

    界面靠它决定"要不要弹成功"——成功与否以**当前版本号**为准，不是以更新器
    自己写的状态为准（它报失败但新版本其实起来了，仍然算成功）。
    """
    result = read_install_result()
    return UpdateInstallResult(**result) if result else None


@router.delete("/install-result", status_code=204)
def acknowledge_install_result():
    """用户看过结果之后清掉标记，避免每次打开设置都弹一遍。"""
    clear_install_result()
    return None
