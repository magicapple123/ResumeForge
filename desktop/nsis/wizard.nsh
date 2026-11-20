# ============================================================================
# 安装 / 卸载向导（WF-07 品牌化 + 页序，WF-08 功能增强 8 项）
#
# 本文件由 legacy-data-rescue.nsh 在文件末尾 include（electron-builder 的
# nsis.include 只接受一个路径，两者必须编进同一个脚本）。三个约定：
#   * 本文件**不定义** customHeader / customInit / customInstall —— 那三个宏
#     已被 legacy-data-rescue.nsh 占用；这里只提供函数与页面宏，由那边在宏体
#     末尾用 `!insertmacro RF_*` 插入调用。
#   * 文案用 RF_STR 一次铺满 26 个 LCID（漏一个该语言下就是空串），并且只能
#     在 addLangs 之后展开的宏里定义 —— 所以 RF_WIZARD_LANGS 由 customHeader
#     的末尾插入（那是整个脚本里唯一保证在 addLangs 之后的钩子）。
#   * 静默路径（自动更新用的 /S）不经过任何页面：默认值全部在 customInit /
#     customUnInit 里先落好，页面只负责"用户改了才覆盖"。
# ============================================================================

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

# 可执行文件名怎么拼，取决于这段代码**在哪里编译**（2026-11-2x 两次踩坑的结论）：
#
#   * **header 里就地编译的 Function**：只能用 `${PRODUCT_FILENAME}.exe`。
#     `APP_EXECUTABLE_FILENAME` 由 common.nsh 定义，而本文件被 electron-builder 放在
#     生成脚本最顶部（早于 common.nsh）；Function 是就地编译的，此刻那个常量还不存在
#     → warning 6000 "unknown variable/constant ..."，而打包用 -WX（警告即错误）。
#     `${PRODUCT_FILENAME}` 是命令行 -D，任何位置都可用（同理还有 `${APP_FILENAME}`、
#     `${APP_GUID}`）。
#   * **宏体（`!macro` 里的指令）**：可以用 `APP_EXECUTABLE_FILENAME`。宏是在**插入点**
#     展开的，而 `customCheckAppRunning` 的插入点在模板正文（common.nsh 之后），那时
#     常量已经定义好 —— 所以那个宏里写 `tasklist /FI "IMAGENAME eq
#     ${APP_EXECUTABLE_FILENAME}"` 是合法的，不是漏改。
#
# 口诀：**就地编译看谁先，宏看插入点。** 拿不准就写 `${PRODUCT_FILENAME}.exe`：
# 它在两种情形下都对。

# 安装盘与系统盘的最低剩余空间（MB）。当前包体解压后约 360 MB，留 ~3 倍余量：
# 首启还要把运行时解压到 %LOCALAPPDATA%，300 MB 边缘的机器装上也跑不起来。
!define RF_MIN_FREE_MB 1200

# 应用数据 / 运行时的固定位置（ADR-0004），安装器只读不写，卸载器按用户选择删。
!define RF_DATA_DIR "$APPDATA\ResumeForge\data"
!define RF_RUNTIME_DIR "$LOCALAPPDATA\ResumeForge\runtime"

# 用户选定（或沿用注册表里）的安装目录写不进去时改用的位置。
# 与 electron-builder 的 per-user 默认值一致（multiUser.nsh 的
# `$LocalAppData\Programs\${APP_FILENAME}`），所以降级后的产物和一次"常规安装"
# 完全等价：注册表、快捷方式、自动更新都按这个目录走。
!define RF_FALLBACK_INSTDIR "$LOCALAPPDATA\Programs\ResumeForge"

# per-machine 安装的降级目标（Low 1）。**不能**和上面那条混用：`$installMode` 是
# "注册表写 HKLM 还是 HKCU、快捷方式放 Common 桌面还是用户桌面"的总开关，降级时
# 只换目录不改它 —— 于是 per-machine 的安装一旦降到 `$LOCALAPPDATA`，就会出现
# "文件在单用户目录里、注册表在 HKLM、快捷方式在 Common 桌面"的三处错位。
# 所以这一档只在相同的用户上下文里换一个可写子目录（同样带 APP_FILENAME，
# 因此 instFilesPre 不会再追加一层）。
#
# ⚠️ 为什么是 `$PROGRAMFILES` 而不是模板用的 `$PROGRAMFILES64`：模板 multiUser.nsh
# （79-84 行）在 `!ifdef APP_64` + `${RunningX64}` 时选后者，那是**默认安装目录**的
# 算法；这里是**兜底目录**，两者不必同源。兜底只在"用户选的目录写不进去"时启用，
# 需要的是"在任何 x86/x64 Windows 上都存在且不是用户目录"，`$PROGRAMFILES` 两个架构
# 下都有（x86 系统上 `$PROGRAMFILES64` 是空的，反而会把降级目标拼成 `\ResumeForge`，
# 落在当前盘根）。另外 `${RunningX64}` 由 x64.nsh 提供，本文件里就地编译的 Function
# 引用它很可能又撞 warning 6000 → -WX（见文件顶部那条注释）。
# 代价：64 位机器上这一档会落到 `Program Files (x86)`，与"常规 per-machine 安装"不
# 同目录 —— 可接受：`perMachine: false`（electron-builder.yml:170），这档今天走不到，
# 真要走也只发生在"用户选的目录不可写"的机器上，能装进去比装进哪个 Program Files 重要。
!define RF_FALLBACK_INSTDIR_MACHINE "$PROGRAMFILES\${APP_FILENAME}"

# 写探针的临时文件名（见 rfProbeWritable）。放在 $INSTDIR 里而不是 $TEMP：
# 要验证的正是"程序文件能不能写进这个目录"，这才是 2026-11-2x 那次
# `不能打开要写入的文件：…\uninstallerIcon.ico` 失败的本质。
!define RF_PROBE_FILE ".rf-write-probe"

# ----------------------------------------------------------------------------
# 两个注册表键路径：与模板 `multiUser.nsh` 的 `!define /ifndef` **逐字一致**。
#
# 为什么我们自己也要定义一遍：`${INSTALL_REGISTRY_KEY}` / `${UNINSTALL_REGISTRY_KEY}`
# 由 multiUser.nsh 定义，而它在模板 body 里、晚于我们整个 include。**Function 是就地
# 编译的**，在我们的函数里直接用这两个常量会 `warning 6000` → `-WX` 打包失败
# （2026-11-2x 已在 `${UNINSTALL_FILENAME}` 上踩过一次）。抢占式卸旧现在要在
# `rfPrecheck`（交互路径，header 里编译的函数）里也调用，所以常量必须在这里就可见。
#
# `!ifndef` 不会和模板撞车：multiUser.nsh 用的也是 `!define /ifndef`，谁先定义用谁，
# 而两边表达式逐字相同，语义不变。`${APP_GUID}` / `${UNINSTALL_APP_KEY}` 由
# electron-builder 以 `-D` 传入（NsisTarget.js 的 defines），任何位置都可用。
# 漂移由 `scripts/test-nsis-install-hardening.js` 与 multiUser.nsh 逐字比对拦下。
# ----------------------------------------------------------------------------
!ifndef INSTALL_REGISTRY_KEY
  !define INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!endif
!ifndef UNINSTALL_REGISTRY_KEY
  !define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
!endif

# 使用指南地址（应用内「帮助 → 使用指南」是同一份文档）。
!define RF_GUIDE_URL "https://github.com/magicapple123/ResumeForge/blob/main/docs/user-guide.md"

# 两趟都要用到的变量才留在全局段：日志句柄（安装器与卸载器都写同一份日志）
# 与 nsDialogs 的页面句柄。
#
# ⚠️ 其余的变量按**编译趟次**分别声明在各自的守卫里。原因：makensis 对"只声明不用"
# 的全局变量报 warning 6001，而 electron-builder 以 -WX 编译（警告即错误）。声明放在
# 守卫外时，另一趟就会报它，且**每轮只报第一个**——一轮一条，代价是每次 70 秒的打包。
Var /GLOBAL RFLogFile
Var /GLOBAL RFPage
# 静默/交互：日志与"要不要弹框"都读它，`${Silent}` 在宏里展开会变成多处跳转，
# 落到一个变量上更好追踪（每次 RF_LOG_OPEN 都会重算）。
Var /GLOBAL RFSilent

# ----------------------------------------------------------------------------
# 文案：RF_STR 一次铺 26 个 LCID（默认英文，简繁中文单独给）
# ----------------------------------------------------------------------------
!macro RF_STR NAME ZH EN
  LangString ${NAME} 1033 "${EN}"
  LangString ${NAME} 1031 "${EN}"
  LangString ${NAME} 1036 "${EN}"
  LangString ${NAME} 3082 "${EN}"
  LangString ${NAME} 2052 "${ZH}"
  LangString ${NAME} 1028 "${ZH}"
  LangString ${NAME} 1041 "${EN}"
  LangString ${NAME} 1042 "${EN}"
  LangString ${NAME} 1040 "${EN}"
  LangString ${NAME} 1043 "${EN}"
  LangString ${NAME} 1030 "${EN}"
  LangString ${NAME} 1053 "${EN}"
  LangString ${NAME} 1044 "${EN}"
  LangString ${NAME} 1035 "${EN}"
  LangString ${NAME} 1049 "${EN}"
  LangString ${NAME} 2070 "${EN}"
  LangString ${NAME} 1046 "${EN}"
  LangString ${NAME} 1045 "${EN}"
  LangString ${NAME} 1058 "${EN}"
  LangString ${NAME} 1029 "${EN}"
  LangString ${NAME} 1051 "${EN}"
  LangString ${NAME} 1038 "${EN}"
  LangString ${NAME} 1025 "${EN}"
  LangString ${NAME} 1055 "${EN}"
  LangString ${NAME} 1054 "${EN}"
  LangString ${NAME} 1066 "${EN}"
!macroend

