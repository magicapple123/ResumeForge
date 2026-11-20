# ============================================================================
# 旧版数据抢救（payload-era 用户数据 → 升级后交回应用迁移）
#
# 背景：最早发布的 Windows 安装版（ResumeForge-Setup-0.18.0.exe）还没有
# RF_DATA_DIR（ADR-0004），用户的数据库、附件、备份都写在**安装目录**的
# resources\payload\backend\data 里。NSIS 原地升级会先调用**旧版卸载器**
# （/S /KEEP_APP_DATA --updated），而旧卸载器会把整个安装目录搬进临时目录再删除
# ——用户数据在"新壳的迁移逻辑还没机会运行"之前就已经没了。
#
# 因此新安装器必须在调用旧卸载器**之前**先把这份数据复制到自己的 $PLUGINSDIR，
# 安装完成后再放回**新** payload 的 backend\data，然后交给应用既有的 ADR-0004
# 迁移流程（首次启动弹窗确认 → 备份 → 一致性快照 → 校验 → 标记）搬到
# %APPDATA%\ResumeForge\data。安装器不替用户做迁移决定，只保证数据不丢。
#
# 安全边界：
#   * 旧位置没有 resume_forge.db 时什么都不做（全新安装空转）；
#   * 旧位置带 migrated-away.json（应用在迁移成功后写入）时不抢救——这份副本只是
#     留档，活跃数据已在用户目录里。判据只用安装目录内的文件，不去猜 userData 路径；
#   * 应用必须在退出状态——复制一份正在写入的 SQLite 库是撕裂拷贝。等待它退出，
#     超时就中止安装并提示（中止 = 旧数据原样保留）；
#   * 复制逐文件校验字节数，任何不一致都中止安装（宁可装不上，不可丢数据）；
#   * 只往新 payload 的 data 目录里放，且目标已有库时绝不覆盖。
#
# 这个 include 同时会被编译进卸载器（electron-builder 把自定义 include 放在
# 共享头部里），整文件用 BUILD_UNINSTALLER 包住，只编进安装器。
# ============================================================================

!include "LogicLib.nsh"

# ----------------------------------------------------------------------------
# 快捷方式名（electron-builder.yml 的 nsis.shortcutName: "$(RF_SHORTCUT)"）
#
# 为什么定义在这里：LangString 必须在 `!insertmacro addLangs` 之后定义，否则 NSIS
# 报 "language not loaded"；而本文件被 electron-builder 放在生成脚本最顶部（早于
# MUI2 与 addLangs），只有 customHeader 宏会被展开在 addLangs 之后
# （installer.nsi: `!insertmacro addLangs` → `!ifmacrodef customHeader`）。
# 反过来也不能在这里自己 LoadLanguageFile：那会与后面的 MUI_LANGUAGE 撞车，实测报
# `Error: can't load same language file twice`。
#
# 为什么 26 种语言全量列出：electron-builder 26.17.0 在未配置 installerLanguages 时
# 默认打包全部 26 种（app-builder-lib/out/util/langs.js 的 bundledLanguages），而未
# 定义的语言在运行期会解析成**空字符串**——实测把 $LANGUAGE 置成 1031 时
# $(RF_SHORTCUT) 为空，快捷方式会变成 ".lnk"。非中文一律 ResumeForge，所以这些
# 条目看起来"重复"，但一条都不能省。⚠️ 将来收窄 installerLanguages 时要同步收窄
# 这份列表。
#
# 为什么放在"只编进安装器"那个守卫外面：卸载器也会调用 setLinkVars 计算快捷方式
# 路径（templates/nsis/uninstaller.nsh），那一趟同样要能解析 $(RF_SHORTCUT)。
# ----------------------------------------------------------------------------
!macro customHeader
  LangString RF_SHORTCUT 1033 "ResumeForge"  ; en_US
  LangString RF_SHORTCUT 1031 "ResumeForge"  ; de_DE
  LangString RF_SHORTCUT 1036 "ResumeForge"  ; fr_FR
  LangString RF_SHORTCUT 3082 "ResumeForge"  ; es_ES
  LangString RF_SHORTCUT 2052 "简历通"       ; zh_CN
  LangString RF_SHORTCUT 1028 "简历通"       ; zh_TW
  LangString RF_SHORTCUT 1041 "ResumeForge"  ; ja_JP
  LangString RF_SHORTCUT 1042 "ResumeForge"  ; ko_KR
  LangString RF_SHORTCUT 1040 "ResumeForge"  ; it_IT
  LangString RF_SHORTCUT 1043 "ResumeForge"  ; nl_NL
  LangString RF_SHORTCUT 1030 "ResumeForge"  ; da_DK
  LangString RF_SHORTCUT 1053 "ResumeForge"  ; sv_SE
  LangString RF_SHORTCUT 1044 "ResumeForge"  ; nb_NO
  LangString RF_SHORTCUT 1035 "ResumeForge"  ; fi_FI
  LangString RF_SHORTCUT 1049 "ResumeForge"  ; ru_RU
  LangString RF_SHORTCUT 2070 "ResumeForge"  ; pt_PT
  LangString RF_SHORTCUT 1046 "ResumeForge"  ; pt_BR
  LangString RF_SHORTCUT 1045 "ResumeForge"  ; pl_PL
  LangString RF_SHORTCUT 1058 "ResumeForge"  ; uk_UA
  LangString RF_SHORTCUT 1029 "ResumeForge"  ; cs_CZ
  LangString RF_SHORTCUT 1051 "ResumeForge"  ; sk_SK
  LangString RF_SHORTCUT 1038 "ResumeForge"  ; hu_HU
  LangString RF_SHORTCUT 1025 "ResumeForge"  ; ar_SA
  LangString RF_SHORTCUT 1055 "ResumeForge"  ; tr_TR
  LangString RF_SHORTCUT 1054 "ResumeForge"  ; th_TH
  LangString RF_SHORTCUT 1066 "ResumeForge"  ; vi_VN

  # 向导文案（WF-07/08）：同样必须在 addLangs 之后定义，见 wizard.nsh 顶部说明。
  !insertmacro RF_WIZARD_LANGS
