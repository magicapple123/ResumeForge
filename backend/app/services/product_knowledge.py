# SPDX-License-Identifier: Apache-2.0
"""产品启动 / 升级 / 平台支持的事实快照 —— 助手平台知识的单一来源。

这里的每条文本都是**事实快照**，注释注明出处（脚本名 / 文档节）。改动启动链或
升级链脚本（``start.cmd``、``start.command``、``update.cmd``、``update.command``、
``scripts/Start-ResumeForge.ps1``、``scripts/macos/start.sh``、``scripts/macos/update.sh``）
或 README「快速开始」「更新而不丢失数据」段、``docs/upgrading.md`` 时，**必须同步
更新这里的对应条目**；``backend/tests/test_product_knowledge.py`` 会把条目与实际
脚本和 README 对拍，漂移会变红。改脚本时先改这里，再跑那份测试。
"""

# 一键启动器的默认后端端口。出处：scripts/Start-ResumeForge.ps1（`[int]$BackendPort = 8005`）
# 与 scripts/macos/start.sh（`RF_BACKEND_PORT=8005`），两个平台刻意一致。
DEFAULT_BACKEND_PORT = 8005
# 前端 5173 只在显式 dev 模式（--frontend-mode dev）下由 Vite 使用；
# 发布包自带 frontend/dist、由后端同源提供页面（backend/app/static_spa.py）。
DEV_ONLY_FRONTEND_PORT = 5173

# 平台启动 / 升级事实段：由 app/api/assistant.py 拼进助手系统提示。
# 口径对齐 frontend/src/components/userGuideSteps.ts（「开始与停止」「检查更新」两条）、
# README「快速开始」与 docs/upgrading.md；Linux 从未做过兼容验证，如实说明。
PLATFORM_NOTE = """【启动与升级（平台事实）】
- Windows：在项目根目录双击 `start.cmd` 启动、`stop.cmd` 停止、`update.cmd` 更新，都是零依赖一键脚本，首次启动会自动准备环境。
- macOS：双击 `start.command` 启动、`stop.command` 停止、`update.command` 更新；首次打开若被系统拦截，在 Finder 里右键点它 → 打开（只需一次）。
- 一键启动的页面地址默认是 http://127.0.0.1:8005（后端端口 8005）。发布包自带 frontend/dist，由后端同源提供页面，运行期不需要 Node；5173 只是显式 dev 模式（--frontend-mode dev）下 Vite 的端口，不要把"手动 npm run dev"当作用户的启动方式。
- 检查更新：页头「使用指南」旁的刷新图标，或设置 → 应用 → 软件更新。应用内覆盖安装目前只支持 Windows；macOS 用 `update.command`（同样是下载新包 → 只覆盖程序文件），Linux 按升级文档手动操作。
- Linux：没有一键启动 / 更新脚本，也未经过兼容验证。被问到时如实说明"未官方支持"，可以介绍 docs/upgrading.md 的手动流程（自建 .venv 启动后端、npm 启动前端），但不要承诺一键体验或应用内覆盖安装。"""


def build_platform_note() -> str:
    """返回拼进助手系统提示的平台知识段（当前是静态事实快照）。

    单独包一层函数而不是让调用方直接读常量：将来若要按运行时状态（如检测到
    frontend/dist 是否存在）微调文案，只需改这里，assistant.py 与测试都不用动。
    """
    return PLATFORM_NOTE