!macro RF_WIZARD_LANGS
  !insertmacro RF_STR RF_WELCOME_TITLE \
    "安装简历通" \
    "Install ResumeForge"
  !insertmacro RF_STR RF_WELCOME_TEXT \
    "简历通是一个本地简历工作台：简历、附件与导出都留在你自己的电脑上。$\r$\n$\r$\n本向导安装桌面应用；首次启动时会自动准备运行环境（约一分钟）。" \
    "ResumeForge is a local resume workbench: resumes, attachments and exports stay on this computer.$\r$\n$\r$\nThis wizard installs the desktop app; its runtime is prepared on first launch (about a minute)."
  !insertmacro RF_STR RF_UPGRADE_PREFIX \
    "检测到已安装 " \
    "Detected an existing installation: "
  !insertmacro RF_STR RF_UPGRADE_SUFFIX \
    "，将升级现有安装，你的数据不动。" \
    ". This run upgrades it; your data stays untouched."
  !insertmacro RF_STR RF_REPAIR_NOTE \
    "安装目录里缺少程序文件（上次安装可能被中断）。本次只补齐程序文件，不改动数据与快捷方式。" \
    "Program files are missing from the install directory (an earlier install was probably interrupted). This run only restores them; data and shortcuts are left alone."
  !insertmacro RF_STR RF_MODE_TITLE \
    "安装模式" \
    "Installation mode"
  !insertmacro RF_STR RF_MODE_TEXT \
    "沿用当前安装方式，不会产生第二份安装。" \
    "The existing installation mode is kept, so no second copy is created."
  !insertmacro RF_STR RF_MODE_USER \
    "方式：仅为我安装（无需管理员权限）" \
    "Mode: for me only (no administrator rights needed)"
  !insertmacro RF_STR RF_MODE_ALL \
    "方式：为所有用户安装" \
    "Mode: for all users"
  !insertmacro RF_STR RF_TASKS_TITLE \
    "附加任务" \
    "Additional tasks"
  !insertmacro RF_STR RF_TASKS_HINT \
    "选择要创建的快捷方式。开机自启之后可以在应用的「设置 → 外观与语言」里随时调整。" \
    "Choose the shortcuts to create. Auto-start can be changed later in the app settings."
  !insertmacro RF_STR RF_TASK_DESKTOP \
    "创建桌面快捷方式" \
    "Create a desktop shortcut"
  !insertmacro RF_STR RF_TASK_STARTMENU \
    "创建开始菜单快捷方式" \
    "Create a Start menu shortcut"
  !insertmacro RF_STR RF_TASK_AUTOSTART \
    "开机时自动启动（可选）" \
    "Start with Windows (optional)"
  !insertmacro RF_STR RF_TASK_AUTOSTART_HINT \
    "只写入当前用户的启动项，卸载时自动删除。" \
    "Adds a per-user startup entry; the uninstaller removes it."
  !insertmacro RF_STR RF_PRECHECK_PATH_TITLE \
    "无法安装到这个位置" \
    "Cannot install to this location"
  !insertmacro RF_STR RF_PRECHECK_REMOTE \
    "安装位置在可移动盘或网络盘上。请改选本机硬盘上的目录。" \
    "The install location is on a removable or network drive. Choose a folder on a local disk."
  !insertmacro RF_STR RF_PRECHECK_CLOUD \
    "安装位置在 OneDrive / Dropbox / 坚果云 / 百度网盘的同步目录里。同步进程会在升级时锁住文件，请改选本机目录。" \
    "The install location is inside a OneDrive / Dropbox / Nutstore / BaiduNetdisk folder. Sync clients lock files during upgrades; choose a local folder instead."
  !insertmacro RF_STR RF_PRECHECK_SPACE \
    "磁盘剩余空间不足：至少需要 1200 MB 可用空间。请清理磁盘或改选其它目录。" \
    "Not enough free disk space: at least 1200 MB is required. Free some space or choose another folder."
  !insertmacro RF_STR RF_LOG_HINT \
    "安装日志：" \
    "Setup log: "
  !insertmacro RF_STR RF_LOG_ASK \
    "是否现在打开日志？" \
    "Open the log now?"
  !insertmacro RF_STR RF_FINISH_TITLE \
    "安装完成" \
    "Installation complete"
  !insertmacro RF_STR RF_FINISH_TEXT \
    "程序文件已就位。你的数据在 %APPDATA%\ResumeForge\data，升级与卸载都不会动它。" \
    "Program files are in place. Your data lives in %APPDATA%\ResumeForge\data and is never touched by upgrades or uninstall."
  !insertmacro RF_STR RF_FINISH_RUN \
    "立即启动简历通" \
    "Run ResumeForge now"
  !insertmacro RF_STR RF_FINISH_GUIDE \
    "查看使用指南" \
    "Open the user guide"
  !insertmacro RF_STR RF_UNWELCOME_TITLE \
    "卸载简历通" \
    "Uninstall ResumeForge"
  !insertmacro RF_STR RF_UNWELCOME_TEXT \
    "将删除程序文件与快捷方式。$\r$\n$\r$\n你的数据不会被动：简历、附件与备份保留在 %APPDATA%\ResumeForge\data。继续前请先从托盘菜单退出简历通。" \
    "This removes the program files and shortcuts.$\r$\n$\r$\nYour data is NOT removed: resumes, attachments and backups stay in %APPDATA%\ResumeForge\data. Quit ResumeForge from its tray menu before continuing."
  !insertmacro RF_STR RF_UNDATA_TITLE \
    "卸载选项" \
    "Uninstall options"
  !insertmacro RF_STR RF_UNDATA_HINT \
    "默认保留数据，重新安装后可以接着用。" \
    "Data is kept by default; a reinstall picks it up again."
  !insertmacro RF_STR RF_UNDATA_BACKUP \
    "卸载前把数据备份到「文档」" \
    "Back up my data to Documents before uninstalling"
  !insertmacro RF_STR RF_UNDATA_DELETE \
    "同时删除我的全部数据" \
    "Also delete all of my data"
  !insertmacro RF_STR RF_UNDATA_DELETE_HINT \
    "包括简历、附件、备份与运行环境；删除后无法恢复。" \
    "Includes resumes, attachments, backups and the runtime. This cannot be undone."
  !insertmacro RF_STR RF_UNDATA_OPEN \
    "打开数据目录" \
    "Open data folder"
  !insertmacro RF_STR RF_CONFIRM_TITLE \
    "确认删除数据" \
    "Confirm data deletion"
  !insertmacro RF_STR RF_RESIDUE_TITLE \
    "清理结果" \
    "Cleanup result"
  !insertmacro RF_STR RF_RESIDUE_NONE \
    "已删除" \
    "removed"
  !insertmacro RF_STR RF_RESIDUE_OPEN \
    "打开" \
    "Open"
  !insertmacro RF_STR RF_UNFINISH_TEXT \
    "简历通已卸载。数据仍在 %APPDATA%\ResumeForge\data，随时可以重新安装。" \
    "ResumeForge has been uninstalled. Your data is still in %APPDATA%\ResumeForge\data; you can reinstall at any time."
  !insertmacro RF_STR RF_RETRY_TITLE \
    "有文件未能删除" \
    "Some files could not be removed"
  !insertmacro RF_STR RF_RETRY_TEXT \
    "常见原因是程序仍在运行，或文件被其它程序占用。请关闭简历通（托盘 → 退出）后重试。" \
    "A file is usually still open by ResumeForge or another program. Quit ResumeForge (tray -> Quit), then try again."
  !insertmacro RF_STR RF_BACKUP_OK \
    "数据已备份到：" \
    "Data was backed up to: "
  !insertmacro RF_STR RF_BACKUP_FAILED \
    "数据备份未完成，已取消删除；你的数据保持原样。日志：" \
    "The data backup did not finish, so deletion was cancelled and your data is untouched. Log: "
  # ---------------------------------------------------------------------------
  # 安装器自报的失败文案（RF_ERR_*，2026-11-2x）。
  #
  # **不要复用 `$(appCannotBeClosed)`**：那句是 electron-builder 模板的文案，含义是
  # "应用关不掉，卸载失败"，而我们真正遇到的三类失败（目录写不进去 / 程序文件没复制
  # 完整 / 装完自检没过）都不是那个原因。真机上就是因为文案指错了方向，
  # 排查跑了一整轮（用户去 tasklist 里找 ResumeForge.exe，而那个进程根本不存在）。
  #
  # 路径一律**运行期拼接**（LangString 里的 $变量不会被展开）：所以每一条都写成
  # "……："结束的半句，调用处再补 $INSTDIR / 缺失文件名 / 日志路径。
  # ---------------------------------------------------------------------------
  !insertmacro RF_STR RF_ERR_DIR_UNWRITABLE \
    "这个安装位置写不进去（权限受限或目录只读）。已改用默认位置继续安装，原目录里的旧文件不会被改动：$\r$\n" \
    "This install folder is not writable (restricted permissions or read-only). Setup continues in the default location; files in the original folder are left untouched:$\r$\n"
  !insertmacro RF_STR RF_ERR_NO_WRITABLE_DIR \
    "默认位置也写不进去，安装无法继续。程序文件一个都没有写入，旧版本保持原样。$\r$\n$\r$\n可以改用免安装的 zip 版：把发布页的 win-unpacked 解压到任意你有写权限的目录，直接运行 ResumeForge.exe。$\r$\n" \
    "The default location is not writable either, so setup cannot continue. No files were written and your previous install is untouched.$\r$\n$\r$\nYou can use the portable zip instead: unzip win-unpacked from the release page into any folder you can write to and run ResumeForge.exe directly.$\r$\n"
  !insertmacro RF_STR RF_ERR_COPY_FAILED \
    "程序文件没有完整写入安装目录（复制阶段失败）。这次安装不完整，请重新运行安装程序；连续失败可以改用免安装的 zip 版。$\r$\n" \
    "The program files were not fully copied into the install folder. This install is incomplete - run setup again; if it keeps failing, use the portable zip instead.$\r$\n"
  !insertmacro RF_STR RF_ERR_SELFCHECK \
    "安装自检没通过：安装目录里缺少程序文件。缺失项：$\r$\n" \
    "The post-install check failed: program files are missing from the install folder. Missing:$\r$\n"
  !insertmacro RF_STR RF_ERR_APP_RUNNING \
    "简历通仍在运行，装下去会覆盖正在使用的文件。$\r$\n$\r$\n请从托盘菜单退出后重试（数据不会丢）。" \
    "ResumeForge is still running and would be overwritten while in use.$\r$\n$\r$\nQuit it from the tray menu, then try again (your data is safe)."
  # 桥（RF_PREEMPTIVE_UNINSTALL）在**动旧版本之前**的那一问。与上面那条的区别：
  # 这条是"重试 / 跳过这一步"，选跳过安装会继续（Medium 2）；上面那条是"整台安装
  # 停在这里"。
  !insertmacro RF_STR RF_BRIDGE_APP_RUNNING \
    "旧版本还在运行，没法先把它卸载。$\r$\n$\r$\n请从托盘菜单退出简历通，再点「重试」。点「取消」会跳过这一步，安装照常继续，旧版本之后由安装程序自己处理。" \
    "The previous version is still running, so it cannot be removed first.$\r$\n$\r$\nQuit ResumeForge from the tray menu, then choose Retry. Choose Cancel to skip this step: setup continues and handles the old version itself."
  # 进度页取消（Medium 3 残余）。两档文案只差"旧版本还在不在"：
  # 桥已经把旧版本卸掉之后取消，用户手里就只剩"重新跑一遍安装程序"这一条路，
  # 必须直说；旧版本没动过时则强调"重装即可修复，什么都没丢"。
  !insertmacro RF_STR RF_ABORT_AFTER_UNINSTALL \
    "安装还没完成。$\r$\n$\r$\n旧版本已经被移除了，中断之后需要重新运行安装程序才能继续使用简历通。已经复制到一半的程序文件会留在安装目录里，重新安装会覆盖它们。$\r$\n$\r$\n确定要中断安装吗？" \
    "Setup is not finished.$\r$\n$\r$\nThe previous version has already been removed, so if you stop now you must run the installer again before ResumeForge can be used. Half-copied program files stay in the install folder; running setup again overwrites them.$\r$\n$\r$\nStop the installation?"
  !insertmacro RF_STR RF_ABORT_PLAIN \
    "安装还没完成。$\r$\n$\r$\n现在中断会留下不完整的程序文件；重新运行安装程序即可修复，旧版本与你的数据都不受影响。$\r$\n$\r$\n确定要中断安装吗？" \
    "Setup is not finished.$\r$\n$\r$\nStopping now leaves an incomplete set of program files; running setup again repairs it. The previous version and your data are untouched.$\r$\n$\r$\nStop the installation?"

  # ---------------------------------------------------------------------------
  # 非 0 退出码一览（静默路径不弹框，改成"写日志 + 退出码"，所以这些数字就是
  # 静默安装唯一的对外信号，读日志时按这张表对原因）：
  #   3 = 应用还在运行（customCheckAppRunning：静默且非 --updated）
  #   4 = 应用 60 秒内没退出（RF_WaitForAppExit 超时，静默路径）
  #   5 = 两个候选安装目录都不可写
  #   6 = 装完自检不通过 / 程序文件没复制完整
  #   7 = 卸载后仍留下别人的文件
  #   8 = 旧版数据抢救失败（复制到临时目录校验不过，静默路径）
  #   9 = 旧版数据没能放回应用的数据位置（静默路径）
  # ---------------------------------------------------------------------------
!macroend

# ----------------------------------------------------------------------------
# 安装日志（WF-08 #3）：FileOpen/FileWrite。不用 LogSet——那要求特殊编译的 NSIS。
# 失败不阻断安装（日志本身丢一行不影响用户拿到能用的程序）。
# ----------------------------------------------------------------------------
!macro RF_LOG MSG
  # 分支标签一律交给 LogicLib：`${__LINE__}` 在 !macro 体内是**定义行**的常量，
  # 同一个函数里插两次就会撞出 "could not resolve label ..._760.1"（实测
  # 2026-11-19 makensis 原文，出在 un.rfDataPageLeave 的两处日志）。
  ${If} $RFLogFile != ""
    ClearErrors
    FileOpen $R9 "$RFLogFile" a
    ${IfNot} ${Errors}
      # **必须**先 FileSeek 0 END：NSIS 的 "a" 模式只表示"文件不存在就创建"，
      # 它**不会**把写入位置移到文件尾。少了这一句，每条日志都从偏移 0 开始覆盖，
      # 结果是"文件里只剩最后一行 + 最长那行的尾巴"（QA 用 makensis 3.0.4.1 实测：
      # 连写 4 行只剩 1 行，补上本句后 4 行完整）。2026-11-2x 那份"没有日志"的
      # 取证有一半就是这么丢的：日志在写，但每行都在覆盖上一行。
      FileSeek $R9 0 END
      FileWrite $R9 "${MSG}$\r$\n"
      FileClose $R9
    ${EndIf}
  ${EndIf}