!macroend

!ifndef BUILD_UNINSTALLER

# 模板里的 allowOnlyOneInstallerInstance.nsh 也 include 同一个文件（带同样的守卫），
# 谁先编到都只会生效一次。
!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

!define RF_LEGACY_RELATIVE "resources\payload\backend\data"
!define RF_RESCUE_DIRNAME "payload-legacy-rescue"

Var /GLOBAL RFOldDataDir
Var /GLOBAL RFRescueRoot
Var /GLOBAL RFRescueDir
Var /GLOBAL RFRescueState
Var /GLOBAL RFSrc
Var /GLOBAL RFDst
Var /GLOBAL RFSrcBytes
Var /GLOBAL RFDstBytes
# RF_WAIT_APP_EXIT_SOFT 的出参："1" 应用还在跑 / "0" 已退出。
# 与 RF_WaitForAppExit 的区别只有超时后的动作（见那个宏的注释）。
Var /GLOBAL RFAppStillRunning

# 诊断通道：只在调用方定义 RF_DIAG_LOG 时编译进去（生产安装包不定义，产物里没有
# 这段代码）。复制失败时逐条记录"哪个文件、哪一步失败"，供测试装置与排障使用——
# 2026-10-14 首次演练只看到"校验失败"四个字，定位真实原因花了好几轮往返。
!macro RF_DIAG MSG
  !ifdef RF_DIAG_LOG
    FileOpen $R8 "${RF_DIAG_LOG}" a
    # 与 RF_LOG 同一个坑：末尾不 seek，每条都会覆盖第一条。诊断通道丢行等于没开。
    FileSeek $R8 0 END
    FileWrite $R8 "${MSG}$\r$\n"
    FileClose $R8
  !endif
!macroend

