// SPDX-License-Identifier: Apache-2.0
"use strict";

// 向导脚本的两条"旧账"守卫（2026-11-2x 复盘 Medium 3 残余 / Nit）：
//
//   1. 进度页取消：交互模式的桥在目录页之后就把旧版本删掉了，而新的卸载登记要等到
//      section 末尾才写（installSection.nsh:67 的 registryAddInstallInfo）。用户这时
//      点取消，磁盘上旧程序没了、Add/Remove 里 0 条记录 —— **还原旧版本做不到**，
//      能做的是说清后果并留下可核对的日志。
//   2. `un.rfCopyTree` 用 $R9 传递归参数，而 `RF_LOG` 内部也拿 $R9 当文件句柄：
//      一次复制失败写过日志之后，递归会拼出垃圾路径（备份目录静默缺一层）。
//
// 这些是文本守卫：`.nsh` 只在打包时编译，CI 的 desktop-shell 作业随后真的打一次包，
// 语法错/警告（-WX）在那里暴露。断言只钉"改回去就必须变红"的实现细节。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const DESKTOP = path.join(__dirname, "..");
const NSIS = path.join(DESKTOP, "nsis");
const WIZARD_PATH = path.join(NSIS, "wizard.nsh");
const RESCUE_PATH = path.join(NSIS, "legacy-data-rescue.nsh");

function readWizard() {
  return fs.readFileSync(WIZARD_PATH, "utf8");
}

function readRescue() {
  return fs.readFileSync(RESCUE_PATH, "utf8");
}

function code(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function functionBody(source, name) {
  const at = source.indexOf(`Function ${name}`);
  assert.ok(at >= 0, `Function ${name} must exist`);
  return source.slice(at, source.indexOf("FunctionEnd", at));
}

// ------------------------------- Medium 3 残余：进度页取消要有明确的后果说明

test("cancelling on the progress page says what it costs", () => {
  const wizard = code(readWizard());
  const body = functionBody(wizard, "rfAbortHandler");

  // 1) 必须真的有一条本地自定义的取消处理（不是 MUI 那句通用文案）。
  const raw = readWizard();
  assert.match(
    raw,
    /^!define MUI_CUSTOMFUNCTION_ABORT "rfAbortHandler"$/m,
    "the handler must be wired through MUI's documented abort hook",
  );
  assert.match(raw, /^Function rfAbortHandler$/m, "the install must own its abort handler");
  // MUI2 的 MUI_FUNCTION_ABORTWARNING **无条件**定义 `.onUserAbort`（Interface.nsh:325），
  // 自己再定义一遍就是 "Function named .onUserAbort already exists" —— 2026-11-2x 实测
  // 打包直接失败。同理不许打开 MUI_ABORTWARNING：那会再插一个通用确认框进来。
  assert.doesNotMatch(raw, /^Function \.onUserAbort$/m, "MUI2 already defines .onUserAbort");
  assert.doesNotMatch(code(raw), /define MUI_ABORTWARNING/, "MUI_ABORTWARNING would add a second box with generic copy");

  // 2) 日志：$INSTDIR + 旧版本有没有被删 + 复制到哪一步。三者缺一，事后都无法判断
  //    "用户取消时到底处于什么状态"。
  assert.match(
    body,
    /RF_LOG "abort requested: instdir=\$INSTDIR old_version_removed=\$RFOldVersionRemoved files_copied=\$R1 silent=\$RFSilent"/,
    "the abort must be logged with the install dir, the bridge flag and the copy progress",
  );
  assert.match(
    body,
    /\$\{If\} \$\{FileExists\} "\$INSTDIR\\resources\\payload\\backend\\app\\main\.py"[\s\S]*?StrCpy \$R1 "1"/,
    "copy progress is judged by the new payload being on disk",
  );

  // 3) 两档文案，按"旧版本还在不在"选；且都必须能让用户读到"重新运行安装程序"。
  assert.match(body, /StrCpy \$R2 "\$\(RF_ABORT_PLAIN\)"/, "the neutral copy must be the default");
  assert.match(
    body,
    /\$\{If\} \$RFOldVersionRemoved == "1"\s*\n\s*StrCpy \$R2 "\$\(RF_ABORT_AFTER_UNINSTALL\)"/,
    "the stronger copy must be chosen once the bridge has removed the old version",
  );
  for (const name of ["RF_ABORT_AFTER_UNINSTALL", "RF_ABORT_PLAIN"]) {
    const defined = new RegExp(`!insertmacro RF_STR ${name} \\\\\\r?\\n\\s*"([^"]*)" \\\\\\r?\\n\\s*"([^"]*)"`).exec(raw);
    assert.ok(defined, `${name} must be defined through RF_STR (26 languages, zh + en)`);
    assert.ok(defined[1].trim().length > 0, `${name} needs Chinese copy`);
    assert.ok(defined[2].trim().length > 0, `${name} needs English copy`);
  }
  const after = /!insertmacro RF_STR RF_ABORT_AFTER_UNINSTALL \\\r?\n\s*"([^"]*)"/.exec(raw);
  assert.ok(after, "RF_ABORT_AFTER_UNINSTALL must be a plain LangString entry");
  assert.match(after[1], /重新运行安装程序/, "the copy must tell the user to run setup again");
  assert.match(after[1], /旧版本已经被移除/, "and must say the previous version is gone");

  // 4) 有确认（用户可以选"不中断"），不是"点了取消就立刻退出"。
  const boxLine = body.split("\n").find((line) => line.includes("MessageBox MB_YESNO"));
  assert.ok(boxLine, "the abort must be confirmed, not executed silently");
  assert.ok(boxLine.includes("${Cmd}"), "the box must be wrapped in ${Cmd} instead of using a relative jump");
  assert.ok(boxLine.includes("MB_ICONEXCLAMATION"), "an interrupted install is a warning, not an information box");
  assert.ok(boxLine.includes("$R2"), "the copy is chosen just before the box (plain vs. old-version-gone)");
  assert.ok(boxLine.includes("$(RF_LOG_HINT)$RFLogFile"), "the box must point at the log");
  assert.ok(boxLine.trim().endsWith("IDYES`"), "IDYES = really stop; everything else keeps installing");
  assert.doesNotMatch(
    body,
    /IDYES \+2/,
    "relative jumps break as soon as a macro is expanded between the box and its target",
  );
  assert.match(body, /\$\{Else\}\s*\n\s*Abort\s*\n\s*\$\{EndIf\}/, "answering 'no' must cancel the abort");

  // 5) 静默（/S，自动更新）不弹任何框：`.onUserAbort` 在 /S 下根本不会被调用，
  //    万一被调用也不许弹 —— 更新器用 ExecWait 等这个进程，一个框就是挂死。
  const silentAt = body.indexOf("${If} ${Silent}");
  assert.ok(silentAt > 0, "the abort handler must special-case silent runs");
  const silentEnd = body.indexOf("${EndIf}", silentAt);
  const silent = body.slice(silentAt, silentEnd);
  assert.doesNotMatch(silent, /MessageBox/, "a silent run must never show the abort dialog");
  assert.match(silent, /Abort/, "and must not stop the install (Abort here cancels the abort request)");
});

