# macOS 桌面安装包构建任务书（给 macOS 上的 agent / 维护者）

> 目标读者：在 macOS（含虚拟机）上执行本任务的 AI agent 或维护者。
> 背景：本仓库的 Windows 桌面安装包（NSIS Setup.exe）已发布；**macOS 桌面壳（.dmg）从未构建过**，本任务完成它的首次构建与验证。

## 〇、日常发版请优先用 CI（无需虚拟机）

发布资产已可由 GitHub Actions 构建（公开仓库的 macOS runner 免费），**日常发版不再需要进入虚拟机**：

1. 按常规流程 bump 版本、push、打 tag，创建 Release 草稿（`gh release create <tag> --draft --notes-file ...`）。
2. 在 GitHub Actions 页面手动运行 **`Release assets (desktop installers)`**：
   - `tag`：目标版本（如 `v1.0.2`，**Release 必须已存在**）；
   - `source_ref`：留空（构建源=该 tag，保证产物与发行严格对应）；
   - `dry_run`：初次可保持 `true` 演练（只产出 workflow artifact，不碰 Release）；
3. 成功后 Release 自动获得：
   - `ResumeForge-Setup-<ver>.exe` + `.sha256`（Windows）
   - `ResumeForge-<ver>-x64.dmg` / `ResumeForge-<ver>-arm64.dmg` + `.sha256`（mac 双架构，Intel 与 Apple Silicon 原生各一份）

  > 说明：dmg 仍出双架构、Intel Mac 可安装并运行应用；但 **Intel Mac 不能使用本地语义检索**（onnxruntime 没有 macOS x86_64 wheel），只能走远程 provider。这与 dmg 构建无关，构建/启动链不做版本闸门。

命令行等价操作：

```bash
gh workflow run release-assets.yml -f tag=v1.0.2 -f dry_run=true   # 演练
gh workflow run release-assets.yml -f tag=v1.0.2 -f dry_run=false  # 正式挂资产
gh run watch
```

跨平台安装升级演练建议使用当前正式版作为源、main 作为脚本版本：

```bash
gh workflow run release-assets.yml -f tag=v2.3.0 -f source_ref=main -f dry_run=true
gh run watch
```

此演练的 Windows 分支会安装官方 v2.3.0，再构建临时 v2.3.1 候选包；macOS/Linux 会分别用官方 v2.2.3 升级到 v2.3.0。演练只生成 Actions artifact，不会修改公开 Release 或 Latest。

### Windows 应用内升级验证

- **发版前**，正式签名并生成 SHA-256 后，GitHub Actions 分别从官方 `v2.3.0` 和最近的较早正式版实装升级。若两者相同，只跑一次。两个不同的旧版在独立的 Windows runner 上测试。只有检查全部通过，工作流才会把 Windows 安装包和校验文件挂到 Release。
- **发布后**，附件齐全后公开草稿并将其设为 Latest。`Windows desktop upgrade` 会通过公开的 GitHub Releases 实际下载并安装，验证原路径重启、后端版本和测试数据保留。可以在 Actions 查看失败步骤和截图。通过工作流的 `GITHUB_TOKEN` 发布时，GitHub 会抑制后续事件触发。此时用下方 `mode=public` 手动启动检查。
- **随时演练**，`mode=rehearsal` 在独立的 GitHub runner 构建临时高版本，用官方 2.3.0 执行同一套实装验证。产物留在测试运行中。

```bash
gh workflow run windows-upgrade.yml -f mode=rehearsal
gh workflow run windows-upgrade.yml -f mode=public
```

### macOS 与 Linux 安装包升级验证

- 发版前，Release 资产工作流会把刚构建的 dmg / AppImage 暂存为 Actions artifact，并下载官方 v2.2.3 和最近正式版作为升级基线。macOS 在 Intel 与 Apple Silicon runner 上分别测试，Linux 在 x64 与 ARM64 runner 上分别测试。
- 每台 runner 都挂载/启动旧安装包，通过桌面 UI 检查版本、后端健康、首页和「软件更新」设置页，写入用户数据标记，再按用户实际的安装方式替换成候选包并重新启动。检查新版本号、前端入口、后端健康和标记保留。任一平台或架构失败，Mac/Linux 安装包和 Windows 安装包都不会被挂到 Release。
- Release 发布后，`desktop-package-upgrade` 会从公开 Releases API 与下载地址再走一遍。这样同时检查附件是否公开、名称和 SHA-256 是否正确、签名或打包文件是否能在原生 runner 上启动。若发布动作由 `GITHUB_TOKEN` 触发而没有启动 `release.published` 工作流，可手动执行：