# 递归复制 $RFSrc\$R9 -> $RFDst\$R9（目录不存在则创建），逐文件比对字节数。
# 任何一次比对失败都把 $RFRescueState 置为 failed（不提前返回，尽量多搬）。
# 栈参数：相对子目录（根为 ""）。
Function RF_CopyTree
  Exch $R9
  Push $R8
  Push $R7
  Push $R6
  Push $R5
  Push $R4
  Push $R3
  Push $R2
  Push $R1

  # 相对目录前缀不带前导/尾随分隔符（根为 ""），只在这里拼一次路径：
  # 绝不能让路径里出现双反斜杠——CopyFiles 对 "...\data\\user_files\x" 这种
  # 路径直接置错误位（2026-10-14 用 makensis 装置实测），根级文件恰好因为
  # "...\data\\file" 的形态不同而侥幸通过，排查时极具误导性。
  StrCmp $R9 "" 0 rf_paths_nested
    StrCpy $R1 "$RFSrc"
    StrCpy $R2 "$RFDst"
    Goto rf_paths_done
  rf_paths_nested:
    StrCpy $R1 "$RFSrc\$R9"
    StrCpy $R2 "$RFDst\$R9"
  rf_paths_done:
  CreateDirectory "$R2"

  FindFirst $R3 $R4 "$R1\*.*"
  rf_copy_loop:
    StrCmp $R4 "" rf_copy_done
    StrCmp $R4 "." rf_copy_next
    StrCmp $R4 ".." rf_copy_next

    # 目录判定不能用 IfFileExists "<路径>\*.*"：**空目录**在它眼里"不存在"，会被当成
    # 文件去 FileOpen 而失败（演练实测：data/exports 是空目录，抢救因此中止）。
    # 对条目做一次 FindFirst：目录（哪怕空的）会先返回 "."，文件则什么都匹配不到。
    FindFirst $R5 $R6 "$R1\$R4\*.*"
    StrCmp $R6 "" rf_copy_file
    FindClose $R5
    StrCmp $R9 "" 0 rf_push_nested
      Push "$R4"
      Goto rf_push_done
    rf_push_nested:
      Push "$R9\$R4"
    rf_push_done:
    Call RF_CopyTree
    Pop $R8
    Goto rf_copy_next

  rf_copy_file:
    ClearErrors
    FileOpen $R5 "$R1\$R4" r
    IfErrors rf_copy_open_src_failed
    FileSeek $R5 0 END $R6
    FileClose $R5
    IntOp $RFSrcBytes $RFSrcBytes + $R6

    ClearErrors
    CopyFiles /SILENT "$R1\$R4" "$R2\$R4"
    IfErrors rf_copy_copyfiles_failed

    ClearErrors
    FileOpen $R5 "$R2\$R4" r
    IfErrors rf_copy_open_dst_failed
    FileSeek $R5 0 END $R7
    FileClose $R5
    IntOp $RFDstBytes $RFDstBytes + $R7
    StrCmp $R6 $R7 rf_copy_next rf_copy_size_failed

  rf_copy_open_src_failed:
    !insertmacro RF_DIAG "open-src failed: $R1\$R4"
    Goto rf_copy_fail
  rf_copy_copyfiles_failed:
    !insertmacro RF_DIAG "copyfiles failed: $R1\$R4"
    Goto rf_copy_fail
  rf_copy_open_dst_failed:
    !insertmacro RF_DIAG "open-dst failed: $R2\$R4"
    Goto rf_copy_fail
  rf_copy_size_failed:
    !insertmacro RF_DIAG "size mismatch: $R1\$R4 src=$R6 dst=$R7"
    Goto rf_copy_fail

  rf_copy_fail:
    StrCpy $RFRescueState "failed"

  rf_copy_next:
    FindNext $R3 $R4
    Goto rf_copy_loop

  rf_copy_done:
  FindClose $R3

  Pop $R1
  Pop $R2
  Pop $R3
  Pop $R4
  Pop $R5
  Pop $R6
  Pop $R7
  Pop $R8
  Exch $R9
FunctionEnd

# 等应用退出（最多 60 秒）。还在跑就中止安装：不动文件是唯一安全的选项。
#
# ⚠️ 不用 nsProcess 插件：它不在 electron-builder 拉下来的 NSIS 插件目录里，实测
# 2026-11-19 报 `Plugin not found, cannot call nsProcess::_FindProcess`（`!addplugindir`
# 指向的 x86-unicode 目录里确实有 nsProcess.dll，但 makensis 只认 NSISDIR 下的默认目录，
# 加插件目录无效）。改用系统自带的 tasklist + find：
# find 命中返回 0、未命中返回 1，不需要解析任何文本。
!macro RF_WaitForAppExit
  StrCpy $R1 0
  rf_wait_loop:
    nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq ${PRODUCT_FILENAME}.exe" /NH | find /I "${PRODUCT_FILENAME}.exe" >nul'
    Pop $R2
    StrCmp $R2 "0" 0 rf_wait_done
    IntOp $R1 $R1 + 1
    IntCmp $R1 60 rf_wait_timeout
    Sleep 1000
    Goto rf_wait_loop
  rf_wait_timeout:
    # 静默（自动更新走 `/S`）时**不能弹框**：更新器用 ExecWait 等这个进程，一个没有
    # 父窗口的模态框会把升级挂死，而且现场没人能点它。改成日志 + DetailPrint +
    # 非 0 退出码（4 = 应用 60 秒内没退出，见 wizard.nsh 的退出码一览）。
    ${If} $RFSilent == "1"
      !insertmacro RF_LOG "app still running after 60s: ${PRODUCT_FILENAME}.exe, aborting (silent)"
      DetailPrint "[ResumeForge] ${PRODUCT_FILENAME}.exe is still running; installation aborted"
      SetErrorLevel 4
      Quit
    ${EndIf}
    ${If} $LANGUAGE == 2052
    ${OrIf} $LANGUAGE == 1028
      MessageBox MB_ICONSTOP|MB_OK "检测到「简历通」正在运行。$\r$\n$\r$\n请先从托盘菜单退出应用，再重新运行安装程序。旧版本的数据会原样保留。"
    ${Else}
      MessageBox MB_ICONSTOP|MB_OK "ResumeForge is still running.$\r$\n$\r$\nQuit it from the tray menu first, then run the installer again. Your old data stays untouched."
    ${EndIf}
    Abort
  rf_wait_done:
!macroend

