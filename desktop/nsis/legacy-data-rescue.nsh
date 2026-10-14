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

# 诊断通道：只在调用方定义 RF_DIAG_LOG 时编译进去（生产安装包不定义，产物里没有
# 这段代码）。复制失败时逐条记录"哪个文件、哪一步失败"，供测试装置与排障使用——
# 2026-10-14 首次演练只看到"校验失败"四个字，定位真实原因花了好几轮往返。
!macro RF_DIAG MSG
  !ifdef RF_DIAG_LOG
    FileOpen $R8 "${RF_DIAG_LOG}" a
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
!macro RF_WaitForAppExit
  StrCpy $R1 0
  rf_wait_loop:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R2
    StrCmp $R2 "0" 0 rf_wait_done
    IntOp $R1 $R1 + 1
    IntCmp $R1 60 rf_wait_timeout
    Sleep 1000
    Goto rf_wait_loop
  rf_wait_timeout:
    MessageBox MB_ICONSTOP|MB_OK "检测到「简历通」正在运行。$\r$\n$\r$\n请先从托盘菜单退出应用，再重新运行安装程序。旧版本的数据会原样保留。"
    Abort
  rf_wait_done:
!macroend

# 安装开始前（.onInit，早于 installSection 里对旧卸载器的调用）把旧数据抢救出来。
!macro customInit
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
    MessageBox MB_ICONSTOP|MB_OK "旧版本的数据保存在安装目录内，但复制到临时目录时校验失败（常见原因：磁盘空间不足或权限受限）。$\r$\n$\r$\n为避免数据丢失，安装已中止；旧版本数据保持原样，未做任何改动。"
    Abort

  rf_init_ok:
  StrCpy $RFRescueState "ok"
  FileOpen $R1 "$RFRescueRoot\rescue-info.txt" w
  FileWrite $R1 "from=$RFOldDataDir$\r$\nbytes=$RFDstBytes$\r$\n"
  FileClose $R1
  DetailPrint "legacy payload data rescued: $RFDstBytes bytes"

  rf_init_done:
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
    MessageBox MB_ICONEXCLAMATION|MB_OK "旧版本的数据未能放回应用数据位置，已完整保留在：$\r$\n$R1$\r$\n$\r$\n应用首次启动后，请把该目录里的内容复制到应用提示的位置，或联系维护者协助处理。"

  rf_restore_done:
  rf_install_done:
!macroend

!endif
