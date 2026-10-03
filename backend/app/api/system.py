"""应用生命周期接口：退出应用。

这是本项目唯一一个"会让服务消失"的接口，因此边界写得很死：
- **只接受回环请求**：局域网里的页面不该有权限关掉别人的应用；
- 先返回响应再退出（延迟一小会儿），否则浏览器只会看到一个连接被重置的错误。

前端点「退出」后：**前端与后端进程都会被停掉**（前端交给启动器那套"按记录 + 校验
启动时刻/命令行"的停止脚本，它只杀记录对得上的那棵树），页面随即失去全部数据来源，
可以直接关闭标签页；重新使用双击 `start.cmd`。

**退出路径绝不允许抛异常**：`_stop_frontend_process` 里的任何失败（脚本找不到、超时、
输出解码出错）都必须被吞掉并记日志——否则退出线程会半途死掉，变成"前端收到 202、
后端却不退"这种最难查的状态。
"""
import ipaddress
import locale
import logging
import os
import signal
import subprocess
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from ..services.diagnostics import diagnostic_snapshot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["system"])

# 退出前的等待：够响应走完浏览器这一趟，又不至于让用户觉得没反应。
_SHUTDOWN_DELAY_SECONDS = 0.6
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_WINDOWS_STOP_SCRIPT = _PROJECT_ROOT / "scripts" / "Stop-ResumeForge.ps1"
_MACOS_STOP_SCRIPT = _PROJECT_ROOT / "scripts" / "macos" / "stop.sh"

# 等停止脚本的预算：正常一两秒就完了，给太长的例外是"等待期间后端还活着"——用户这时
# 双击 start.cmd，启动器会看到后端仍在监听、判定"已经在运行"而跳过启动，几秒后它却死了。
_STOP_TIMEOUT_SECONDS = 8.0
# 日志里最多留这么长的脚本输出（诊断用，不是给用户看的）。
_STOP_LOG_CHARS = 2000


def _is_loopback_request(request: Request) -> bool:
    """与密钥查看同一套判断：只有直连本机的请求算数。"""
    if request.client is None:
        return False
    try:
        address = ipaddress.ip_address(request.client.host.split("%", maxsplit=1)[0])
    except ValueError:
        return False
    if address.is_loopback:
        return True
    # ipv4_mapped 只存在于 IPv6 地址对象上：直接用属性访问会在"IPv4 且非回环"时
    # 抛 AttributeError（本该返回 403 的请求变成 500）。
    mapped = getattr(address, "ipv4_mapped", None)
    return mapped is not None and mapped.is_loopback


def _stop_command() -> list[str]:
    """按平台给出"只停前端"的命令；两个平台都是启动器那套按记录停止的脚本。"""
    if os.name == "nt":
        return [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(_WINDOWS_STOP_SCRIPT),
            "-SkipBackend",
        ]
    return ["/bin/bash", str(_MACOS_STOP_SCRIPT), "--skip-backend"]


def _stop_output_encodings() -> tuple[str, ...]:
    """候选解码顺序。

    Windows 上子进程按**代码页**输出（中文系统是 cp936），而 `locale` 在本项目的启动
    环境下（`PYTHONUTF8=1`）会返回 utf-8——只靠 locale 会得到一串问号，日志等于白记。
    所以显式把 `mbcs`（Windows 的 ANSI 代码页）排进去。
    """
    encodings = ["utf-8"]
    if os.name == "nt":
        encodings.append("mbcs")
    preferred = locale.getpreferredencoding(False)
    if preferred:
        encodings.append(preferred)
    return tuple(encodings)


def _decode_stop_output(raw: bytes | None, encodings: tuple[str, ...] | None = None) -> str:
    """把停止脚本的输出解成能进日志的文本。

    解码**绝不能抛**：这里的失败会让退出线程死在发信号之前（"点了退出，进程还在"）。
    所以最后一定要有一个 `errors="replace"` 的兜底。

    `encodings` 只为让测试能钉住回退链：真实候选表由 `_stop_output_encodings()` 按
    **这台机器的代码页**给出（中文 Windows 是 cp936、英文的是 cp1252），而 cp1252 能把
    GBK 字节解成一串乱码却**不报错**——不注入的话，这条链就变成"测试机是哪国语言"了。
    真机上那串乱码无害：日志只用于诊断，判定一律看退出码。
    """
    if not raw:
        return ""
    candidates = _stop_output_encodings() if encodings is None else encodings
    for encoding in candidates:
        try:
            return raw.decode(encoding)[:_STOP_LOG_CHARS]
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace")[:_STOP_LOG_CHARS]