# ----------------------------------------------------------------------------
# 「应用退出了吗」的**软**版本（Medium 2，2026-11-2x）：桥在真正执行旧卸载器之前
# 必须确认应用已经退出，否则就会在应用运行时删掉它的安装目录 —— 静默升级尤其危险
# （那时应用可能还开着，用户在托盘里根本没点"退出"）。
#
# 为什么不能直接复用 `RF_WaitForAppExit`：那个宏超时之后**中止安装**。它用在旧数据
# 抢救那里是对的（复制一个正在写入的 SQLite 库 = 撕裂拷贝，必须停），但用在"卸旧"
# 这里是错的 —— 卸不掉旧版本只是退化成旧行为，为它把整台安装判死没有必要，而且
# 静默路径一旦 `Quit`，自动更新那一侧看到的就是"升级失败"，用户手里还是老版本。
#
# 所以这一版的超时后果是**放弃卸旧**：
#   * 保留卸载登记（不 DeleteRegKey），交给模板原路径自己按旧逻辑处理；
#   * 安装继续（不清任何状态、不改退出码）；
#   * 日志里写明"应用仍在运行"以及等了多少秒。
#
# 判定方式与 `RF_WaitForAppExit` / `customCheckAppRunning` **完全一致**：tasklist 加
# find，**只按镜像名**。不用路径前缀 —— 那正是 `_?=` 卸载失败（exit 2、一个文件没删）
# 的根因（路径前缀判据在卸载器就地运行时命中它自己）。按镜像名则结构上不可能命中
# 安装器/卸载器自己。
#
# 两档上限：静默 60 秒（没人能在旁边点框）后放弃；交互 10 秒后弹**我们自己的**提示，
# 给「重试 / 跳过这一步」。`/S` 下永不弹框 —— 更新器用 ExecWait 等这个进程。
#
# 出参：$RFAppStillRunning = "1"（还在跑，别卸旧）/ "0"（已退出，可以卸）。
# 全程用裸标签（函数作用域内唯一，本宏每处只展开一次），与 RF_WaitForAppExit 同风格；
# 不用 `${__LINE__}` 拼标签，那个在宏体里是定义行常量，展开两次会撞。
# ----------------------------------------------------------------------------
!macro RF_WAIT_APP_EXIT_SOFT
  StrCpy $RFAppStillRunning "0"
  StrCpy $R1 "0"
  StrCpy $R4 "10"
  StrCmp $RFSilent "1" 0 rf_soft_wait_loop
  StrCpy $R4 "60"

  rf_soft_wait_loop:
    nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq ${PRODUCT_FILENAME}.exe" /NH | find /I "${PRODUCT_FILENAME}.exe" >nul'
    Pop $R2
    StrCmp $R2 "0" 0 rf_soft_wait_exited
    IntOp $R1 $R1 + 1
    IntCmp $R1 $R4 rf_soft_wait_timeout
    Sleep 1000
    Goto rf_soft_wait_loop

  rf_soft_wait_timeout:
    StrCmp $RFSilent "1" 0 rf_soft_wait_ask
      !insertmacro RF_LOG "app still running after $R4s: ${PRODUCT_FILENAME}.exe -> skipping the pre-uninstall (registration kept)"
      StrCpy $RFAppStillRunning "1"
      Goto rf_soft_wait_done

  rf_soft_wait_ask:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(RF_BRIDGE_APP_RUNNING)" IDRETRY rf_soft_wait_retry
      !insertmacro RF_LOG "user skipped the pre-uninstall (app still running)"
      StrCpy $RFAppStillRunning "1"
      Goto rf_soft_wait_done
  rf_soft_wait_retry:
    StrCpy $R1 "0"
    Goto rf_soft_wait_loop

  rf_soft_wait_exited:
    StrCpy $RFAppStillRunning "0"
    !insertmacro RF_LOG "app exited: ${PRODUCT_FILENAME}.exe gone after $R1s, safe to remove the old version"
  rf_soft_wait_done:
!macroend

