# SPDX-License-Identifier: Apache-2.0
"""本地 embedding 的隔离运行时：解包目录约定、sys.path 注入、版本自检与卸载回退。

**为什么不在模块顶层 import onnxruntime / numpy / tokenizers**：这三个包只存在于按需下载
到数据目录的隔离运行时里（见 ``dist/rag-assets``），基础安装包与 backend/.venv 都不装。
模块顶层导入会把"只用远程 provider 的用户"也拖进 ImportError；导入只能发生在
:func:`ensure_runtime` 把 site-packages 注入 sys.path **之后**的函数体内（任务书 §2 红线）。

目录约定（带版本子目录，升级/换模型自动切目录、旧目录可清理）：

```text
DATA_DIR/rag-runtime/ort-<version>/site-packages/{onnxruntime,numpy,tokenizers,...}
DATA_DIR/rag-model/<model-id>-<variant>/*.onnx + tokenizer.json + configs
```

两个目录都登记在 ``data_backup/coverage.py::RUNTIME_ONLY``（可重建、不进备份）。
"""

from __future__ import annotations

import gc
import logging
import shutil
import sys
import zipfile
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Any

from ...config import DATA_DIR, get_settings
from .rag_asset_manifest import (
    AssetUnavailable,
    load_manifest,
    runtime_package_versions,
    select_assets,
)

logger = logging.getLogger(__name__)

#: ensure_runtime() 注入过、需要在卸载时移除的 site-packages 路径。
_INJECTED_PATHS: set[str] = set()
#: 卸载回调（如本地 provider 的 session 缓存）：让缓存随运行时一起失效。
_UNLOAD_HOOKS: list[Callable[[], None]] = []
#: 本模块会调用的三个包的版本自检目标。
_PACKAGE_MODULES: tuple[tuple[str, str], ...] = (
    ("onnxruntime", "onnxruntime"),
    ("numpy", "numpy"),
    ("tokenizers", "tokenizers"),
)


class RuntimeUnavailable(RuntimeError):
    """本地运行时缺失/导入失败/版本不匹配；消息可直接展示给用户。"""


def _local_dir(dirname_setting: str, default: str) -> Path:
    value = getattr(get_settings(), dirname_setting, default) or default
    return Path(DATA_DIR) / str(value)


def model_dir(variant: str) -> Path:
    """本地模型目录：``DATA_DIR/rag-model/<model-id>-<variant>``。"""
    try:
        model = load_manifest()["model"]
    except AssetUnavailable as exc:
        raise RuntimeUnavailable(str(exc)) from exc
    model_id = str(model.get("id") or "").strip()
    if not model_id:
        raise RuntimeUnavailable("本地 embedding 资产清单缺少模型 id")
    suffix = str(variant or model.get("variant") or "").strip() or "unknown"
    return _local_dir("rag_local_model_dirname", "rag-model") / f"{model_id}-{suffix}"


def runtime_dir(ort_version: str) -> Path:
    """本地运行时目录：``DATA_DIR/rag-runtime/ort-<version>``。"""
    version = str(ort_version or "").strip() or "unknown"
    return _local_dir("rag_local_runtime_dirname", "rag-runtime") / f"ort-{version}"


def _site_packages(ort_version: str) -> Path:
    return runtime_dir(ort_version) / "site-packages"


def runtime_ready(ort_version: str) -> bool:
    """解包完成的判据：site-packages/onnxruntime 是非空目录（不看文件哈希，慢）。"""
    package = _site_packages(ort_version) / "onnxruntime"
    try:
        return package.is_dir() and any(package.iterdir())
    except OSError:
        return False