!macroend

# ----------------------------------------------------------------------------
# 开工第一件事：把日志文件建出来（2026-11-2x 真机取证）。
#
# 那次安装的取证结论是"本次安装连日志都没写出来"——原来的实现是在 customInit
# 里 FileOpen w，而 customInit 排在 `ALLOW_ONLY_ONE_INSTALLER_INSTANCE` /
# `initMultiUser` 之后：一旦更早的步骤退出（模板的 appRunning 分支、UAC 判定），
# 日志就永远不会产生，用户和我们手里都没有证据。所以改成两级：
#
#   * preInit（.onInit 里 `SetOutPath $INSTDIR` 之后最早能拿到控制权的钩子）
#     就调一次本宏 → 文件立刻存在；
#   * customInit 再调一次 → 幂等（$RFLogFile 已定就只追加一行 phase），
#     此时才拿得到 initMultiUser 算好的 $INSTDIR / $installMode。
#
# %TEMP% 写不进去时退到 $LOCALAPPDATA\ResumeForge\setup.log：同一次真机安装里
# %TEMP% 连 ns*.tmp 都没有生成，说明整个临时目录不可写 —— 日志跟着落在那里等于没有。
# 两处都失败时**不中断安装**（用户要的是能用的程序），但用 DetailPrint 在安装器
# 详细视图里留一行，避免"没有日志"变成无迹可寻。
# ----------------------------------------------------------------------------
!macro RF_LOG_OPEN PHASE
  ${If} $RFSilent == ""
    StrCpy $RFSilent "0"
  ${EndIf}
  ${If} ${Silent}
    StrCpy $RFSilent "1"
  ${EndIf}

  ${If} $RFLogFile == ""
    ClearErrors
    StrCpy $RFLogFile "$TEMP\ResumeForge-Setup.log"
    # 安装器用 w（每次安装一份干净证据），卸载器用 a：升级时**旧卸载器会在新安装器
    # 跑到一半时执行**，如果它截断同名日志，新安装器刚写下的探针/预检记录就没了 ——
    # 那正是 2026-11-2x 现场"日志时间停在更早的一次手动卸载"的成因之一。
    !ifdef BUILD_UNINSTALLER
      FileOpen $9 "$RFLogFile" a
      # 同 RF_LOG：a 模式不定位到文件尾，头两行会覆盖已有日志。卸载器是唯一
      # 走追加模式的一趟，所以这个 seek 只在这里需要。
      FileSeek $9 0 END
    !else
      FileOpen $9 "$RFLogFile" w
    !endif
    ${If} ${Errors}
      StrCpy $RFLogFile "$LOCALAPPDATA\ResumeForge\setup.log"
      CreateDirectory "$LOCALAPPDATA\ResumeForge"
      ClearErrors
      !ifdef BUILD_UNINSTALLER
        FileOpen $9 "$RFLogFile" a
        FileSeek $9 0 END
      !else
        FileOpen $9 "$RFLogFile" w
      !endif
      ${If} ${Errors}
        StrCpy $RFLogFile ""
      ${EndIf}
    ${EndIf}

    ${If} $RFLogFile == ""
      DetailPrint "[ResumeForge] setup log unavailable: $TEMP and $LOCALAPPDATA are both not writable"
    ${Else}
      FileWrite $9 "=== ResumeForge ${VERSION} ${PHASE} ===$\r$\n"
      FileWrite $9 "exe=$EXEPATH$\r$\n"
      FileClose $9
    ${EndIf}
  ${EndIf}

  !insertmacro RF_LOG "phase=${PHASE}"
!macroend

# 一条能对上真机的环境快照：时间 / 安装目录 / 临时目录 / 安装器所在目录 /
# 静默还是交互 / 安装方式。$installMode 在 preInit 时还没被 initMultiUser 赋值
# （那时是空串），所以本宏在 customInit 里还会再打一次，两次的差异本身就是信息。
!macro RF_LOG_ENV
  ${GetTime} "" "L" $R0 $R1 $R2 $R3 $R4 $R5 $R6
  !insertmacro RF_LOG "time=$R0-$R1-$R2 $R3:$R4:$R5 instdir=$INSTDIR"
  !insertmacro RF_LOG "temp=$TEMP exedir=$EXEDIR silent=$RFSilent installmode=$installMode"
!macroend

# ----------------------------------------------------------------------------
# 应用是否还在运行（替换 electron-builder 的 `customCheckAppRunning`）。
#
# **这个钩子是 `_?=` 卸载失败（exit 2、一个文件没删）的根因修复，不要改回路径判定。**
# 模板的实现（include/allowOnlyOneInstallerInstance.nsh 的 `_CHECK_APP_RUNNING`）
# 用 PowerShell 找"镜像路径以 $INSTDIR 开头的进程"，命中就 Stop-Process。而
# `_?=<dir>` 模式下的卸载器**就地**从 $INSTDIR 里运行，它自己就满足那个判据：
#   → 判成"应用在跑" → 把自己 Stop-Process 掉 → 进程半路死亡，退出码非 0、
#     卸载一个文件都没做。实测：`Uninstall ResumeForge.exe /S "_?=D:\…"` → exit 2
#     且目录原样；同一台机器去掉 `_?=`（卸载器被复制到 %TEMP% 运行）→ exit 0、
#     卸载正常。installUtil.nsh 正是用旧卸载器的退出码判断成败，于是 5 次重试后
#     弹 `$(appCannotBeClosed)`，而 tasklist 里根本没有 ResumeForge.exe —— 与现场
#     完全一致。
# 改成**只看镜像名**（tasklist + find，和 RF_WaitForAppExit 同一套、不需要插件）：
# 卸载器/安装器自己的镜像名永远不是 `${APP_EXECUTABLE_FILENAME}`，结构上不可能
# 命中自己。另外两处刻意不同：
#   * 不再强杀进程（--updated 也一样）——强杀会丢用户正在编辑的草稿，而"文件被占用"
#     由装后自检如实报告（RF_INSTALL_SELFCHECK），不会变成假成功；
#   * 自动更新（--updated）不弹框：那条路径没有人在旁边点它，弹框就是卡死。
!macro customCheckAppRunning
  # 先把日志立起来（幂等：安装器那趟在 preInit 就建过，这里只追加一行 phase）。
  # 卸载器那趟很需要它：`un.onInit` 调 un.checkAppRunning 早于 customUnInit，
  # 此时 $RFLogFile 还是空串，RF_LOG 是**静默空操作** —— 这个函数在卸载路径上的
  # 判断（等 5 秒、放弃强杀、退出码）一条都不会留下证据（QA 发现的 Low 2）。
  !insertmacro RF_LOG_OPEN "app-check"

  # 静默/更新两个标志在这里自己算：本宏在卸载器里跑得比 customUnInit 还早
  # （un.onInit 的 un.checkAppRunning），那时 $RFSilent 与 $RFLogFile 都还没定，
  # 所以不能依赖 RF_LOG_OPEN 的结果。
  StrCpy $R2 "0"
  ${If} ${Silent}
    StrCpy $R2 "1"
  ${EndIf}
  !insertmacro RF_IS_UPDATED $R3

  StrCpy $R1 "0"
  rf_app_check_loop:
    nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /NH | find /I "${APP_EXECUTABLE_FILENAME}" >nul'
    Pop $R0
    StrCmp $R0 "0" 0 rf_app_check_done
    # 命中：先给它收尾的机会（自动更新拉起安装器时应用可能刚发完退出请求）。
    IntOp $R1 $R1 + 1
    IntCmp $R1 5 rf_app_check_still_running
    Sleep 1000
    Goto rf_app_check_loop

  rf_app_check_still_running:
    !insertmacro RF_LOG "app still running after 5s: ${APP_EXECUTABLE_FILENAME} silent=$R2 updated=$R3"
    ${If} $R3 == "1"
      # 自动更新：不弹框、不杀进程，让安装继续 —— 真实结果由装后自检报告，
      # 用户不会看到"安装完成"却打不开应用那种假成功。
      !insertmacro RF_LOG "update run: continue without killing the app"
      Goto rf_app_check_done
    ${EndIf}
    ${If} $R2 == "1"
      # 静默但非更新的安装（管理员手动 /S）：没有界面可弹，直接以非 0 退出，
      # 让调用方（或用户的下一条命令）看到失败，而不是卡在一个看不见的框上。
      !insertmacro RF_LOG "silent run: aborting, set errorlevel 3"
      SetErrorLevel 3
      Quit
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(RF_ERR_APP_RUNNING)" IDRETRY rf_app_check_retry
      !insertmacro RF_LOG "user cancelled: app still running"
      SetErrorLevel 3
      Quit
    rf_app_check_retry:
    StrCpy $R1 "0"
    Goto rf_app_check_loop

  rf_app_check_done:
!macroend

# ----------------------------------------------------------------------------
# 是否由自动更新拉起（`--updated`）。
# **不用 ${isUpdated}**：那个宏来自 StdUtils.nsh，底层是 StdUtils 插件；而
# electron-builder 把 nsis.include（= 本文件）放在 `!addplugindir` **之前**，
# 插件目录还没注册，编译期直接 `Plugin not found, cannot call StdUtils::TestParameter`
# （实测 2026-11-19）。改用 FileFunc 的 GetParameters/GetOptions，纯 NSIS。
# 入参：输出变量名（"1" = 更新拉起，"0" = 用户手动安装）。
!macro RF_IS_UPDATED OUT
  Push $R8
  Push $R9
  ${GetParameters} $R8
  StrCpy ${OUT} "0"
  ${GetOptions} $R8 "--updated" $R9
  ${IfNot} ${Errors}
    StrCpy ${OUT} "1"
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend

# ----------------------------------------------------------------------------
# 预检（WF-08 #1）：盘型 / 同步目录 / 空间。
# 只在向导里点"下一步"时跑；/S 静默安装不经过页面，自动更新因此不受影响。
# ----------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER

# 「已装版本」只在安装器里用得到（升级说明 / 备份目录名 / 模式页）。
# 声明放进守卫内：卸载器那一趟若只声明不引用，makensis 会报 6001
# "Variable ... not referenced or never set"，而 electron-builder 把警告当错误（-WX）。
# 安装器专用变量（升级判定 / 预检 / 备份 / 附加任务页）。
Var /GLOBAL RFExistingMode
Var /GLOBAL RFRepairMode
Var /GLOBAL RFUpgradeNote
Var /GLOBAL RFPrecheckFailed
Var /GLOBAL RFBackupRoot
Var /GLOBAL RFBackupDir
Var /GLOBAL RFWantDesktop
Var /GLOBAL RFWantStartMenu
Var /GLOBAL RFAutostart
Var /GLOBAL RFDesktopCheck
Var /GLOBAL RFStartMenuCheck
Var /GLOBAL RFAutostartCheck
Var /GLOBAL RFExistingVersion
# $installMode 的**快照**：那个变量由 multiUser.nsh 声明（模板 body），而抢占式卸旧
# 现在要在 rfPrecheck 里也能跑，那个函数是 header 里编译的 —— 直接引用 $installMode
# 会 `warning 6000` → `-WX` 打包失败（2026-11-2x 实测 "unknown variable/constant
# installMode ... macro:_==:1"）。所以在 customInit（模板 body、$installMode 已定）
# 把它抄进我们自己声明的变量，后面一律读这个。
Var /GLOBAL RFInstallMode
# 写探针 / 降级（下文的 rfProbeWritable 与 RF_WRITE_PROBE）与装后自检的状态。
Var /GLOBAL RFInstallDirOriginal
Var /GLOBAL RFProbeState
Var /GLOBAL RFProbeError
Var /GLOBAL RFDowngraded
Var /GLOBAL RFSelfCheckState
Var /GLOBAL RFSelfCheckMissing
# 桥有没有真的把旧版本卸掉。取消确认（下文的 rfAbortHandler）要按它分两档文案：
# 旧版本已经删了就必须直说"中断后要重新运行安装程序"，没删则说"重装即可修复"。
# 只在 RF_PREEMPTIVE_UNINSTALL 的成功分支（旧卸载器 exit 0）置 "1"，别处不改。
Var /GLOBAL RFOldVersionRemoved