# ----------------------------------------------------------------------------
# 抢占式卸旧（2026-11-2x，给已经发出去的 2.1.0 补桥）
#
# 2.1.0 的卸载器里编进了一个缺陷：模板 `_CHECK_APP_RUNNING` 按**镜像路径前缀**
# 找进程，而 `_?=<dir>` 模式下卸载器就地运行、路径就在 $INSTDIR 里 → 命中自己 →
# Stop-Process 自己 → 退出码非 0、一个文件没删。那个二进制已经在用户机器上了，
# 改不了，所以新安装器**不把"卸旧"交给 installUtil 的 `_?=` 调用**，自己先跑一遍：
#
#   * **不带 `_?=`**：旧卸载器把自己复制到 %TEMP% 再运行，镜像路径不在 $INSTDIR 里，
#     那个路径前缀判据就不可能命中自己（现场实测：去掉 `_?=` 就 exit 0、卸载正常，
#     而带 `_?=` 是 exit 2 且什么都没删）；
#   * exit 0 → 清掉安装登记，`installUtil.nsh` 的 `uninstallOldVersion` 读不到
#     UninstallString 与 InstallLocation 会直接 return（该文件 178-182 行），
#     后续安装按全新安装走；
#   * 非 0 → **保留**登记键，只写日志，让模板按原样重试 —— 不比今天更差，绝不中止；
#   * **执行旧卸载器之前先确认应用退出了**（Medium 2）。模板的 `CHECK_APP_RUNNING`
#     排在安装段开头（installSection.nsh:33），而桥跑在 `.onInit` 里的 customInit /
#     目录页之后的 rfPrecheck —— 两者都**早于**那次提问。静默升级时应用可能还开着，
#     此时旧卸载器会把 $INSTDIR 整个删掉，删掉的就是那个正在运行的程序。所以等待逻辑
#     见 `RF_WAIT_APP_EXIT_SOFT`：已退出才卸；还在跑就放弃卸旧（保留登记、安装继续）。
#   * 除了那一问（交互模式下会弹**我们自己的**重试/跳过提示），全程不弹框：
#     ExecWait 里的 MessageBox 会把自动更新挂死。
#
# 为什么是 !macro 而不是 Function：`${UNINSTALL_REGISTRY_KEY}` / `${INSTALL_REGISTRY_KEY}`
# 由 `multiUser.nsh` 定义，而本文件被 electron-builder 放在生成脚本**最顶部**（早于
# multiUser.nsh）。Function 是就地编译的，用这些常量会 warning 6000 → -WX 打包失败
# （2026-11-2x 实测，同 `${UNINSTALL_FILENAME}` 那一条）；宏在插入点展开，
# 而插入点 customInit 位于模板 .onInit 之内，那时常量已经定义。
#
# 调用点的三条前置条件（见 customInit 末尾）：
#   1. 必须在**旧数据抢救之后**：旧卸载器会删掉整个 $INSTDIR，payload 时代的数据在里面；
#   2. `$RFRescueState == "ok"`（数据只存在于 $PLUGINSDIR 里）时**不跑**：$PLUGINSDIR
#      是临时目录，用户中途取消安装就没了，而那时旧版本已经被删——这是唯一可能丢数据
#      的组合，所以这一档保持旧行为，交给模板；
#   3. 应用已退出 —— 由宏内部的 RF_WAIT_APP_EXIT_SOFT 现问，不再靠调用方前置。
# ----------------------------------------------------------------------------
!macro RF_PREEMPTIVE_UNINSTALL
  ${If} $RFExistingVersion == ""
    !insertmacro RF_LOG "pre-uninstall: nothing registered, skipped"
  ${ElseIf} $RFRescueState == "ok"
    !insertmacro RF_LOG "pre-uninstall: skipped (legacy data only lives in $PLUGINSDIR)"
  ${Else}
    # 卸载登记读的是 UNINSTALL_REGISTRY_KEY：UninstallString 由 electron-builder 写在
    # 那里（模板 installer.nsh 的 registryAddInstallInfo），installUtil.nsh 也读同一个键。
    # 两个键都由宏拼出（内含 APP_GUID），这里不写死任何 GUID。
    ReadRegStr $R0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ${If} $R0 == ""
      !insertmacro RF_LOG "pre-uninstall: no UninstallString under ${UNINSTALL_REGISTRY_KEY}"
    ${Else}
      # UninstallString **不是纯路径**：electron-builder 写的是 `'"$2" $0'`
      # （include/installer.nsh:122），实际形如
      #     "C:\...\Uninstall ResumeForge.exe" /currentuser
      # 所以不能"只剥首尾引号"——那样得到的是 `...exe" /currentuser`，FileExists
      # 恒假，每次都被误判成悬空登记：删登记键、旧卸载器却压根没跑（QA 实测）。
      # 正确做法：剥掉开引号后**向前扫到闭引号为止**，取中间那一段作为路径。
      # 扫不到闭引号 = 解析失败 → 什么都不做（见下面的分支）。
      StrCpy $R1 "$R0"
      StrCpy $R3 ""
      StrCpy $R2 "$R1" 1
      ${If} $R2 == '"'
        StrCpy $R1 "$R1" "" 1  # 去掉开引号
        StrCpy $R2 0
        ${Do}
          StrCpy $R4 "$R1" 1 $R2
          ${If} $R4 == '"'
            StrCpy $R3 '"'
            ${ExitDo}
          ${EndIf}
          ${If} $R4 == ""
            ${ExitDo}  # 扫到结尾都没有闭引号
          ${EndIf}
          IntOp $R2 $R2 + 1
        ${Loop}
        ${If} $R3 == '"'
          StrCpy $R1 "$R1" $R2  # 闭引号之前的那一段 = 纯路径
        ${Else}
          StrCpy $R1 ""
        ${EndIf}
      ${Else}
        # 未加引号：整串当路径。electron-builder 不会写这种形态，保守处理即可。
        StrCpy $R3 '"'
      ${EndIf}

      # 解析失败一律**不动登记**：路径都没解析出来就删键，等于抹掉一条真实存在的
      # 卸载信息、还卸不掉任何东西（QA 实测过的后果），比不修更糟。
      ${If} $R1 == ""
        !insertmacro RF_LOG "pre-uninstall: cannot parse UninstallString, keeping registration: $R0"
        DetailPrint "[ResumeForge] cannot parse the uninstall command; leaving it to the template"
      ${Else}
        !insertmacro RF_LOG "pre-uninstall: string=$R0 exe=$R1 instdir=$INSTDIR"

        ${IfNot} ${FileExists} "$R1"
          # 悬空登记（解析出的路径确实不存在）：留着它只会让模板再走 5 次重试、
          # 再弹一次 $(appCannotBeClosed) —— 现场用户正是手工清掉登记才装上的。
          !insertmacro RF_LOG "pre-uninstall: uninstaller missing, dropping stale registration"
          DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
          DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
        ${Else}
          # 用 $RFInstallMode 快照而不是 $installMode：后者由 multiUser.nsh 声明，
          # 本宏在 rfPrecheck（header 里编译）里展开时它还不存在（warning 6000）。
          ${If} $RFInstallMode == "all"
            StrCpy $R3 "/allusers"
          ${Else}
            StrCpy $R3 "/currentuser"
          ${EndIf}

          # **没有 `_?=`**：这是本轮根因的开关，见上面的注释，别加回来。
          # `--updated` 保留：它让旧卸载器跳过"用户主动卸载"的默认值（备份/删数据的
          # 那条路径），用户数据在 %APPDATA% 里，不能被一次升级动掉。
          #
          # 但**先确认应用真的退出了**（Medium 2）：模板的 `CHECK_APP_RUNNING` 排在
          # 安装段开头（installSection.nsh:33），而本节所在的 customInit 属 `.onInit`
          # ——也就是说桥、升级备份、旧数据抢救全都跑在"应用是否在运行"被问之前。
          # 静默升级时应用完全可能还开着，此时旧卸载器会把 $INSTDIR 整个删掉，
          # 删的正是那个正在运行的程序的目录。所以这一问放在 ExecWait 之前：
          #   * 已退出 → 照常卸旧；
          #   * 还在跑 → **放弃卸旧**（保留登记、交给模板原路径），安装继续。
          #     "宁可退回旧行为，也不要在应用运行时删它的目录"。
          !insertmacro RF_WAIT_APP_EXIT_SOFT
          ${If} $RFAppStillRunning == "1"
            !insertmacro RF_LOG "pre-uninstall: skipped, app still running (registration kept for the template path)"
            DetailPrint "[ResumeForge] ResumeForge is still running; the previous version is left for the template to remove"
          ${Else}
            ClearErrors
            ExecWait '"$R1" /S $R3 --updated' $R0
            ${If} ${Errors}
              StrCpy $R0 "-1"
            ${EndIf}
            !insertmacro RF_LOG "pre-uninstall: exit=$R0"

            ${If} $R0 == "0"
              # 旧版本真的没了：取消确认（wizard.nsh 的 rfAbortHandler，挂在
              # MUI_CUSTOMFUNCTION_ABORT 上）要按这个标志换一档更重的文案。
              StrCpy $RFOldVersionRemoved "1"
              DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
              DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
              !insertmacro RF_LOG "pre-uninstall: ok, registration cleared"
              # 旧卸载器把 $INSTDIR 整个删掉了（`--updated` 也删目录，只是不删用户数据）。
              # 目录与"当前输出目录"都要重建，否则后面的 File 指令会写进一个不存在的路径 ——
              # 现场那句「不能打开要写入的文件」就长这样。
              ClearErrors
              CreateDirectory "$INSTDIR"
              SetOutPath "$INSTDIR"
              Call rfProbeWritable
              !insertmacro RF_LOG "pre-uninstall: install dir recreated: $INSTDIR probe=$RFProbeState lasterror=$RFProbeError"
            ${Else}
              # 不清登记：交给 installUtil 按原样重试（与今天一致），原因已经在日志里。
              !insertmacro RF_LOG "pre-uninstall: FAILED exit=$R0, keeping registration for the template path"
              DetailPrint "[ResumeForge] previous version could not be removed (exit $R0); falling back to the template uninstall path"
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