def _stop_frontend_process() -> None:
    """让启动器按记录安全停止 Vite 进程树。

    **同步等待并留下证据**。原先这里是"用 DETACHED_PROCESS 甩出去、输出丢进 DEVNULL、
    不等待"——结果是点退出后前端照旧活着，而后端日志里连一行线索都没有。两个改动各自
    修掉一半问题：

    - **`CREATE_NO_WINDOW` 而不是 `DETACHED_PROCESS`**：完整的分离进程**没有控制台**，
      而 Windows PowerShell 是控制台宿主程序，很可能在启动阶段就退出、或在第一次查
      `Win32_Process` 时失败。给它一个隐藏的控制台才跑得起来；两者互斥，只能选一个。
    - **捕获输出**：失败时把退出码与脚本文本写进日志，不再静默。

    失败/超时都只记警告——前端没停掉也要让后端正常退出，不能倒过来卡住用户。
    """
    script = _WINDOWS_STOP_SCRIPT if os.name == "nt" else _MACOS_STOP_SCRIPT
    if not script.is_file():
        logger.warning("找不到停止脚本 %s，退出时无法自动停止前端", script)
        return
    creation_flags = 0
    if os.name == "nt":
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0
        )
    try:
        completed = subprocess.run(  # noqa: S603 - 命令与参数都是本仓库内的常量
            _stop_command(),
            cwd=str(_PROJECT_ROOT),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=_STOP_TIMEOUT_SECONDS,
            creationflags=creation_flags,
        )
    except subprocess.TimeoutExpired:
        logger.warning("停止前端超时（%.0f 秒），前端进程可能仍在运行", _STOP_TIMEOUT_SECONDS)
        return
    except Exception:  # noqa: BLE001 - 退出路径绝不能抛：抛了后端就不退了
        logger.exception("启动前端停止器失败")
        return
    output = (_decode_stop_output(completed.stdout) + _decode_stop_output(completed.stderr)).strip()
    if completed.returncode == 0:
        logger.info("已请求停止前端进程：%s", output or "（脚本无输出）")
    else:
        logger.warning(
            "停止前端失败（退出码 %s）：%s", completed.returncode, output or "（脚本无输出）"
        )


def _stop_process() -> None:
    """在独立线程里让 uvicorn 优雅退出。

    优先给自己发 SIGINT（等价于 Ctrl+C，uvicorn 会走完整的关闭流程：等待进行中的
    请求、关闭连接池与数据库）；极端情况下再用 ``os._exit`` 兜底，避免出现"点了退出
    但进程还在"的状态。
    """
    time.sleep(_SHUTDOWN_DELAY_SECONDS)
    try:
        # 停前端放在 try 里面：它自己已经吞了异常，这里是第二道保险——这个线程死在
        # 发信号之前，用户看到的就是"点了退出，进程还在"。
        _stop_frontend_process()
        signal.raise_signal(signal.SIGINT)
        # 给优雅关闭一点时间；仍然活着就强退。
        time.sleep(3.0)
        logger.warning("优雅退出未完成，强制结束进程")
    except Exception:  # noqa: BLE001 - 退出路径本身绝不能抛异常
        logger.exception("退出流程出错，强制结束进程")
    os._exit(0)


@router.post("/shutdown", status_code=202)
def shutdown_application(request: Request):
    """退出后端进程（仅本机可调用）。"""
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="只能在运行后端的本机退出应用")
    logger.info("收到退出请求，正在关闭后端")
    threading.Thread(target=_stop_process, name="resumeforge-shutdown", daemon=True).start()
    return {"status": "stopping", "message": "应用正在退出，可以关闭此页面"}


@router.get("/diagnostics")
def diagnostics():
    """返回脱敏运行事件，方便用户连同截图提交排障。"""
    return diagnostic_snapshot()