// ------------------------ Nit：un.rfCopyTree 必须保住 $R9（RF_LOG 会占用它）

test("the uninstaller's recursive copy keeps $R9 across the log write", () => {
  const body = functionBody(code(readWizard()), "un.rfCopyTree");

  // 前提：本函数确实用 $R9 传递归参数，而 RF_LOG 确实用 $R9 做文件句柄。两条都在，
  // 这条守卫才有意义 —— 哪天两边改成别的寄存器，这里会立刻告诉我们。
  assert.match(body, /Exch \$R9/, "the recursion parameter travels in $R9");
  const wizard = code(readWizard());
  const logAt = wizard.indexOf("!macro RF_LOG MSG");
  const logBody = wizard.slice(logAt, wizard.indexOf("!macroend", logAt));
  assert.match(logBody, /FileOpen \$R9 "\$RFLogFile" a/, "RF_LOG uses $R9 for the file handle");

  assert.strictEqual(
    (body.match(/!insertmacro RF_LOG/g) || []).length,
    1,
    "exactly one log write inside the copy: a second one needs the same treatment",
  );
  assert.match(
    body,
    /Push \$R9\s*\n(?:\s*#.*\n)*\s*!insertmacro RF_LOG "backup copy failed: \$R7\\\$R6"\s*\n\s*Pop \$R9/,
    "the log write must save/restore $R9, otherwise the recursion builds paths out of a file handle",
  );
  // 也不许改用 $R9 当临时变量（那会把同一个缺陷换个位置）。
  assert.doesNotMatch(body, /FileOpen \$R9|StrCpy \$R9/, "the copy must not use $R9 as a scratch register");
  // 失败标记仍然要在（备份不完整时上层据此拒绝删数据）。
  assert.match(body, /StrCpy \$RFUCopyFailed "1"/, "the incomplete-copy flag must stay");
});

// ------------------ Nit：顶部那条"为什么不用 APP_EXECUTABLE_FILENAME"的说法

test("the header comment matches what the code actually does", () => {
  const raw = readWizard();
  const wizard = code(raw);

  // 旧说法与事实相反：`customCheckAppRunning` **正在**用 APP_EXECUTABLE_FILENAME
  // （它的宏体在模板正文里展开，那时 common.nsh 已经定义好）。
  assert.doesNotMatch(raw, /不用 APP_EXECUTABLE_FILENAME/, "the stale rule must be gone");
  assert.match(
    wizard,
    /tasklist \/FI "IMAGENAME eq \$\{APP_EXECUTABLE_FILENAME\}"/,
    "the macro body really does use APP_EXECUTABLE_FILENAME",
  );

  // 新说法必须点出真正的判据：就地编译 vs 宏体插入点，以及 -WX 下 6000 的后果。
  const header = raw.slice(0, raw.indexOf("!macro RF_STR"));
  assert.match(header, /插入点/, "the comment must explain that macro bodies expand at the insertion point");
  assert.match(header, /6000/, "and name the warning a wrong choice produces");
  assert.match(header, /PRODUCT_FILENAME/, "and give the always-safe alternative");
  // 抢救脚本那边同理：`RF_WaitForAppExit` 用的是 ${PRODUCT_FILENAME}.exe。
  assert.match(code(readRescue()), /\$\{PRODUCT_FILENAME\}\.exe/, "the header functions keep using PRODUCT_FILENAME");
});