# 安装开始前（.onInit，早于 installSection 里对旧卸载器的调用）把旧数据抢救出来。
!macro customInit
  # 第一件事：日志（preInit 已经建过文件，这里幂等，只追加一行 phase）——
  # 2026-11-2x 那次真机安装"连日志都没写出来"，原因就是日志原来排在一串可能
  # 提前退出的步骤之后。环境快照里的 $INSTDIR / $installMode 此刻才由
  # initMultiUser 定好，所以要在 preInit 之外再打一次。
  !insertmacro RF_LOG_OPEN "customInit"
  !insertmacro RF_LOG_ENV

  # $installMode 的**快照**必须在这里就落地，不能等 RF_INSTALL_INIT：下面的写探针
  # 要按安装方式选降级目标（per-machine 不许降到用户目录，Low 1），而 RF_INSTALL_INIT
  # 排在探针之后。（这个变量是我们自己声明的：$installMode 由 multiUser.nsh 声明，
  # 而 rfPrecheck / RF_WRITE_PROBE 会在 header 里就地编译 —— 那里引用它等于
  # warning 6000 → -WX 打包失败。）
  StrCpy $RFInstallMode "$installMode"

  # 第二件事：写探针 + 自动降级。必须早于任何文件落盘（也在下面这次抢救复制之前：
  # 如果 $INSTDIR 写不进去，先把用户数据往一个写不进去的目录里搬只会更难收场）。
  !insertmacro RF_WRITE_PROBE "customInit"

  # 向导侧的开场（已有安装探测 / 修复模式 / 升级前备份）：
  # 它要读 $installMode（initMultiUser 已算好），并且升级备份必须在旧卸载器动手之前完成。
  !insertmacro RF_INSTALL_INIT

  StrCpy $RFRescueState "none"
  StrCpy $RFSrcBytes "0"
  StrCpy $RFDstBytes "0"

  # 旧安装位置以注册表为准（旧卸载器也按它执行）；读不到再退回 $INSTDIR。
  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $R1 "" 0 +2
  StrCpy $R1 "$INSTDIR"
  StrCmp $R1 "" rf_init_done

  StrCpy $RFOldDataDir "$R1\${RF_LEGACY_RELATIVE}"
  IfFileExists "$RFOldDataDir\resume_forge.db" 0 rf_init_done

  # 应用在迁移成功后会往旧目录写 migrated-away.json（lib/data-migration.js）：
  # 有它说明这份 payload 副本只是留档，活跃数据已在用户目录里，不做抢救。
  # 判据只用安装目录内的文件——安装器不去猜应用的 userData 路径：%APPDATA% 下的库
  # 可能属于同机上的另一套安装（演练时正是这样误跳过了一次），而桌面壳还支持
  # --user-data-dir。
  IfFileExists "$RFOldDataDir\migrated-away.json" rf_init_done 0

  !insertmacro RF_WaitForAppExit

  InitPluginsDir
  StrCpy $RFRescueRoot "$PLUGINSDIR\${RF_RESCUE_DIRNAME}"
  StrCpy $RFRescueDir "$RFRescueRoot\data"
  CreateDirectory "$RFRescueDir"

  StrCpy $RFSrc "$RFOldDataDir"
  StrCpy $RFDst "$RFRescueDir"
  Push ""
  Call RF_CopyTree
  Pop $R9

  StrCmp $RFRescueState "failed" 0 rf_init_ok
    # 静默路径不弹框（同上）：日志 + DetailPrint + 退出码 8。
    # 这里必须**真的退出**：数据还在旧安装目录里，继续装下去旧目录会被删掉。
    ${If} $RFSilent == "1"
      !insertmacro RF_LOG "legacy rescue copy FAILED, aborting (silent): from=$RFOldDataDir"
      DetailPrint "[ResumeForge] legacy data could not be copied out of the install directory; installation aborted"
      SetErrorLevel 8
      Quit
    ${EndIf}
    ${If} $LANGUAGE == 2052
    ${OrIf} $LANGUAGE == 1028
      MessageBox MB_ICONSTOP|MB_OK "旧版本的数据保存在安装目录内，但复制到临时目录时校验失败（常见原因：磁盘空间不足或权限受限）。$\r$\n$\r$\n为避免数据丢失，安装已中止；旧版本数据保持原样，未做任何改动。"
    ${Else}
      MessageBox MB_ICONSTOP|MB_OK "The old data is still in the install directory, but copying it to a temporary folder failed verification (usually a full disk or restricted permissions).$\r$\n$\r$\nTo avoid data loss the installation was cancelled; the old data stays exactly as it was."
    ${EndIf}
    Abort

  rf_init_ok:
  StrCpy $RFRescueState "ok"
  FileOpen $R1 "$RFRescueRoot\rescue-info.txt" w
  FileWrite $R1 "from=$RFOldDataDir$\r$\nbytes=$RFDstBytes$\r$\n"
  FileClose $R1
  DetailPrint "legacy payload data rescued: $RFDstBytes bytes"

  rf_init_done:

  # 抢救已经落定，才轮到"先把旧版本自己卸掉"（旧卸载器会删 $INSTDIR，顺序反了就丢数据）。
  # 它只在"登记着旧版本、且旧数据不在 $PLUGINSDIR 里"时真的动手，其余情况只写一行日志。
  #
  # **静默模式才在这里跑（Medium 3）**：静默没有页面，不在这里做就没有第二次机会。
  # 交互模式挪到 rfPrecheck（目录页之后、INSTFILES 之前的最后一站）——customInit 早于
  # 目录页，此时用户还能改目录、还能取消；在"还能取消"的时点就把旧版本删掉、把卸载
  # 登记清掉，用户一取消，磁盘上旧程序没了、Add/Remove 里 0 条记录，比不装更糟。
  ${If} $RFSilent == "1"
    !insertmacro RF_PREEMPTIVE_UNINSTALL
  ${Else}
    !insertmacro RF_LOG "pre-uninstall: interactive run, deferred to the tasks page (after the dir page)"
  ${EndIf}