def ensure_runtime() -> dict[str, Any]:
    """注入隔离运行时并做版本自检；成功返回 {version, numpy, tokenizers, site_packages}。"""
    try:
        ort_version = str(select_assets()["ort_version"])
    except AssetUnavailable as exc:
        raise RuntimeUnavailable(str(exc)) from exc
    site = _site_packages(ort_version)
    if not runtime_ready(ort_version):
        raise RuntimeUnavailable("本地语义检索运行时尚未下载")
    site_text = str(site)
    if site_text not in sys.path:
        # 放在最前面：隔离运行时里的包必须优先于任何同名全局包（任务书 §2）。
        sys.path.insert(0, site_text)
        _INJECTED_PATHS.add(site_text)
    try:
        imported: dict[str, Any] = {}
        for module_name, _ in _PACKAGE_MODULES:
            imported[module_name] = __import__(module_name)
    except Exception as exc:  # noqa: BLE001 - 缺 DLL / 架构不符 / 文件被删都按"运行时不可用"
        unload_runtime()
        raise RuntimeUnavailable(f"本地语义检索运行时导入失败（{type(exc).__name__}）") from exc
    expected = runtime_package_versions()
    for module_name, version in expected.items():
        actual = str(getattr(imported.get(module_name), "__version__", "") or "")
        if actual and actual.split("+")[0] != version:
            unload_runtime()
            raise RuntimeUnavailable(
                f"本地语义检索运行时版本不匹配（{module_name} {actual} != {version}）"
            )
    logger.info("本地 embedding 运行时已就绪：onnxruntime=%s site=%s", ort_version, site_text)
    return {
        "version": ort_version,
        "onnxruntime": str(getattr(imported["onnxruntime"], "__version__", "")),
        "numpy": str(getattr(imported["numpy"], "__version__", "")),
        "tokenizers": str(getattr(imported["tokenizers"], "__version__", "")),
        "site_packages": site_text,
    }


def unload_runtime() -> None:
    """移除注入的 site-packages 并清掉从其加载的模块；之后可安全回退关键词链。"""
    for hook in list(_UNLOAD_HOOKS):
        try:
            hook()
        except Exception:  # noqa: BLE001 - 卸载回调失败不能阻断回退
            logger.debug("本地 embedding 卸载回调失败", exc_info=True)
    for site in list(_INJECTED_PATHS):
        sys.path[:] = [entry for entry in sys.path if entry != site]
        _INJECTED_PATHS.discard(site)
        prefix = site.rstrip("\\/") + "\\"
        prefix_posix = site.rstrip("\\/") + "/"
        for name in list(sys.modules):
            module = sys.modules.get(name)
            file = str(getattr(module, "__file__", "") or "")
            if file and (file.startswith(prefix) or file.startswith(prefix_posix)):
                sys.modules.pop(name, None)
    # Windows：扩展模块（onnxruntime 的 .pyd/DLL）要等最后一个引用释放才真正卸载；
    # 不 gc 的话目录里的 DLL 仍被占用，删除/重装运行时会在 rename 处报 WinError 5。
    gc.collect()


def register_unload_hook(hook: Callable[[], None]) -> None:
    """登记"运行时卸载时要清掉的缓存"（本地 provider 用它清 session/tokenizer 缓存）。"""
    if hook not in _UNLOAD_HOOKS:
        _UNLOAD_HOOKS.append(hook)


def safe_extract_zip(archive_path: Path, target: Path) -> None:
    """安全解包资产 zip：拒绝路径穿越 / 绝对路径 / 符号链接，坏包转可读错误。

    解包是"运行时安装"的一部分（文件布局就是本模块的目录约定），所以实现放在这里；
    下载状态机只管"把字节下下来并校验"，不重复一份目录安全逻辑。
    """
    target.mkdir(parents=True, exist_ok=True)
    base = target.resolve()
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for info in archive.infolist():
                relative = PurePosixPath(info.filename)
                if relative.is_absolute() or ".." in relative.parts or ":" in relative.parts[0]:
                    raise RuntimeUnavailable("本地资产包结构非法（路径穿越）")
                destination = (base / info.filename).resolve()
                if destination != base and base not in destination.parents:
                    raise RuntimeUnavailable("本地资产包结构非法（路径穿越）")
                if info.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                    continue
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise RuntimeUnavailable("本地资产包结构非法（符号链接）")
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
    except (zipfile.BadZipFile, OSError) as exc:
        raise RuntimeUnavailable("本地资产包损坏或解压失败") from exc


def assets_present() -> bool:
    """模型文件与运行时是否都已就绪（不含 sha256 校验，那一步在 activate 时做一次）。"""
    try:
        assets = select_assets()
    except AssetUnavailable:
        return False
    variant = str(assets.get("variant") or "")
    directory = model_dir(variant)
    try:
        has_tokenizer = (directory / "tokenizer.json").is_file()
        has_model = any(
            path.is_file() and path.stat().st_size > 0 for path in directory.glob("*.onnx")
        )
    except OSError:
        return False
    return has_tokenizer and has_model and runtime_ready(str(assets.get("ort_version")))


__all__ = [
    "RuntimeUnavailable",
    "assets_present",
    "safe_extract_zip",
    "ensure_runtime",
    "model_dir",
    "register_unload_hook",
    "runtime_dir",
    "runtime_ready",
    "unload_runtime",
]