# ----------------------------------------------------------------------------
# 写探针（2026-11-2x 真机取证的核心兜底）
#
# 现场：安装到 `D:\ResumeForge-desktop-user` 时中途弹
# 「不能打开要写入的文件：…\uninstallerIcon.ico」，选"忽略"后到 55% 又弹
# 「无法关闭」。而 D: 根 ACL 正常、手动建目录成功、磁盘充足 —— 也就是说这个目录
# 在某些上下文里写不进去，但 NSIS 的 `File` 指令只会甩一个 Windows 原始对话框，
# 既不写日志也没有下一步。所以这里在**任何文件落盘之前**先自己试写一次：
#
#   * 探针成功 → 一切照旧；
#   * 探针失败 → 记日志（含 GetLastError），改到 RF_FALLBACK_INSTDIR 继续；
#     那里也写不进去才终止，并给出"可改用 zip 版"的出路。
#
# 探针文件落在 $INSTDIR 里而不是 $TEMP%：要验的正是"程序文件能不能写进这个目录"，
# 而 %TEMP% 的写入能力另由 RF_LOG_OPEN 的降级路径覆盖（那次真机 %TEMP% 连
# ns*.tmp 都没生成过）。
# ----------------------------------------------------------------------------
Function rfProbeWritable
  # 入参：$INSTDIR（已被 initMultiUser / 目录页定好）
  # 出参：$RFProbeState = "ok" / "dir" / "write"，$RFProbeError = GetLastError
  StrCpy $RFProbeState "ok"
  StrCpy $RFProbeError "0"

  ${If} $INSTDIR == ""
    # initMultiUser 之前理论上不该调用；真发生了就当"不可写"，走降级而不是写相对路径。
    StrCpy $RFProbeState "dir"
    Return
  ${EndIf}

  # 首次安装时目录还不存在。SetOutPath 会创建它，但失败是静默的；这里自己建，
  # 并且**不**用 `IfFileExists "$INSTDIR\*.*"` 反查 —— 空目录在它眼里"不存在"，
  # 那会把一个完全可写的空目录误判成失败（本仓库在抢救复制里踩过同一个坑）。
  ClearErrors
  CreateDirectory "$INSTDIR"

  ClearErrors
  FileOpen $9 "$INSTDIR\${RF_PROBE_FILE}" w
  ${If} ${Errors}
    StrCpy $RFProbeState "write"
    Call rfCaptureLastError
    Return
  ${EndIf}
  ClearErrors
  FileWrite $9 "probe"
  FileClose $9
  ${If} ${Errors}
    StrCpy $RFProbeState "write"
    Call rfCaptureLastError
  ${EndIf}

  ClearErrors
  Delete "$INSTDIR\${RF_PROBE_FILE}"
  ${If} ${Errors}
    # 能写不能删（少见：目录上有删除权限限制）。安装只写不删，所以仍算可用，
    # 但留一条日志——用户日后在安装目录里看到这个文件时有据可查。
    !insertmacro RF_LOG "probe cleanup failed: $INSTDIR\${RF_PROBE_FILE}"
  ${EndIf}
FunctionEnd

Function rfCaptureLastError
  # GetLastError 只能"尽力"：NSIS 的 FileOpen 包装在失败之后可能又调过别的
  # Win32 API，last-error 有被覆盖的可能。这个值**只进日志**，不参与任何判断
  # （判断只看错误位），免得一个被污染的数字把降级逻辑带偏。
  System::Call 'kernel32::GetLastError() i .R0'
  StrCpy $RFProbeError "$R0"
FunctionEnd

# 探针 + 降级。TAG 只用于日志前缀（本宏在 customInit 与 rfPrecheck 两处插入，
# 全部用 LogicLib 分支、不用裸标签，避免 `${__LINE__}` 在宏体内是定义行导致的撞标签）。
!macro RF_WRITE_PROBE TAG
  # $RFDowngraded 只置 1、**从不清 0**：本宏在 customInit 与 rfPrecheck 各插入一次，
  # 第二次（目录页之后）即使在降级后的目录上探针成功，也不能把"这次安装降级过"
  # 擦掉 —— 收尾日志与完成页都要读它。
  # $RFInstallDirOriginal **只在为空时**记一次（Low 3）：本宏插入两次，customInit 那次
  # 记下的才是"这次安装原本想装到哪"。precheck 那次无条件覆盖它，会让收尾日志里的
  # `downgraded=1` 与"原始目录"对不上真实情况（用户看到的是一份自相矛盾的证据）。
  ${If} $RFInstallDirOriginal == ""
    StrCpy $RFInstallDirOriginal "$INSTDIR"
  ${EndIf}
  Call rfProbeWritable
  !insertmacro RF_LOG "${TAG} probe: dir=$INSTDIR result=$RFProbeState lasterror=$RFProbeError"

  ${If} $RFProbeState != "ok"
    # 降级目标按**安装方式**分档（Low 1）：per-machine 时降到用户目录会让
    # "文件在 $LOCALAPPDATA、注册表在 HKLM、快捷方式在 Common 桌面"三处错位。
    # `$installMode` 本身**绝不改**——它是注册表与快捷方式位置的开关，改了只会让
    # 错位更隐蔽；这里只换一个仍属同一用户上下文、且可写的目录。
    # 读 $RFInstallMode 快照而不是 $installMode：本宏会在 rfPrecheck（header 里
    # 编译的函数）里展开，那时模板的 $installMode 还不存在（warning 6000）。
    ${If} $RFInstallMode == "all"
      StrCpy $INSTDIR "${RF_FALLBACK_INSTDIR_MACHINE}"
    ${Else}
      StrCpy $INSTDIR "${RF_FALLBACK_INSTDIR}"
    ${EndIf}
    ${If} $RFSilent == "1"
      # 自动更新走 /S：这条路径没有人在旁边点框，弹一个就是卡死。
      !insertmacro RF_LOG "${TAG} probe failed -> silent fallback to $INSTDIR (mode=$RFInstallMode)"
    ${Else}
      !insertmacro RF_LOG "${TAG} probe failed -> fallback to $INSTDIR (mode=$RFInstallMode)"
    ${EndIf}

    Call rfProbeWritable
    !insertmacro RF_LOG "${TAG} fallback probe: dir=$INSTDIR result=$RFProbeState lasterror=$RFProbeError"

    ${If} $RFProbeState == "ok"
      StrCpy $RFDowngraded "1"
      # 只改 $INSTDIR 一处就够：electron-builder 的安装段（文件复制 / 注册表 /
      # 快捷方式 / 卸载器登记）自始至终只读 $INSTDIR；写成 $OUTDIR 或另存一个变量
      # 才会漂移。SetOutPath 让"当前输出目录"也跟着走，避免后续相对路径写进旧目录。
      SetOutPath "$INSTDIR"
      !insertmacro RF_LOG "${TAG} downgraded: original=$RFInstallDirOriginal now=$INSTDIR"
      ${If} $RFSilent != "1"
        # 提示放在降级**之后**：要把"从哪来、到哪去"同时说清，用户才知道
        # 以后去哪里找程序（旧的失败方式是一句 Windows 原始对话框，什么都没说）。
        MessageBox MB_ICONEXCLAMATION|MB_OK "$(RF_ERR_DIR_UNWRITABLE)$RFInstallDirOriginal -> $INSTDIR"
      ${EndIf}
    ${Else}
      !insertmacro RF_LOG "${TAG} fatal: no writable install dir (original=$RFInstallDirOriginal)"
      ${If} $RFSilent == "1"
        # 静默路径**不弹框**（ExecWait 里的 MessageBox 会把自动更新挂死，
        # 而"挂死"正是本轮要消灭的现象）。留 DetailPrint + 非 0 退出码，
        # 让更新器的启动对账如实报失败。打印的是刚才试过的那个目录（$INSTDIR），
        # 不写死常量——per-machine 与 per-user 的降级目标不是同一个。
        DetailPrint "[ResumeForge] no writable install directory: $INSTDIR"
      ${Else}
        ${If} ${Cmd} `MessageBox MB_ICONSTOP|MB_YESNO "$(RF_ERR_NO_WRITABLE_DIR)$(RF_LOG_HINT)$RFLogFile$\r$\n$(RF_LOG_ASK)" IDYES`
          ExecShell "open" "$RFLogFile"
        ${EndIf}
      ${EndIf}
      SetErrorLevel 5
      Quit
    ${EndIf}
  ${EndIf}
!macroend

# .onInit 里 `SetOutPath $INSTDIR` 之后最早能拿到控制权的钩子。日志必须在这里就存在：
# 那次真机安装"连日志都没写出来"，而更早的步骤（模板的 appRunning 分支 / UAC 判定）
# 退出时我们连一行证据都留不下。此时 initMultiUser 还没跑（$INSTDIR / $installMode
# 仍是空），所以这里只建文件 + 打环境快照，写探针留给 customInit。
!macro preInit
  !insertmacro RF_LOG_OPEN "preInit"
  !insertmacro RF_LOG_ENV
!macroend

!macro RF_PRECHECK_FAIL TEXT
  # 分支交给 LogicLib：`${__LINE__}` 在 !macro 体内是**定义行**常量，同一函数里插两次
  # 就会撞标签（实测 2026-11-19 "could not resolve label rf_precheck_nolog_317.2"）。
  !insertmacro RF_LOG "precheck rejected: ${TEXT}"
  # 日志路径**运行时拼接**：LangString 里的 $变量不会被展开，写死 "%TEMP%\..." 会让
  # 低完整性上下文（写盘被重定向到 %TEMP%\Low\）的用户按提示找不到文件（2026-11-20 真机）。
  ${If} ${Cmd} `MessageBox MB_ICONSTOP|MB_YESNO "${TEXT}$\r$\n$\r$\n$(RF_LOG_HINT)$RFLogFile$\r$\n$(RF_LOG_ASK)" IDYES`
    ExecShell "open" "$RFLogFile"
  ${EndIf}
!macroend

# 安装目录是否落在网盘/同步目录里（$R3 = "1"/"0"）。StrStrIW 是 shlwapi 的
# 不区分大小写子串搜索：比手写循环可靠（路径里的大小写由资源管理器决定）。
Function rfIsSyncFolder
  StrCpy $R3 "0"
  # $R4 先归零：万一某次调用失败，别让上一轮的非零值残留成"命中"。
  StrCpy $R4 "0"
  System::Call 'shlwapi::StrStrIW(w "$INSTDIR", w "OneDrive") p .R4'
  ${If} $R4 != 0
    StrCpy $R3 "1"
    Return
  ${EndIf}
  System::Call 'shlwapi::StrStrIW(w "$INSTDIR", w "Dropbox") p .R4'
  ${If} $R4 != 0
    StrCpy $R3 "1"
    Return
  ${EndIf}
  System::Call 'shlwapi::StrStrIW(w "$INSTDIR", w "Nutstore") p .R4'
  ${If} $R4 != 0
    StrCpy $R3 "1"
    Return
  ${EndIf}
  System::Call 'shlwapi::StrStrIW(w "$INSTDIR", w "BaiduNetdisk") p .R4'
  ${If} $R4 != 0
    StrCpy $R3 "1"
    Return
  ${EndIf}
  System::Call 'shlwapi::StrStrIW(w "$INSTDIR", w "坚果云") p .R4'
  ${If} $R4 != 0
    StrCpy $R3 "1"
    Return
  ${EndIf}
  System::Call 'shlwapi::StrStrIW(w "$INSTDIR", w "百度网盘") p .R4'
  ${If} $R4 != 0
    StrCpy $R3 "1"
  ${EndIf}