!macroend

# 安装完成（新 payload 已就位）后把数据放回应用的旧数据位置，让首次启动的
# ADR-0004 迁移照常识别并搬到用户目录。目标已有库时不覆盖。
!macro customInstall
  StrCmp $RFRescueState "ok" 0 rf_install_done
  IfFileExists "$INSTDIR\${RF_LEGACY_RELATIVE}\resume_forge.db" rf_restore_done 0

  CreateDirectory "$INSTDIR\${RF_LEGACY_RELATIVE}"
  StrCpy $RFSrc "$RFRescueDir"
  StrCpy $RFDst "$INSTDIR\${RF_LEGACY_RELATIVE}"
  StrCpy $RFSrcBytes "0"
  StrCpy $RFDstBytes "0"
  Push ""
  Call RF_CopyTree
  Pop $R9

  IfFileExists "$INSTDIR\${RF_LEGACY_RELATIVE}\resume_forge.db" 0 rf_restore_failed
  StrCmp $RFRescueState "failed" rf_restore_failed rf_restore_done

  rf_restore_failed:
    # 极端情况（放回失败）：把抢救副本保留在用户目录下并明确告知，绝不静默丢弃。
    StrCpy $R1 "$APPDATA\${PRODUCT_NAME}\${RF_RESCUE_DIRNAME}"
    CreateDirectory "$R1"
    StrCpy $RFSrc "$RFRescueDir"
    StrCpy $RFDst "$R1\data"
    StrCpy $RFSrcBytes "0"
    StrCpy $RFDstBytes "0"
    Push ""
    Call RF_CopyTree
    Pop $R9
    # 静默路径不弹框：数据在 $R1 里，落日志 + DetailPrint 就够；退出码 9 让更新器
    # 的后台对账知道"这次升级没把旧数据放回原位"。**不 Quit**——程序本身装好了，
    # 为了几条数据把整个安装判死只会让用户连应用都用不上。
    ${If} $RFSilent == "1"
      !insertmacro RF_LOG "legacy restore FAILED, data preserved at $R1 (silent)"
      DetailPrint "[ResumeForge] legacy data preserved at $R1"
      SetErrorLevel 9
    ${Else}
      ${If} $LANGUAGE == 2052
      ${OrIf} $LANGUAGE == 1028
        MessageBox MB_ICONEXCLAMATION|MB_OK "旧版本的数据未能放回应用数据位置，已完整保留在：$\r$\n$R1$\r$\n$\r$\n应用首次启动后，请把该目录里的内容复制到应用提示的位置，或联系维护者协助处理。"
      ${Else}
        MessageBox MB_ICONEXCLAMATION|MB_OK "The old data could not be put back where the app expects it. It is fully preserved at:$\r$\n$R1$\r$\n$\r$\nAfter the app has started once, copy that folder's contents to the location it asks for, or contact the maintainer for help."
      ${EndIf}
    ${EndIf}

  rf_restore_done:
  rf_install_done:

  # 向导侧收尾：按用户勾选收拾快捷方式、写/清开机自启、落安装日志。
  !insertmacro RF_INSTALL_FINISH

  # 最后一步：装完自检（缺文件就非 0 退出，绝不"假装成功"）。
  !insertmacro RF_INSTALL_SELFCHECK
!macroend

!endif

# 向导（WF-07/08）与卸载器页面：同一份脚本里编译，见 wizard.nsh 顶部说明。
# 放在安装器守卫之外——卸载器那一趟会整段跳过守卫，卸载器自己的页面必须编进去。
# `${__FILEDIR__}` 不带尾部反斜杠（NSIS 的既有约定），拼接时必须补一个 `\`，
# 否则会去找 "<desktop>\nsiswizard.nsh" 并直接 abort（实测 2026-11-19 makensis 原文）。
!include "${__FILEDIR__}\wizard.nsh"