```bash
gh workflow run desktop-package-upgrade.yml -f mode=public -f platform=all
```

- macOS 的更新是用新 dmg 替换「应用程序」中的旧 App。Linux 的更新是用新 AppImage 替换旧文件。两者当前都不提供应用内下载并安装，CI 验证的是各自现有的手动替换流程。
- AppImage 的 ARM64 文件现在在原生 ARM64 runner 上启动。仅做交叉构建或 ELF 架构检查不算运行验证。

**虚拟机仍然有用的两个场景**：① 真机启动验收（本文第四节）；② 补建早于 mac 构建脚本的历史版本（≤ v1.0.1 的 tag）。新版本优先走 CI。

---

## 一、目标

在 macOS 上从源码构建出：

- `desktop/out/ResumeForge-<version>-<arch>.dmg`（mac 安装包，**未签名**）
- `desktop/out/mac*/ResumeForge.app`（未打包的 .app 目录）
- 同目录下自动生成的 `.dmg.sha256` 校验文件

并进行**启动验证**（应用窗口、后端链路、首启装配）。

## 二、前置条件（先逐条检查，缺什么补什么）

```bash
sw_vers                       # 期望 macOS 14+（Sequoia 15.x 更佳；macOS 13 已不再获得官方支持）
uname -m                      # 期望 x86_64（VMware 虚拟机）；arm64 亦可
df -h /                       # 期望 ≥15GB 空闲
xcode-select -p               # 若无输出：xcode-select --install（弹出安装，约 10-20 分钟）
node -v && npm -v             # 期望 Node ≥20.19；没有则装（官方 pkg 或 nvm）
curl -sI https://registry.npmmirror.com | head -1   # npm 镜像可达
curl -sI https://www.python.org | head -1           # 首次启动装配 Python 需要
```

## 三、步骤（逐条执行，别跳）

```bash
# 1. 克隆（公开仓库，无需凭据）。用 main：包含 mac 构建脚本；版本号以 `desktop/package.json` 为准
git clone https://github.com/magicapple123/ResumeForge.git
cd ResumeForge
git log --oneline -1            # 记录 commit，写入汇报

# 2. 前端：安装依赖 + 构建生产资产（产出 frontend/dist；version.json 必须与 desktop/package.json 一致）
cd frontend
pnpm install --frozen-lockfile
pnpm run build
cd ..

# 3. 桌面壳依赖（含 Electron 二进制；镜像避免国内下载卡住）
cd desktop
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install
cd ..

# 4. 一键构建（脚本会：组装 payload → electron-builder --mac → 写 sha256）
bash scripts/build-desktop-mac.sh
```

**预期耗时**：npm 安装 5–15 分钟（VM 较慢），构建 3–10 分钟。**全程无需 sudo**。

## 四、验证清单（构建产物必须逐项确认）

```bash
# 1. 产物存在
ls -lh desktop/out/ | grep -E "dmg|mac"
cat desktop/out/*.dmg.sha256

# 2. 挂载检查（dmg → /Volumes/ResumeForge*）
hdiutil attach desktop/out/ResumeForge-*.dmg
APP="/Volumes/ResumeForge"/ResumeForge.app     # 目录名以实际为准（可能带空格）
ls "$APP/Contents/Resources/payload"           # 期望：backend branding frontend runtime scripts start.command 等
ls "$APP/Contents/Resources/payload/frontend/dist/index.html"   # 必须存在
ls "$APP/Contents/Resources/payload/backend/app/main.py"        # 必须存在
ls "$APP/Contents/Resources/payload/python-runtime.zip" 2>/dev/null  # 期望【不存在】（mac 版按设计不带运行时）
```

**启动验证**（把 app 拷到 /Applications 或以副本方式打开，别在只读的 dmg 卷内启动）：

```bash
cp -R "$APP" /Applications/
open /Applications/ResumeForge.app
```

判据（按顺序）：

1. **窗口出现**（标题含「简历通」）——若长时间白屏或立即退出：先看日志（见下），并尝试
   `open -a /Applications/ResumeForge.app --args --disable-gpu`（虚拟机 Metal 加速不完整时的已知规避）。
