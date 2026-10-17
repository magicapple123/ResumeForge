# macOS 桌面安装包构建任务书（给 macOS 上的 agent / 维护者）

> 目标读者：在 macOS（含虚拟机）上执行本任务的 AI agent 或维护者。
> 背景：本仓库的 Windows 桌面安装包（NSIS Setup.exe）已发布；**macOS 桌面壳（.dmg）从未构建过**，本任务完成它的首次构建与验证。

## 〇、日常发版请优先用 CI（无需虚拟机）

发布资产已可由 GitHub Actions 构建（公开仓库的 macOS runner 免费），**日常发版不再需要进入虚拟机**：

1. 按常规流程 bump 版本、push、打 tag、创建 Release（`gh release create <tag> --notes-file ...`）；
2. 在 GitHub Actions 页面手动运行 **`Release assets (desktop installers)`**：
   - `tag`：目标版本（如 `v1.0.2`，**Release 必须已存在**）；
   - `source_ref`：留空（构建源=该 tag，保证产物与发行严格对应）；
   - `dry_run`：初次可保持 `true` 演练（只产出 workflow artifact，不碰 Release）；
3. 成功后 Release 自动获得：
   - `ResumeForge-Setup-<ver>.exe` + `.sha256`（Windows）
   - `ResumeForge-<ver>-x64.dmg` / `ResumeForge-<ver>-arm64.dmg` + `.sha256`（mac 双架构，Intel 与 Apple Silicon 原生各一份）

命令行等价操作：

```bash
gh workflow run release-assets.yml -f tag=v1.0.2 -f dry_run=true   # 演练
gh workflow run release-assets.yml -f tag=v1.0.2 -f dry_run=false  # 正式挂资产
gh run watch
```

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
sw_vers                       # 期望 macOS 13+（Sequoia 15.x 更佳）
uname -m                      # 期望 x86_64（VMware 虚拟机）；arm64 亦可
df -h /                       # 期望 ≥15GB 空闲
xcode-select -p               # 若无输出：xcode-select --install（弹出安装，约 10-20 分钟）
node -v && npm -v             # 期望 Node ≥20.19；没有则装（官方 pkg 或 nvm）
curl -sI https://registry.npmmirror.com | head -1   # npm 镜像可达
curl -sI https://www.python.org | head -1           # 首次启动装配 Python 需要
```

## 三、步骤（逐条执行，别跳）

```bash
# 1. 克隆（公开仓库，无需凭据）。用 main：包含 mac 构建脚本与 1.0.1 版本号
git clone https://github.com/magicapple123/ResumeForge.git
cd ResumeForge
git log --oneline -1            # 记录 commit，写入汇报

# 2. 前端：安装依赖 + 构建生产资产（产出 frontend/dist，版本号应等于 1.0.1）
cd frontend
npm ci --no-audit --no-fund
npm run build
cd ..

# 3. 桌面壳依赖（含 Electron 二进制；镜像避免国内下载卡住）
cd desktop
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install --no-audit --no-fund
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
   - 壳与后端运行日志：`/Applications/ResumeForge.app/Contents/Resources/payload/runtime/logs/desktop-main.log`、`desktop-backend.log`
   - 用户数据与后端日志：`~/Library/Application Support/ResumeForge/`（含 `data/logs/backend.log`）
   - 启动探针：`~/Library/Application Support/ResumeForge/ResumeForge/startup-probe.log`（若存在）
4. 完成后退出应用（托盘/菜单退出），并卸载 dmg：`hdiutil detach /Volumes/ResumeForge`

> ⚠️ 常见误判：「打不开」先分清是 Gatekeeper 拦截（弹窗提示"无法验证开发者"→ 右键→打开 即可）还是真崩溃（进程退出/白屏 + 日志报错）。

## 五、已知坑（按优先级）

| # | 现象 | 处理 |
|---|---|---|
| 1 | `xcode-select: error` / 缺头文件 | `xcode-select --install` 装 CLT（不装完整 Xcode） |
| 2 | `npm install` 卡在 electron 下载 | 必须带 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |
| 3 | 构建报错 `/bin/bash: ... Build-Desktop.ps1: ...` | **不要用 PowerShell 脚本**（`scripts/Build-Desktop.ps1` 是 Windows 专用）；mac 用 `scripts/build-desktop-mac.sh` |
| 4 | 首次启动白屏/闪退 | 先看 `desktop-main.log`；VM 可试 `--disable-gpu`；再查首启装配是否还在进行 |
| 5 | App 双击无反应/提示"无法验证开发者" | 未签名所致：右键→打开；或 `xattr -dr com.apple.quarantine /Applications/ResumeForge.app` |
| 6 | 首启装配失败（下载/python.org 不可达） | 检查网络；重试一次；仍失败则记录报错原文 |
| 7 | 磁盘不足 | 至少预留 15GB（node_modules + electron + dmg 产物） |
| 8 | 打包结果里版本号不对 | 确认 `frontend/dist/version.json` 与 `desktop/package.json` 都是 1.0.1（脚本会拦截不一致） |

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