FunctionEnd

# ----------------------------------------------------------------------------
# 把 $INSTDIR 补成 **INSTFILES 之后真正的安装目录**（Low 4）。
#
# 模板 assistedInstaller.nsh:33-39 的 `instFilesPre`（挂在 MUI_PAGE_INSTFILES 的
# `MUI_PAGE_CUSTOMFUNCTION_PRE` 上）会在进度页出现之前做一件事：$INSTDIR 里若还没有
# `${APP_FILENAME}` 这一层，就把应用子目录追加进去。而我们的两次写探针分别在
# customInit（目录页**之前**）与 rfPrecheck（目录页之后、INSTFILES 之前）—— 后者探的
# 是"用户选的父目录"，真正的文件却写进"父目录\<应用名>"。现场那句
# 「不能打开要写入的文件：…\uninstallerIcon.ico」正是发生在子目录里，所以探父目录
# 等于没探。
#
# 这里按**同一条规则**先把子目录补上（幂等：补过之后 instFilesPre 的 StrContains
# 会命中，不会再追加一层），于是探针打的就是最终目录。
#
# 三条实现约束：
#   * 不能用 `${StrContains}`：它由 include/StrContains.nsh 提供，而那一趟 include 在
#     assistedInstaller.nsh 里、**晚于**本文件（本文件被放在生成脚本最顶部）。Function
#     是就地编译的，这里展开它等于 warning 6000 → -WX 打包失败（同
#     `${INSTALL_REGISTRY_KEY}` 那一条）。
#   * 判定必须与 StrContains **同义**：NSIS 的 StrCmp 不区分大小写，所以模板那句
#     "含不含子目录名"实际也不区分大小写。这里用 shlwapi 的 StrStrIW（同样不区分
#     大小写，rfIsSyncFolder 已在用）。写成区分大小写会让 "D:\resumeforge" 这类路径
#     与模板的判定分叉，凭空多套一层目录。
#   * 模板没有 MUI_PAGE_DIRECTORY（`allowToChangeInstallationDirectory` 关掉）时
#     instFilesPre 根本不存在，这时**不能**替它追加，否则安装目录会和模板不一致。
# ----------------------------------------------------------------------------
Function rfResolveFinalInstallDir
  # 入参/出参：$INSTDIR
  !ifdef allowToChangeInstallationDirectory
    !ifdef APP_FILENAME
      StrCpy $R6 "0"
      System::Call 'shlwapi::StrStrIW(w "$INSTDIR", w "${APP_FILENAME}") p .R6'
      ${If} $R6 == 0
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
    !endif
  !endif
FunctionEnd

Function rfPrecheck
  StrCpy $RFPrecheckFailed "0"
  # 1) 盘型：拒绝可移动盘(2)与网络盘(4)。取 $INSTDIR 所在根；此时 $INSTDIR 可能
  #    还没被 instFilesPre 补上应用子目录，取根正好。
  ${GetRoot} "$INSTDIR" $R1
  System::Call 'kernel32::GetDriveType(t "$R1") i .r2'
  ${If} $R2 == 2
  ${OrIf} $R2 == 4
    StrCpy $RFPrecheckFailed "1"
    !insertmacro RF_PRECHECK_FAIL "$(RF_PRECHECK_REMOTE)"
    Return
  ${EndIf}

  # 2) 同步目录：这些客户端的同步进程会在升级时锁住 exe/dll，导致覆盖安装失败。
  Call rfIsSyncFolder
  ${If} $R3 == "1"
    StrCpy $RFPrecheckFailed "1"
    !insertmacro RF_PRECHECK_FAIL "$(RF_PRECHECK_CLOUD)"
    Return
  ${EndIf}

  # 3) 空间：安装盘与 %LOCALAPPDATA% 所在盘都要够（运行时解压到用户目录）。
  ${DriveSpace} "$R1" "/D=F /S=M" $R4
  !insertmacro RF_LOG "precheck: drive $R1 free $R4 MB"
  ${If} $R4 < ${RF_MIN_FREE_MB}
    StrCpy $RFPrecheckFailed "1"
    !insertmacro RF_PRECHECK_FAIL "$(RF_PRECHECK_SPACE)"
    Return
  ${EndIf}

  ${DriveSpace} "$LOCALAPPDATA" "/D=F /S=M" $R5
  !insertmacro RF_LOG "precheck: localappdata free $R5 MB"
  ${If} $R5 < ${RF_MIN_FREE_MB}
    StrCpy $RFPrecheckFailed "1"
    !insertmacro RF_PRECHECK_FAIL "$(RF_PRECHECK_SPACE)"
    Return
  ${EndIf}

  # 4) 先补成**最终**目录，再在那里探（Low 4）：模板的 instFilesPre 会在 INSTFILES
  #    之前把应用子目录追加到 $INSTDIR，我们若探父目录，验的就不是真正落盘的位置。
  Call rfResolveFinalInstallDir
  !insertmacro RF_LOG "precheck: final install dir=$INSTDIR"

  # 5) 写探针（第二次）：customInit 那次早于"选择安装位置"页，用户完全可能改到
  #    另一个写不进去的目录。这里再探一次，交互模式照样能自动降级 —— 否则就会
  #    重演现场那句「不能打开要写入的文件」，那是 Windows 的原始对话框，既没有
  #    下一步也没有日志。降级只改 $INSTDIR，不阻断流程。
  !insertmacro RF_WRITE_PROBE "precheck"
  ${If} $RFDowngraded == "1"
    !insertmacro RF_LOG "precheck: install dir downgraded to $INSTDIR"
  ${EndIf}

  # 6) 抢占式卸旧（交互路径的最后一站，Medium 3）：目录页之后、INSTFILES 之前。
  #    这一页的 leave 一旦通过，后面就只剩进度条，用户已经没有取消的机会了 ——
  #    这正是"删旧版本 + 清卸载登记"应该发生的时点。静默没有页面（到不了这里），
  #    那条路径在 customInit 里做（legacy-data-rescue.nsh 的 rf_init_done 之后）。
  #    探针在前面：先确认能写，再动旧版本，顺序反了会在不可写目录上白删一遍。
  !insertmacro RF_PREEMPTIVE_UNINSTALL

  !insertmacro RF_LOG "precheck ok: $INSTDIR"
FunctionEnd

# ----------------------------------------------------------------------------
# 升级前自动备份（WF-08 #2）：把 %APPDATA%\ResumeForge\data 的主库复制到
# backups\pre-update-<版本>-<日期>，只留最近 2 份，不压缩。
# 修复安装不跑：那说明上次装到一半失败，库可能是半份的，备份它没有意义。
# ----------------------------------------------------------------------------
!macro RF_PICK_MAX_BACKUP EXCLUDE1 EXCLUDE2 TAG
  StrCpy $R6 ""
  FindFirst $0 $1 "$RFBackupRoot\pre-update-*"
  rf_pick_loop_${TAG}:
    StrCmp $1 "" rf_pick_done_${TAG}
    ${If} $1 != "${EXCLUDE1}"
    ${AndIf} $1 != "${EXCLUDE2}"
    ${AndIf} ${FileExists} "$RFBackupRoot\$1\resume_forge.db"
      ${If} $R6 == ""
        StrCpy $R6 "$1"
      ${ElseIf} "$1" S> "$R6"
        StrCpy $R6 "$1"
      ${EndIf}
    ${EndIf}
    FindNext $0 $1
    Goto rf_pick_loop_${TAG}
  rf_pick_done_${TAG}:
  FindClose $0
!macroend

Function rfBackupBeforeUpdate
  StrCmp $RFExistingVersion "" rf_backup_skip
  StrCmp $RFRepairMode "1" rf_backup_skip
  IfFileExists "${RF_DATA_DIR}\resume_forge.db" 0 rf_backup_skip

  # 复制一份正在写入的库没有意义：先等应用退出（60 秒，超时弹窗并中止安装）。
  !insertmacro RF_WaitForAppExit

  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  StrCpy $RFBackupRoot "${RF_DATA_DIR}\backups"
  StrCpy $RFBackupDir "$RFBackupRoot\pre-update-$RFExistingVersion-$2$1$0-$3$4"
  CreateDirectory "$RFBackupDir"
  CopyFiles /SILENT "${RF_DATA_DIR}\resume_forge.db" "$RFBackupDir\"
  CopyFiles /SILENT "${RF_DATA_DIR}\resume_forge.db-wal" "$RFBackupDir\"
  CopyFiles /SILENT "${RF_DATA_DIR}\resume_forge.db-shm" "$RFBackupDir\"

  ${IfNot} ${FileExists} "$RFBackupDir\resume_forge.db"
    !insertmacro RF_LOG "pre-update backup FAILED: $RFBackupDir"
    RMDir /r "$RFBackupDir"
    # 备份只是多一层保险：升级本身不动 %APPDATA%，失败不阻断。
    Goto rf_backup_skip
  ${EndIf}
  !insertmacro RF_LOG "pre-update backup: $RFBackupDir"

  # 只留最近 2 份（含刚建的这份）。名字形如 pre-update-<ver>-YYYYMMDD-HHMM，
  # 同一版本内可直接按字符串大小比较；跨版本时旧版本会被优先清掉，这符合预期。
  !insertmacro RF_PICK_MAX_BACKUP "$RFBackupDir" "" A
  StrCpy $R5 "$R6"
  !insertmacro RF_PICK_MAX_BACKUP "$RFBackupDir" "$R5" B
  StrCpy $R4 "$R6"

  FindFirst $0 $1 "$RFBackupRoot\pre-update-*"
  rf_backup_prune_loop:
    StrCmp $1 "" rf_backup_prune_done
    ${If} $1 != "$RFBackupDir"
    ${AndIf} $1 != "$R5"
    ${AndIf} $1 != "$R4"
      !insertmacro RF_LOG "pre-update backup prune: $1"
      RMDir /r "$RFBackupRoot\$1"
    ${EndIf}
    FindNext $0 $1
    Goto rf_backup_prune_loop
  rf_backup_prune_done:
  FindClose $0

  rf_backup_skip:
FunctionEnd

# ----------------------------------------------------------------------------
# 自定义页的标题区。不用 MUI_HEADER_TEXT：它写的是 MUI 页眉里的两个控件，
# 而欢迎页（全窗口页）没有页眉，自定义页紧跟其后时那两个控件还不存在。
# 入参：$1 = 标题，$2 = 说明。
# ----------------------------------------------------------------------------
Function rfDrawTitle
  ${NSD_CreateLabel} 0 0 100% 22u "$1"
  Pop $0
  CreateFont $3 "$(^Font)" "12" "700"
  SendMessage $0 ${WM_SETFONT} $3 0
  ${NSD_CreateLabel} 0 24u 100% 34u "$2"
  Pop $0
FunctionEnd

# ----------------------------------------------------------------------------
# 安装：欢迎页（品牌 + 版本 + 一句话，升级时追加"数据不动"）+ 安装模式页
# ----------------------------------------------------------------------------
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(RF_WELCOME_TITLE)"
  !define MUI_WELCOMEPAGE_TEXT "$(RF_WELCOME_TEXT)$RFUpgradeNote"
  !insertmacro MUI_PAGE_WELCOME
  !insertmacro MUI_UNSET MUI_WELCOMEPAGE_TITLE
  !insertmacro MUI_UNSET MUI_WELCOMEPAGE_TEXT
  Page custom rfModePageShow rfModePageLeave
!macroend

# 只在"已有安装"时出现。全新安装交给 electron-builder 自带的安装模式页
# （那里可以选"仅为我 / 所有用户"）；升级时选错会留下两份安装，所以这里只说明，
# 由 customInstallMode 强制沿用原方式、让自带那页自己跳过。
Function rfModePageShow
  StrCmp $RFExistingVersion "" rf_mode_skip
  !insertmacro RF_LOG "mode page shown (upgrade from $RFExistingVersion)"
  nsDialogs::Create 1018
  Pop $RFPage
  ${If} $RFPage == error
    Abort
  ${EndIf}
  StrCpy $1 "$(RF_MODE_TITLE)"
  ${If} $RFExistingMode == "machine"
    StrCpy $2 "$(RF_MODE_TEXT)$\r$\n$(RF_MODE_ALL)"
  ${Else}
    StrCpy $2 "$(RF_MODE_TEXT)$\r$\n$(RF_MODE_USER)"
  ${EndIf}
  Call rfDrawTitle
  nsDialogs::Show
  rf_mode_skip:
FunctionEnd

Function rfModePageLeave
FunctionEnd

# 升级时把安装方式钉死成已有那份（customInit 已读注册表），自带模式页随即 Abort。
# 只定义一份 `customInstallMode`：NSIS 的宏名**大小写不敏感**（模板写的是
# `!ifmacrodef customInstallmode`，实际插入的是 `customInstallMode`），两个都定义
# 会报 "macro named customInstallmode already exists"（实测 2026-11-19）。
!macro RF_FORCE_INSTALL_MODE
  StrCmp $RFExistingVersion "" rf_force_mode_done
  ${If} $RFExistingMode == "machine"
    StrCpy $isForceMachineInstall "1"
  ${ElseIf} $RFExistingMode == "user"
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
  rf_force_mode_done:
!macroend

!macro customInstallMode
  !insertmacro RF_FORCE_INSTALL_MODE
!macroend

# ----------------------------------------------------------------------------
# 安装：附加任务页（桌面快捷方式 / 开始菜单 / 开机自启）
# 默认值在 RF_INSTALL_DEFAULTS 里先落好：/S 静默安装不跑这个页面，仍按
# "两个快捷方式 + 不自启"的旧行为走。
# ----------------------------------------------------------------------------
!macro customPageAfterChangeDir
  Page custom rfTasksPageShow rfTasksPageLeave
!macroend

Function rfTasksPageShow
  # 修复安装只补程序文件：选项页没有意义，直接跳过。
  StrCmp $RFRepairMode "1" rf_tasks_skip
  nsDialogs::Create 1018
  Pop $RFPage
  ${If} $RFPage == error
    Abort
  ${EndIf}
  StrCpy $1 "$(RF_TASKS_TITLE)"
  StrCpy $2 "$(RF_TASKS_HINT)"
  Call rfDrawTitle

  ${NSD_CreateCheckbox} 0 62u 100% 12u "$(RF_TASK_DESKTOP)"
  Pop $RFDesktopCheck
  ${If} $RFWantDesktop == "1"
    ${NSD_Check} $RFDesktopCheck
  ${EndIf}

  ${NSD_CreateCheckbox} 0 82u 100% 12u "$(RF_TASK_STARTMENU)"
  Pop $RFStartMenuCheck
  ${If} $RFWantStartMenu == "1"
    ${NSD_Check} $RFStartMenuCheck
  ${EndIf}

  ${NSD_CreateCheckbox} 0 110u 100% 12u "$(RF_TASK_AUTOSTART)"
  Pop $RFAutostartCheck
  ${If} $RFAutostart == "1"
    ${NSD_Check} $RFAutostartCheck
  ${EndIf}

  ${NSD_CreateLabel} 14u 124u 92% 16u "$(RF_TASK_AUTOSTART_HINT)"
  Pop $0

  nsDialogs::Show
  rf_tasks_skip:
FunctionEnd

Function rfTasksPageLeave
  ${NSD_GetState} $RFDesktopCheck $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $RFWantDesktop "1"
  ${Else}
    StrCpy $RFWantDesktop "0"
  ${EndIf}
  ${NSD_GetState} $RFStartMenuCheck $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $RFWantStartMenu "1"
  ${Else}
    StrCpy $RFWantStartMenu "0"
  ${EndIf}
  ${NSD_GetState} $RFAutostartCheck $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $RFAutostart "1"
  ${Else}
    StrCpy $RFAutostart "0"
  ${EndIf}

  !insertmacro RF_LOG "tasks: desktop=$RFWantDesktop startmenu=$RFWantStartMenu autostart=$RFAutostart"
  Call rfPrecheck
  ${If} $RFPrecheckFailed == "1"
    Abort
  ${EndIf}
FunctionEnd

# ----------------------------------------------------------------------------
# 完成页：立即启动 + 查看使用指南
# ----------------------------------------------------------------------------

Function rfLaunchApp
  !insertmacro RF_IS_UPDATED $R2
  ${If} $R2 == "1"
    ExecShell "" "$INSTDIR\${PRODUCT_FILENAME}.exe" "--updated"
  ${Else}
    ExecShell "" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  ${EndIf}
FunctionEnd

Function rfOpenGuide
  ExecShell "open" "${RF_GUIDE_URL}"
FunctionEnd

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "$(RF_FINISH_TITLE)"
  !define MUI_FINISHPAGE_TEXT "$(RF_FINISH_TEXT)"
  # RUN / SHOWREADME 只当开关用（真正的动作用 *_FUNCTION 指定），标签在 *_TEXT。
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "$(RF_FINISH_RUN)"
  !define MUI_FINISHPAGE_RUN_FUNCTION "rfLaunchApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$(RF_FINISH_GUIDE)"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "rfOpenGuide"
  !insertmacro MUI_PAGE_FINISH
  !insertmacro MUI_UNSET MUI_FINISHPAGE_TITLE
  !insertmacro MUI_UNSET MUI_FINISHPAGE_TEXT
!macroend

# ----------------------------------------------------------------------------
# 安装期装配（由 legacy-data-rescue.nsh 的 customInit / customInstall 末尾插入）
# ----------------------------------------------------------------------------