2. **后端链路**：首次启动会经由 `start.command` **在线装配 Python 运行时**（下载 Python + pip 安装依赖，VM 网络下可能 3–10 分钟），耐心等待并观察日志；后端就绪后页面应可正常打开与操作（如首页统计、岗位列表）。
3. 日志位置（排查用）：
   - 壳与后端运行日志：**用户目录**下的 `runtime/logs/desktop-main.log`、`desktop-backend.log`，macOS 即
     `~/Library/Application Support/ResumeForge/runtime/logs/`；不可写时会降级到系统临时目录（`$TMPDIR/ResumeForge/logs`），
     极端情况两个都写不了就没有这个文件（壳不写日志也不崩）。
     **不要看** `.app/Contents/Resources/payload/runtime/logs/`：那是 `scripts/build-desktop-mac.sh` 用 `mkdir -p` 建出来的空壳，壳层永远不往里写（payload 只读）。
   - 用户数据与后端日志：`~/Library/Application Support/ResumeForge/data/`，后端自己那份是 `data/logs/backend.log`（5MB×5 自带滚动，与上面的壳日志不是同一个文件）
   - 诊断包：后端起得来时，`GET /api/system/diagnostics/export` 会按原名带走 `desktop-main.log` / `desktop-backend.log`
     （只取尾部 400 行 / 256KB，过同一道脱敏闸，不带走 `.log.1` 轮转；只有由桌面壳拉起的后端才注入 `RF_DESKTOP_LOG_DIR`）。
     包里没有桌面日志，只说明这台机器上的后端不是由桌面壳拉起的、或该文件还没被写过、或读不到（权限/占用）——不代表诊断包坏了。
     后端起不来时该端点本身不可达，只能走上面的手动路径。
4. 完成后退出应用（托盘/菜单退出），并卸载 dmg：`hdiutil detach /Volumes/ResumeForge`

> ⚠️ 常见误判：「打不开」先分清是 Gatekeeper 拦截（弹窗提示"无法验证开发者"→ 右键→打开 即可）还是真崩溃（进程退出/白屏 + 日志报错）。

## 五、已知坑（按优先级）

| # | 现象 | 处理 |
|---|---|---|
| 1 | `xcode-select: error` / 缺头文件 | `xcode-select --install` 装 CLT（不装完整 Xcode） |
| 2 | `pnpm install` 卡在 electron 下载 | 必须带 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |
| 3 | 构建报错 `/bin/bash: ... Build-Desktop.ps1: ...` | **不要用 PowerShell 脚本**（`scripts/Build-Desktop.ps1` 是 Windows 专用）；mac 用 `scripts/build-desktop-mac.sh` |
| 4 | 首次启动白屏/闪退 | 先看 `desktop-main.log`；VM 可试 `--disable-gpu`；再查首启装配是否还在进行 |
| 5 | App 双击无反应/提示"无法验证开发者" | 未签名所致：右键→打开；或 `xattr -dr com.apple.quarantine /Applications/ResumeForge.app` |
| 6 | 首启装配失败（下载/python.org 不可达） | 检查网络；重试一次；仍失败则记录报错原文 |
| 7 | 磁盘不足 | 至少预留 15GB（node_modules + electron + dmg 产物） |
| 8 | 打包结果里版本号不对 | 版本号以 `desktop/package.json` 为准，`frontend/dist/version.json` 必须与它一致（不一致脚本会拦截；不要按某个写死的数字核对） |

## 六、交付物与汇报格式

产物需回传给 Windows 主机（共享文件夹 / 网盘 / 直接拖拽），**不要**在虚拟机内配置 GitHub 凭据（发布由主机侧完成）。

汇报（把下面模板填好发回）：

```
## macOS 桌面包构建结果
- 仓库：main @ <git commit>
- 环境：macOS <版本> / <arch> / Node <版本>
- 产物：ResumeForge-<ver>-<arch>.dmg（<大小>，sha256 <hash>）
- 验证：dmg 挂载 ✓｜窗口启动 ✓｜后端就绪 ✓｜首启装配耗时 <分钟>
- 未通过项与原因：（如有）
- 遇到并解决的问题：（如有）
```

## 七、边界（不要做）

- 只操作克隆下来的仓库目录与系统正常缓存，**不要动系统其他文件**；
- 除 Xcode CLT / Node 外不要安装全局工具；遇到必须 `sudo` 的操作先停下并汇报；
- 不要在虚拟机里配置或保存任何 GitHub token / API key；
- 不要执行 `git push`、不要打 tag、不要发布 Release（发布由主机侧统一执行）。
