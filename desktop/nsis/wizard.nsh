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

# 可执行文件名一律写 `${PRODUCT_FILENAME}.exe`（与模板 common.nsh 同源）。
# 不用 APP_EXECUTABLE_FILENAME：它只在 common.nsh 里定义，而本文件的宏有插入点早于
# 那次 define，实测会命中 warning 6000 "unknown variable/constant ..."，打包用 -WX
# （警告即错误）会直接失败。PRODUCT_FILENAME 是命令行 -D，任何位置都可用。

# 安装盘与系统盘的最低剩余空间（MB）。当前包体解压后约 360 MB，留 ~3 倍余量：
# 首启还要把运行时解压到 %LOCALAPPDATA%，300 MB 边缘的机器装上也跑不起来。
!define RF_MIN_FREE_MB 1200

# 应用数据 / 运行时的固定位置（ADR-0004），安装器只读不写，卸载器按用户选择删。
!define RF_DATA_DIR "$APPDATA\ResumeForge\data"
!define RF_RUNTIME_DIR "$LOCALAPPDATA\ResumeForge\runtime"

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
      FileWrite $R9 "${MSG}$\r$\n"
      FileClose $R9
    ${EndIf}
  ${EndIf}
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

# customInit 的第一段：开日志 → 读出已有安装 → 定默认值 → 升级备份。
!macro RF_INSTALL_INIT
  StrCpy $RFLogFile "$TEMP\ResumeForge-Setup.log"
  FileOpen $9 "$RFLogFile" w
  FileWrite $9 "=== ResumeForge setup ===$\r$\n"
  FileWrite $9 "exe=$EXEPATH$\r$\n"
  FileWrite $9 "instdir=$INSTDIR$\r$\n"
  FileClose $9

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

  !insertmacro RF_LOG "install done: version=${VERSION} repair=$RFRepairMode"
!macroend

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
  StrCpy $RFLogFile "$TEMP\ResumeForge-Setup.log"
  StrCpy $RFUnDeleteData "0"
  StrCpy $RFUnBackupData "1"
  StrCpy $RFUnBackupDir ""
  StrCpy $RFUnRetryCount "0"
  StrCpy $RFNeedRetry "0"
  !insertmacro RF_LOG "=== ResumeForge uninstall === instdir=$INSTDIR"
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
    !insertmacro RF_LOG "backup copy failed: $R7\$R6"

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

Function un.rfResiduePageShow
  # 删不掉时先问一次要不要重试（WF-08 #8：重试 / 关掉占用程序后重试）。
  # 用原生标签循环而不是 `Goto` 回本函数名：NSIS 的 Goto 只认**标签**，
  # `Goto un.rfResiduePageShow` 会报 "could not resolve label ... in function ..."
  # （实测 2026-11-19 makensis 原文）；回跳进 LogicLib 的 ${If} 块同样非法。
  un_rf_residue_prompt:
  IntCmp $RFUnRetryCount 3 un_rf_residue_measured
  IfFileExists "$INSTDIR\*.*" 0 un_rf_residue_measured
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(RF_RETRY_TITLE)$\r$\n$\r$\n$(RF_RETRY_TEXT)" IDRETRY un_rf_residue_retry
  Goto un_rf_residue_measured
  un_rf_residue_retry:
  IntOp $RFUnRetryCount $RFUnRetryCount + 1
  !insertmacro RF_LOG "uninstall retry $RFUnRetryCount: RMDir $INSTDIR"
  ClearErrors
  RMDir /r "$INSTDIR"
  Goto un_rf_residue_prompt
  un_rf_residue_measured:

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