# customInit 的中段：读出已有安装 → 定默认值 → 升级备份。
# （日志与写探针由 legacy-data-rescue.nsh 的 customInit 在本宏之前先跑，
#   日志因此从"开工第一行"就存在，探针也早于任何文件落盘。）
!macro RF_INSTALL_INIT
  # 快照安装方式：本宏在 customInit（模板 body）里展开，$installMode 此刻有效；
  # 后面的 rfPrecheck / 抢占式卸旧读这个快照（理由见 Var 声明处）。
  # ⚠️ legacy-data-rescue.nsh 的 customInit 已经在本宏之前抄过一次了 —— 那次是必须的，
  # 因为写探针（RF_WRITE_PROBE）要按安装方式选降级目标，而探针排在本宏之前。这里再抄
  # 一次只为了"本宏单独看也是自洽的"（幂等，同一个值）。两处都必须读 $installMode
  # 的**同一个来源**，不要在这里换成别的判据。
  StrCpy $RFInstallMode "$installMode"
  StrCpy $RFExistingVersion ""
  StrCpy $RFExistingMode ""
  StrCpy $RFRepairMode "0"
  StrCpy $RFUpgradeNote ""
  StrCpy $RFWantDesktop "1"
  StrCpy $RFWantStartMenu "1"
  StrCpy $RFAutostart "0"

  # 已安装版本：读当前上下文（initMultiUser 已经定好 per-user/per-machine）。
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $RFExistingVersion "$0"
    ${If} $installMode == "all"
      StrCpy $RFExistingMode "machine"
    ${Else}
      StrCpy $RFExistingMode "user"
    ${EndIf}
    # 欢迎页追加的那一段：运行时拼接（LangString 里的 $变量不会被展开）。
    StrCpy $RFUpgradeNote "$\r$\n$\r$\n$(RF_UPGRADE_PREFIX)$RFExistingVersion$(RF_UPGRADE_SUFFIX)"
    !insertmacro RF_LOG "existing install: version=$RFExistingVersion mode=$RFExistingMode dir=$1"
  ${EndIf}

  # 修复安装：注册表有安装目录，但程序文件不见了（上次装到一半失败、或被杀软删过）。
  ${If} $1 != ""
  ${AndIfNot} ${FileExists} "$1\resources\payload\backend\app\main.py"
    StrCpy $RFRepairMode "1"
    StrCpy $RFUpgradeNote "$\r$\n$\r$\n$(RF_REPAIR_NOTE)"
    !insertmacro RF_LOG "repair mode: payload missing under $1"
  ${EndIf}

  # 旧快捷方式的状态决定默认勾选：用户上次删掉桌面图标，不该被这次安装装回来。
  ${IfNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $RFWantDesktop "0"
  ${EndIf}
  ${IfNot} ${FileExists} "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
    StrCpy $RFWantStartMenu "0"
  ${EndIf}
  # 一次都没装过（全新安装）时按产品默认走：两个都要。
  ${If} $RFExistingVersion == ""
    StrCpy $RFWantDesktop "1"
    StrCpy $RFWantStartMenu "1"
  ${EndIf}

  Call rfBackupBeforeUpdate
!macroend

# customInstall 的末段：按勾选收拾快捷方式 + 写入/清除自启 + 收尾日志。
!macro RF_INSTALL_FINISH
  # 快捷方式由 electron-builder 在 customInstall 之前创建；用户取消勾选时在这里删掉。
  # KeepShortcuts 注册值同步改掉，否则下次升级会"保留"一个用户不想要的图标。
  ${If} $RFWantDesktop == "0"
    ${If} ${FileExists} "$newDesktopLink"
      Delete "$newDesktopLink"
      !insertmacro RF_LOG "removed desktop shortcut (user opted out)"
    ${EndIf}
  ${EndIf}
  ${If} $RFWantStartMenu == "0"
    ${If} ${FileExists} "$newStartMenuLink"
      Delete "$newStartMenuLink"
      !insertmacro RF_LOG "removed start menu shortcut (user opted out)"
    ${EndIf}
  ${EndIf}

  # 开机自启：只写 HKCU\...\Run（per-user 安装；per-machine 安装也按当前用户开机启动，
  # 与"开机自启"的语义一致）。卸载器删同一条。
  ${If} $RFAutostart == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ResumeForge" '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
    !insertmacro RF_LOG "autostart: added"
  ${Else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ResumeForge"
    !insertmacro RF_LOG "autostart: not requested"
  ${EndIf}

  !insertmacro RF_LOG "install done: version=${VERSION} repair=$RFRepairMode instdir=$INSTDIR downgraded=$RFDowngraded"
!macroend

# ----------------------------------------------------------------------------
# 装完自检（2026-11-2x）：**不许"假装成功"**。
#
# 现场最终是用 `robocopy desktop\out\win-unpacked → 安装目录` 绕过去的，说明包本身
# 没问题、坏的是安装器"失败也要装作成功"的处理：进度条走完、弹出"安装完成"，
# 而目录里 0 个文件。自检把这件事变成不可能 —— 缺文件就以非 0 退出码收场。
#
# 分两档判据，因为要给出**不同的**下一步：
#   a) `resources\payload\backend\app\main.py` 缺失 = 复制阶段没成（现场那一档）；
#   b) `ResumeForge.exe` / `resources\app.asar` 缺失 = 壳本体不全（装了也打不开）。
# 弹窗文案对应 RF_ERR_COPY_FAILED / RF_ERR_SELFCHECK，两者都不是 `$(appCannotBeClosed)`。
!macro RF_INSTALL_SELFCHECK
  StrCpy $RFSelfCheckState "ok"
  StrCpy $RFSelfCheckMissing ""

  ${IfNot} ${FileExists} "$INSTDIR\resources\payload\backend\app\main.py"
    StrCpy $RFSelfCheckState "copy"
    StrCpy $RFSelfCheckMissing "resources\payload\backend\app\main.py"
    !insertmacro RF_LOG "self-check: payload missing under $INSTDIR"
  ${EndIf}

  ${IfNot} ${FileExists} "$INSTDIR\${PRODUCT_FILENAME}.exe"
    StrCpy $RFSelfCheckState "files"
    StrCpy $RFSelfCheckMissing "${PRODUCT_FILENAME}.exe"
    !insertmacro RF_LOG "self-check: missing ${PRODUCT_FILENAME}.exe under $INSTDIR"
  ${EndIf}

  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    StrCpy $RFSelfCheckState "files"
    ${If} $RFSelfCheckMissing == ""
      StrCpy $RFSelfCheckMissing "resources\app.asar"
    ${Else}
      StrCpy $RFSelfCheckMissing "$RFSelfCheckMissing, resources\app.asar"
    ${EndIf}
    !insertmacro RF_LOG "self-check: missing resources\app.asar under $INSTDIR"
  ${EndIf}

  !insertmacro RF_LOG "self-check: state=$RFSelfCheckState instdir=$INSTDIR missing=$RFSelfCheckMissing"

  ${If} $RFSelfCheckState != "ok"
    ${If} $RFSelfCheckState == "copy"
      StrCpy $R1 "$(RF_ERR_COPY_FAILED)"
    ${Else}
      StrCpy $R1 "$(RF_ERR_SELFCHECK)$RFSelfCheckMissing"
    ${EndIf}
    ${If} $RFSilent == "1"
      # 静默（自动更新）：不弹框，DetailPrint + 非 0 退出码，让更新器的启动对账
      # 如实报"这次没装成"，而不是下个版本起来才发现文件少了。
      DetailPrint "[ResumeForge] self-check failed: $RFSelfCheckMissing"
    ${Else}
      MessageBox MB_ICONSTOP|MB_OK "$R1$\r$\n$(RF_LOG_HINT)$RFLogFile"
    ${EndIf}
    SetErrorLevel 6
    Quit
  ${EndIf}

  !insertmacro RF_LOG "self-check ok: $INSTDIR"
!macroend

# ----------------------------------------------------------------------------
# 进度页取消（Medium 3 残余）：**不试图还原旧版本，但也不许糊里糊涂地点掉。**
#
# 现状是：交互模式的桥在 rfTasksPageLeave（目录页之后、INSTFILES 之前）跑，用户还能
# 取消；可一旦进了进度页再点取消，旧版本已被卸载，而新的安装登记要等到 section
# 末尾才写（installSection.nsh:67 的 `registryAddInstallInfo`）—— 于是磁盘上旧程序
# 没了、Add/Remove 里 0 条记录。还原旧版本做不到（旧卸载器已经把文件删了），能做
# 的两件事只有：
#   * 说清后果（"旧版本已被移除，中断后需要重新运行安装程序"）；
#   * 留一份可核对的日志（$INSTDIR + 复制到哪一步 + 旧版本有没有被删）。
#
# 为什么挂在 `MUI_CUSTOMFUNCTION_ABORT` 上，而不是自己定义 `.onUserAbort`：
# MUI2 的 `MUI_FUNCTION_ABORTWARNING`（Interface.nsh:323-341）**无条件**定义了
# `.onUserAbort` —— 自己再定义一遍就是 "Function named .onUserAbort already exists"
# （实测 2026-11-2x 打包原文），整台打包直接失败。它给的扩展点就是这两条：
#   * `MUI_CUSTOMFUNCTION_ABORT`：`.onUserAbort` 里最先 Call 的函数（我们用它）；
#   * `MUI_ABORTWARNING` + `MUI_ABORTWARNING_TEXT`：MUI 自带的通用确认框。
# 我们**不用**后者：那句是通用文案 `$(MUI_TEXT_ABORTWARNING)`，说不清"旧版本已经
# 不在了"，而这正是用户此刻最需要知道的一件事；而且 MUI 那条没有静默判断。
#
# 静默（`/S`，自动更新）不经过任何页面，`.onUserAbort` 根本不会被调用；万一被调用
# （模板以后改了），这里也**不弹框**并取消这次中止：更新器用 ExecWait 等这个进程，
# 一个框就是挂死。
# ----------------------------------------------------------------------------
!define MUI_CUSTOMFUNCTION_ABORT "rfAbortHandler"

Function rfAbortHandler
  # "复制到哪一步"用最实在的判据：新 payload 由 installApplicationFiles 写入，
  # 它在不在，就是"文件复制开始了没有"。比另设一个阶段变量可靠（少一处同步点）。
  ${If} ${FileExists} "$INSTDIR\resources\payload\backend\app\main.py"
    StrCpy $R1 "1"
  ${Else}
    StrCpy $R1 "0"
  ${EndIf}
  !insertmacro RF_LOG "abort requested: instdir=$INSTDIR old_version_removed=$RFOldVersionRemoved files_copied=$R1 silent=$RFSilent"

  ${If} ${Silent}
    # 静默路径既不许弹框，也不许因为"有人点了取消"就停下（这里 `Abort` 的语义是
    # **取消这次中止请求**，安装继续）。
    Abort
  ${EndIf}

  # 先选文案再弹：两档文案只差"旧版本还在不在"。
  StrCpy $R2 "$(RF_ABORT_PLAIN)"
  ${If} $RFOldVersionRemoved == "1"
    StrCpy $R2 "$(RF_ABORT_AFTER_UNINSTALL)"
  ${EndIf}
  # 用 `${Cmd}` 包住 MessageBox 而不是 `IDYES +2` 相对跳转：后者按**指令条数**偏移，
  # 紧跟其后的任何宏（RF_LOG 会展开成一串指令）都会让偏移落到块中间。
  ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONEXCLAMATION "$R2$\r$\n$\r$\n$(RF_LOG_HINT)$RFLogFile" IDYES`
    !insertmacro RF_LOG "abort confirmed by the user: instdir=$INSTDIR old_version_removed=$RFOldVersionRemoved"
  ${Else}
    # 选"否"= 不中断，留在进度页继续装。
    Abort
  ${EndIf}
FunctionEnd

!endif

# ============================================================================
# 卸载器
#
# 页序：欢迎（删什么/留什么/先关应用）→ 卸载选项（备份 / 删除数据 / 打开数据目录）
#       → 进度 → 清理结果（三类残留 + 可打开 + 失败可重试）→ 完成
#
# 数据默认保留：$RFUnDeleteData 在 customUnInit 里先落 "0"（/S 静默卸载与自动更新
# 都走这条路，绝不能因为页面没跑就删用户数据）。
# ============================================================================
!ifdef BUILD_UNINSTALLER

# 卸载器专用变量（数据选项 / 复制 / 残留清单 / 重试计数）。
Var /GLOBAL RFUnDeleteData
Var /GLOBAL RFUnBackupData
Var /GLOBAL RFUnBackupDir
Var /GLOBAL RFUnRetryCount
Var /GLOBAL RFDeleteCheck
Var /GLOBAL RFBackupCheck
Var /GLOBAL RFResidueInstall
Var /GLOBAL RFResidueData
Var /GLOBAL RFResidueRuntime
Var /GLOBAL RFNeedRetry
Var /GLOBAL RFUSrc
Var /GLOBAL RFUDst
Var /GLOBAL RFUCopyFailed

!macro RF_UNINSTALL_INIT
  # 日志用同一套开工逻辑（含 %TEMP% 不可写时退到 %LOCALAPPDATA% 的降级）：
  # 卸载器也要在"最早能拿到控制权"的地方留下证据，否则卸载失败同样无从排查。
  !insertmacro RF_LOG_OPEN "uninstall"
  !insertmacro RF_LOG_ENV
  StrCpy $RFUnDeleteData "0"
  StrCpy $RFUnBackupData "1"
  StrCpy $RFUnBackupDir ""
  StrCpy $RFUnRetryCount "0"
  StrCpy $RFNeedRetry "0"
  !insertmacro RF_LOG "uninstall init: instdir=$INSTDIR data=${RF_DATA_DIR}"
!macroend

!macro customUnInit
  !insertmacro RF_UNINSTALL_INIT
!macroend

!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "$(RF_UNWELCOME_TITLE)"
  !define MUI_UNWELCOMEPAGE_TEXT "$(RF_UNWELCOME_TEXT)"
  !insertmacro MUI_UNPAGE_WELCOME
  !insertmacro MUI_UNSET MUI_UNWELCOMEPAGE_TITLE
  !insertmacro MUI_UNSET MUI_UNWELCOMEPAGE_TEXT
  UninstPage custom un.rfDataPageShow un.rfDataPageLeave
!macroend

# ----------------------------------------------------------------------------
# 卸载选项页（WF-08 #5 / #7）
# ----------------------------------------------------------------------------
Function un.rfDataPageShow
  nsDialogs::Create 1018
  Pop $RFPage
  ${If} $RFPage == error
    Abort
  ${EndIf}
  StrCpy $1 "$(RF_UNDATA_TITLE)"
  StrCpy $2 "$(RF_UNDATA_HINT)"
  Call un.rfDrawTitle

  ${NSD_CreateCheckbox} 0 66u 100% 12u "$(RF_UNDATA_BACKUP)"
  Pop $RFBackupCheck
  ${If} $RFUnBackupData == "1"
    ${NSD_Check} $RFBackupCheck
  ${EndIf}

  ${NSD_CreateCheckbox} 0 90u 100% 12u "$(RF_UNDATA_DELETE)"
  Pop $RFDeleteCheck
  ${If} $RFUnDeleteData == "1"
    ${NSD_Check} $RFDeleteCheck
  ${EndIf}

  ${NSD_CreateLabel} 14u 104u 92% 18u "$(RF_UNDATA_DELETE_HINT)"
  Pop $0

  ${NSD_CreateButton} 0 132u 90u 15u "$(RF_UNDATA_OPEN)"
  Pop $0
  ${NSD_OnClick} $0 un.rfOpenDataDir

  ${NSD_CreateLabel} 0 158u 100% 24u "${RF_DATA_DIR}"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.rfOpenDataDir
  ExecShell "open" "${RF_DATA_DIR}"
FunctionEnd

Function un.rfDrawTitle
  ${NSD_CreateLabel} 0 0 100% 22u "$1"
  Pop $0
  CreateFont $3 "$(^Font)" "12" "700"
  SendMessage $0 ${WM_SETFONT} $3 0
  ${NSD_CreateLabel} 0 24u 100% 34u "$2"
  Pop $0
FunctionEnd

Function un.rfDataPageLeave
  ${NSD_GetState} $RFBackupCheck $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $RFUnBackupData "1"
  ${Else}
    StrCpy $RFUnBackupData "0"
  ${EndIf}
  ${NSD_GetState} $RFDeleteCheck $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $RFUnDeleteData "1"
  ${Else}
    StrCpy $RFUnDeleteData "0"
  ${EndIf}
  !insertmacro RF_LOG "uninstall options: backup=$RFUnBackupData delete=$RFUnDeleteData"

  # 删除前明示范围（WF-08 #7）：列出将删的路径 + 总大小 + 不可恢复。
  ${If} $RFUnDeleteData == "1"
    StrCpy $R1 "0"
    ${If} ${FileExists} "${RF_DATA_DIR}\*.*"
      ${un.GetSize} "${RF_DATA_DIR}" "/S=0K" $R2 $R3 $R4
      IntOp $R1 $R1 + $R2
    ${EndIf}
    ${If} ${FileExists} "${RF_RUNTIME_DIR}\*.*"
      ${un.GetSize} "${RF_RUNTIME_DIR}" "/S=0K" $R2 $R3 $R4
      IntOp $R1 $R1 + $R2
    ${EndIf}
    IntOp $R1 $R1 / 1024
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "$(RF_CONFIRM_TITLE)$\r$\n$\r$\n${RF_DATA_DIR}$\r$\n${RF_RUNTIME_DIR}$\r$\n$\r$\n$(RF_UNDATA_DELETE_HINT) ($R1 MB)" IDYES +2
      StrCpy $RFUnDeleteData "0"
  ${EndIf}
FunctionEnd

# ----------------------------------------------------------------------------
# 递归复制（卸载前备份用）。安装器那份 RF_CopyTree 只编进安装器，这里必须
# 另有一份 un. 前缀的实现：两个二进制各自独立，函数不能共享。
# ----------------------------------------------------------------------------
Function un.rfCopyTree
  Exch $R9
  Push $R8
  Push $R7
  Push $R6
  Push $R5
  Push $R4
  Push $R3

  ${If} $R9 == ""
    StrCpy $R7 "$RFUSrc"
    StrCpy $R8 "$RFUDst"
  ${Else}
    StrCpy $R7 "$RFUSrc\$R9"
    StrCpy $R8 "$RFUDst\$R9"
  ${EndIf}
  CreateDirectory "$R8"

  FindFirst $R5 $R6 "$R7\*.*"
  un_rf_copy_loop:
    StrCmp $R6 "" un_rf_copy_done
    StrCmp $R6 "." un_rf_copy_next
    StrCmp $R6 ".." un_rf_copy_next

    # 目录判定不能只看 IfFileExists "<路径>\*.*"：空目录在它眼里"不存在"。
    FindFirst $R4 $R3 "$R7\$R6\*.*"
    StrCmp $R3 "" un_rf_copy_file
    FindClose $R4
    ${If} $R9 == ""
      Push "$R6"
    ${Else}
      Push "$R9\$R6"
    ${EndIf}
    Call un.rfCopyTree
    Pop $R0
    Goto un_rf_copy_next

  un_rf_copy_file:
    ClearErrors
    CopyFiles /SILENT "$R7\$R6" "$R8\$R6"
    IfErrors un_rf_copy_failed
    ${IfNot} ${FileExists} "$R8\$R6"
      Goto un_rf_copy_failed
    ${EndIf}
    Goto un_rf_copy_next
  un_rf_copy_failed:
    StrCpy $RFUCopyFailed "1"
    # **必须**先保存 $R9 再写日志：本函数用 $R9 传递归参数，而 `RF_LOG` 内部拿 $R9
    # 当文件句柄（见 wizard.nsh 的 RF_LOG：`FileOpen $R9 ...`）。一次复制失败之后
    # 如果不还原，$R9 就变成了一个数字句柄，接着的递归会拼出 "1234\user_files"
    # 这种垃圾路径 —— 备份目录里于是静默缺一层，而日志只写"copy failed"。
    # 改 RF_LOG 的全局寄存器约定会牵连所有调用点，所以在这里就地保存/恢复。
    Push $R9
    !insertmacro RF_LOG "backup copy failed: $R7\$R6"
    Pop $R9

  un_rf_copy_next:
    FindNext $R5 $R6
    Goto un_rf_copy_loop
  un_rf_copy_done:
  FindClose $R5

  Pop $R3
  Pop $R4
  Pop $R5
  Pop $R6
  Pop $R7
  Pop $R8
  Exch $R9
FunctionEnd

# ----------------------------------------------------------------------------
# 卸载期动作（WF-08 #5 备份 / 删除数据 / 自启项），由 customUnInstall 调用。
# 自动更新（--updated）不动数据也不做备份：那时用户什么都没选，页面根本没跑。
# ----------------------------------------------------------------------------
!macro RF_UNINSTALL_FINISH
  # 自启项：与安装器写的是同一条（per-user）。
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ResumeForge"

  !insertmacro RF_IS_UPDATED $R2
  ${If} $R2 == "0"
    # 1) 备份（默认勾选）：$DOCUMENTS\ResumeForge-backup-YYYYMMDD-HHMM
    ${If} $RFUnBackupData == "1"
      ${If} ${FileExists} "${RF_DATA_DIR}\*.*"
        ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
        StrCpy $RFUnBackupDir "$DOCUMENTS\ResumeForge-backup-$2$1$0-$3$4"
        CreateDirectory "$RFUnBackupDir"
        StrCpy $RFUSrc "${RF_DATA_DIR}"
        StrCpy $RFUDst "$RFUnBackupDir"
        StrCpy $RFUCopyFailed "0"
        Push ""
        Call un.rfCopyTree
        Pop $R0
        ${If} $RFUCopyFailed == "1"
          # 备份不完整时不删数据：宁可留着，也不给用户"备份了但缺文件"的错觉。
          StrCpy $RFUnDeleteData "0"
          !insertmacro RF_LOG "uninstall backup INCOMPLETE: $RFUnBackupDir"
          MessageBox MB_ICONEXCLAMATION|MB_OK "$(RF_BACKUP_FAILED)$RFLogFile"
        ${Else}
          !insertmacro RF_LOG "uninstall backup: $RFUnBackupDir"
          FileOpen $9 "$RFUnBackupDir\README.txt" w
          FileWrite $9 "ResumeForge data backup$\r$\n"
          FileWrite $9 "source: ${RF_DATA_DIR}$\r$\n"
          FileWrite $9 "Reinstall ResumeForge, then copy this folder's contents back into the data directory the app shows.$\r$\n"
          FileClose $9
        ${EndIf}
      ${EndIf}
    ${EndIf}

    # 2) 删除数据（默认不勾）：两个目录都在用户目录下，删之前已由页面二次确认。
    ${If} $RFUnDeleteData == "1"
      !insertmacro RF_LOG "uninstall delete data: ${RF_DATA_DIR} + ${RF_RUNTIME_DIR}"
      RMDir /r "${RF_DATA_DIR}"
      RMDir /r "$APPDATA\ResumeForge\payload-legacy-rescue"
      RMDir /r "${RF_RUNTIME_DIR}"
      RMDir "$APPDATA\ResumeForge"
      RMDir "$LOCALAPPDATA\ResumeForge"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  !insertmacro RF_UNINSTALL_FINISH
!macroend

# ----------------------------------------------------------------------------
# 清理结果页（WF-08 #6 / #8）：三类残留 + 大小 + 逐条可打开；删不掉时可重试。
# ----------------------------------------------------------------------------
!macro customUninstallPage
  UninstPage custom un.rfResiduePageShow un.rfResiduePageLeave
!macroend

Function un.rfPathSize
  # 入参 $R7 = 路径；出参 $R8 = 人类可读大小（不存在时给"已删除"）
  ${IfNot} ${FileExists} "$R7\*.*"
    StrCpy $R8 "$(RF_RESIDUE_NONE)"
    Return
  ${EndIf}
  ${un.GetSize} "$R7" "/S=0K" $R9 $R3 $R4
  ${If} $R9 >= 1024
    IntOp $R9 $R9 / 1024
    StrCpy $R8 "$R9 MB"
  ${Else}
    StrCpy $R8 "$R9 KB"
  ${EndIf}
FunctionEnd

# ----------------------------------------------------------------------------
# 安装目录里还剩不剩"别人的"文件（$R6 = "1" 还有 / "0" 已经干净）。
#
# 为什么要这个函数：`_?=<dir>` 模式下卸载器**就地**从 $INSTDIR 运行，那份
# `Uninstall ResumeForge.exe` 正在被执行，Windows 不允许删除运行中的镜像 —— 于是
# 目录永远不会真正变空。旧判据只看 `IfFileExists "$INSTDIR\*.*"`，会把它当成
# "有文件未能删除"，最多重试 3 次后显示失败页；而 installUtil.nsh 正是拿退出码
# 判断旧卸载器成败 → 升级被卡住。**成功不能报成失败**，所以这里把"只剩卸载器
# 自己"归为干净。
# ----------------------------------------------------------------------------
Function un.rfHasForeignEntries
  # 用**本进程的镜像名**判断，而不是 `${UNINSTALL_FILENAME}`：那个常量在 common.nsh
  # 里才有定义，而本文件被 electron-builder 放在生成脚本最顶部（早于 common.nsh），
  # 函数是就地编译的，写常量会直接 warning 6000 → -WX 打包失败（2026-11-2x 实测）。
  # $EXEPATH 在 `_?=` 就地模式下正好是 "$INSTDIR\<卸载器>.exe"，非就地模式下在
  # %TEMP%，此时 $INSTDIR 里那份同名文件若还在就**是**残留，判据依旧正确。
  ${GetFileName} "$EXEPATH" $R8
  StrCpy $R6 "0"
  FindFirst $R5 $R7 "$INSTDIR\*.*"
  un_rf_foreign_loop:
    StrCmp $R7 "" un_rf_foreign_done
    StrCmp $R7 "." un_rf_foreign_next
    StrCmp $R7 ".." un_rf_foreign_next
    StrCmp $R7 "$R8" un_rf_foreign_next
    StrCpy $R6 "1"
    !insertmacro RF_LOG "uninstall residue: $R7"
    Goto un_rf_foreign_done
  un_rf_foreign_next:
    FindNext $R5 $R7
    Goto un_rf_foreign_loop
  un_rf_foreign_done:
  FindClose $R5
FunctionEnd

Function un.rfResiduePageShow
  # 删不掉时先问一次要不要重试（WF-08 #8：重试 / 关掉占用程序后重试）。
  # 用原生标签循环而不是 `Goto` 回本函数名：NSIS 的 Goto 只认**标签**，
  # `Goto un.rfResiduePageShow` 会报 "could not resolve label ... in function ..."
  # （实测 2026-11-19 makensis 原文）；回跳进 LogicLib 的 ${If} 块同样非法。
  un_rf_residue_prompt:
  IntCmp $RFUnRetryCount 3 un_rf_residue_measured
  Call un.rfHasForeignEntries
  StrCmp $R6 "1" 0 un_rf_residue_measured
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(RF_RETRY_TITLE)$\r$\n$\r$\n$(RF_RETRY_TEXT)" IDRETRY un_rf_residue_retry
  Goto un_rf_residue_measured
  un_rf_residue_retry:
  IntOp $RFUnRetryCount $RFUnRetryCount + 1
  !insertmacro RF_LOG "uninstall retry $RFUnRetryCount: RMDir $INSTDIR"
  ClearErrors
  RMDir /r "$INSTDIR"
  Goto un_rf_residue_prompt
  un_rf_residue_measured:

  # 退出码要说真话（installUtil.nsh 拿它判断升级能否继续）：
  #   只剩卸载器自己（或目录已空）→ 0；仍有别人的文件 → 7，并把条目写进日志。
  # 静默路径（/S，自动更新）不经过页面，退出码保持 NSIS 的默认值：正常结束为 0，
  # 模板里 `Abort` 掉的分支非 0 —— 这里不去覆盖它，免得把失败"擦"成成功。
  Call un.rfHasForeignEntries
  ${If} $R6 == "1"
    !insertmacro RF_LOG "uninstall finished with residue: $INSTDIR"
    SetErrorLevel 7
  ${Else}
    !insertmacro RF_LOG "uninstall clean: $INSTDIR"
    SetErrorLevel 0
  ${EndIf}

  nsDialogs::Create 1018
  Pop $RFPage
  ${If} $RFPage == error
    Abort
  ${EndIf}
  StrCpy $1 "$(RF_RESIDUE_TITLE)"
  StrCpy $2 "$(RF_UNFINISH_TEXT)"
  Call un.rfDrawTitle

  StrCpy $R7 "$INSTDIR"
  Call un.rfPathSize
  StrCpy $RFResidueInstall "$R8"

  StrCpy $R7 "${RF_DATA_DIR}"
  Call un.rfPathSize
  StrCpy $RFResidueData "$R8"

  StrCpy $R7 "${RF_RUNTIME_DIR}"
  Call un.rfPathSize
  StrCpy $RFResidueRuntime "$R8"

  ${NSD_CreateLabel} 0 64u 70% 12u "1. $INSTDIR - $RFResidueInstall"
  Pop $0
  ${NSD_CreateButton} 74% 62u 26% 13u "$(RF_RESIDUE_OPEN)"
  Pop $0
  ${NSD_OnClick} $0 un.rfOpenInstallDir

  ${NSD_CreateLabel} 0 82u 70% 12u "2. ${RF_DATA_DIR} - $RFResidueData"
  Pop $0
  ${NSD_CreateButton} 74% 80u 26% 13u "$(RF_RESIDUE_OPEN)"
  Pop $0
  ${NSD_OnClick} $0 un.rfOpenDataDir

  ${NSD_CreateLabel} 0 100u 70% 12u "3. ${RF_RUNTIME_DIR} - $RFResidueRuntime"
  Pop $0
  ${NSD_CreateButton} 74% 98u 26% 13u "$(RF_RESIDUE_OPEN)"
  Pop $0
  ${NSD_OnClick} $0 un.rfOpenRuntimeDir

  ${NSD_CreateLabel} 0 124u 100% 34u "$(RF_UNFINISH_TEXT)"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.rfOpenInstallDir
  ExecShell "open" "$INSTDIR"
FunctionEnd

Function un.rfOpenRuntimeDir
  ExecShell "open" "${RF_RUNTIME_DIR}"
FunctionEnd

Function un.rfResiduePageLeave
FunctionEnd

!endif

