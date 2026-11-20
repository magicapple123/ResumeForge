// SPDX-License-Identifier: Apache-2.0
"use strict";

// Tests for the install/upgrade hardening added after the 2026-11-2x real-machine
// failure (2.1.0 would not install on a user's machine at all).
//
// What actually happened, because every assertion below traces back to it:
//   1. upgrading an existing install hung on "closing the previous version" with
//      `appCannotBeClosed`, while `tasklist` showed no ResumeForge.exe at all;
//      the old uninstaller exited 2 under `_?=<dir>` and deleted nothing, but
//      exited 0 without `_?=`;
//   2. a fresh install popped "cannot open file for writing:
//      ...\uninstallerIcon.ico", and after "Ignore" hit `appCannotBeClosed` again;
//   3. the target directory ended up with 0 files, %TEMP% held no `ns*.tmp`
//      from that run and the setup log had not been written at all.
//
// The `.nsh` files are only compiled during packaging, so these are text guards:
// they pin the properties a later edit could silently drop. `node --test` runs
// them; CI's desktop-shell job then builds a real installer, where a syntax error
// or a warnings-as-errors violation shows up.
//
// Property under test (one test each):
//   1. the log exists from the earliest hook, and has a fallback when %TEMP% is dead;
//   2. an unwritable install directory falls back to the default location, silently
//      under /S, and never reuses electron-builder's messages;
//   3. the post-install self-check refuses to report success for a half install;
//   4. every failure we report has its own bilingual LangString;
//   5. the uninstaller never mistakes its own in-place image for a leftover, and
//      reports success as success.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const DESKTOP = path.join(__dirname, "..");
const NSIS = path.join(DESKTOP, "nsis");
const WIZARD_PATH = path.join(NSIS, "wizard.nsh");
const RESCUE_PATH = path.join(NSIS, "legacy-data-rescue.nsh");

const BUNDLED_LCIDS = [
  1033, 1031, 1036, 3082, 2052, 1028, 1041, 1042, 1040, 1043, 1030, 1053, 1044, 1035, 1049, 2070,
  1046, 1045, 1058, 1029, 1051, 1038, 1025, 1055, 1054, 1066,
];

function readWizard() {
  return fs.readFileSync(WIZARD_PATH, "utf8");
}

function readRescue() {
  return fs.readFileSync(RESCUE_PATH, "utf8");
}

// Source text with comment lines removed: assertions about "what the script does"
// must not be satisfied by a comment describing it.
function code(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

// ---------------------------------------------------------------- 1. logging

test("the setup log is created at the earliest hook, not after the first failure", () => {
  const source = readWizard();
  const body = code(source);

  // preInit is the hook installer.nsi expands inside .onInit right after
  // `SetOutPath $INSTDIR`. Before this change the log was opened in customInit,
  // i.e. after ALLOW_ONLY_ONE_INSTALLER_INSTANCE / initMultiUser -- exactly the
  // steps that quit on the user's machine, which is why no log was produced.
  assert.match(
    body,
    /^!macro preInit$/m,
    "preInit must exist: it is the earliest hook available in .onInit",
  );
  const preInitAt = body.indexOf("!macro preInit");
  const preInitEnd = body.indexOf("!macroend", preInitAt);
  assert.ok(
    body.slice(preInitAt, preInitEnd).includes("!insertmacro RF_LOG_OPEN"),
    "preInit must open the log before doing anything else",
  );

  // One single place decides the log path (the old inline FileOpen is gone), so a
  // refactor cannot leave a second, non-falling-back writer behind.
  assert.strictEqual(
    (source.match(/ResumeForge-Setup\.log/g) || []).length,
    1,
    "the $TEMP log path must be built in exactly one place (RF_LOG_OPEN)",
  );
  assert.match(
    body,
    /StrCpy \$RFLogFile "\$TEMP\\ResumeForge-Setup\.log"/,
    "RF_LOG_OPEN must derive the $TEMP log path itself",
  );

  // %TEMP% was not writable during the failed run: without a second location the
  // log would be silently missing again, which is what made this bug expensive.
  const openAt = body.indexOf("!macro RF_LOG_OPEN");
  const openEnd = body.indexOf("!macroend", openAt);
  const openBody = body.slice(openAt, openEnd);
  // 两个模式都要有：安装器截断（每次安装一份干净证据），卸载器追加（升级时旧卸载器
  // 在新安装器跑到一半执行，截断会抹掉证据）。断言不再与 `!else` 的相邻形态耦合 ——
  // 追加分支里现在还有一句必须存在的 FileSeek（见下一条用例）。
  assert.match(openBody, /!ifdef BUILD_UNINSTALLER/, "the two log modes must be split by compile pass");
  assert.match(openBody, /FileOpen \$9 "\$RFLogFile" w/, "the installer must truncate the log");
  assert.match(openBody, /FileOpen \$9 "\$RFLogFile" a/, "the uninstaller must append to the log");
  assert.match(
    openBody,
    /StrCpy \$RFLogFile "\$LOCALAPPDATA\\ResumeForge\\setup\.log"/,
    "RF_LOG_OPEN must fall back to %LOCALAPPDATA% when %TEMP% is not writable",
  );
  assert.match(
    openBody,
    /DetailPrint "\[ResumeForge\] setup log unavailable/,
    "a completely unwritable log must still leave a trace in DetailPrint",
  );
  assert.doesNotMatch(
    openBody,
    /Abort|Quit|SetErrorLevel/,
    "failing to log must never abort the install",
  );
});

test("every append-mode log write seeks to the end first", () => {
  // NSIS 的 FileOpen "a" **不**把写入位置移到文件尾（只表示"不存在就创建"）。少了
  // FileSeek 0 END，每条日志都从偏移 0 覆盖写：QA 用 makensis 3.0.4.1 实测，连写
  // 4 行后文件里只剩最后一行 + 最长那行的尾巴。日志丢行等于整轮取证白做。
  const wizard = code(readWizard());
  const logAt = wizard.indexOf("!macro RF_LOG MSG");
  const logBody = wizard.slice(logAt, wizard.indexOf("!macroend", logAt));
  assert.match(
    logBody,
    /FileOpen \$R9 "\$RFLogFile" a\s*\n\s*\$\{IfNot\} \$\{Errors\}\s*\n(?:\s*#.*\n)*\s*FileSeek \$R9 0 END\s*\n\s*FileWrite \$R9/,
    "RF_LOG must FileSeek to the end before writing, otherwise every line overwrites the previous one",
  );

  const openAt = wizard.indexOf("!macro RF_LOG_OPEN");
  const openBody = wizard.slice(openAt, wizard.indexOf("!macroend", openAt));
  // 追加分支有两处（%TEMP% 与 %LOCALAPPDATA% 回退），每处都要 seek。
  const appends = openBody.split('FileOpen $9 "$RFLogFile" a').length - 1;
  const seeks = (openBody.match(/FileSeek \$9 0 END/g) || []).length;
  assert.strictEqual(appends, 2, "both append attempts (TEMP + LOCALAPPDATA fallback) must be present");
  assert.strictEqual(seeks, appends, "each append-mode open must be followed by FileSeek 0 END");

  // 诊断通道（RF_DIAG，只有定义 RF_DIAG_LOG 时才编进去）是同一个坑：它是排查复制
  // 失败时唯一的逐文件记录，丢行等于没开。
  const rescue = code(readRescue());
  const diagAt = rescue.indexOf("!macro RF_DIAG MSG");
  const diagBody = rescue.slice(diagAt, rescue.indexOf("!macroend", diagAt));
  assert.match(diagBody, /FileOpen \$R8 "\$\{RF_DIAG_LOG\}" a\s*\n(?:\s*#.*\n)*\s*FileSeek \$R8 0 END/, "RF_DIAG must seek too");
});

test("the registry key paths stay byte-identical to the template's", () => {
  // 我们在 header 里镜像了 multiUser.nsh 的 `!define /ifndef`（为了让 header 里
  // 编译的函数也能用这两个常量）。重复定义本身就是漂移风险，所以逐字比对上游。
  const wizard = code(readWizard());
  const ours = new Map();
  for (const m of wizard.matchAll(/!define (\w*REGISTRY_KEY) "([^"]*)"/g)) ours.set(m[1], m[2]);
  const multiUser = path.join(DESKTOP, "node_modules", "app-builder-lib", "templates", "nsis", "multiUser.nsh");
  if (!fs.existsSync(multiUser)) {
    assert.ok(ours.size > 0, "our mirrored defines must exist even without node_modules");
    return; // 没有 node_modules 时跳过逐字比对（不做假绿：上面的存在性仍被断言）
  }
  const upstream = new Map();
  for (const m of fs.readFileSync(multiUser, "utf8").matchAll(/!define \/ifndef (\w*REGISTRY_KEY) "([^"]*)"/g)) {
    upstream.set(m[1], m[2]);
  }
  assert.ok(upstream.size >= 2, "must find the template's own definitions to compare against");
  for (const [name, value] of upstream) {
    assert.strictEqual(ours.get(name), value, `${name} drifted from multiUser.nsh`);
  }
  // 不许出现写死的 GUID 字面量：只能是 ${APP_GUID} / ${UNINSTALL_APP_KEY} 拼出来的。
  for (const value of ours.values()) {
    assert.doesNotMatch(value, /[0-9A-F]{8}-[0-9A-F]{4}-/i, "the key paths must not hardcode a GUID");
  }
});

test("the first log records are enough to diagnose the machine", () => {
  const body = code(readWizard());
  const envAt = body.indexOf("!macro RF_LOG_ENV");
  assert.ok(envAt >= 0, "RF_LOG_ENV must exist");
  const envBody = body.slice(envAt, body.indexOf("!macroend", envAt));
  for (const field of ["${GetTime}", "instdir=$INSTDIR", "temp=$TEMP", "exedir=$EXEDIR", "silent=$RFSilent", "installmode=$installMode"]) {
    assert.ok(envBody.includes(field), `the environment snapshot must contain ${field}`);
  }

  // customInit order: log -> probe -> the rest. Probe results are worthless if the
  // log is not open yet, and the probe must run before any file is written.
  const rescue = code(readRescue());
  const initAt = rescue.indexOf("!macro customInit");
  const initBody = rescue.slice(initAt, rescue.indexOf("!macroend", initAt));
  const logAt = initBody.indexOf('!insertmacro RF_LOG_OPEN "customInit"');
  const probeAt = initBody.indexOf('!insertmacro RF_WRITE_PROBE "customInit"');
  const restAt = initBody.indexOf("!insertmacro RF_INSTALL_INIT");
  assert.ok(logAt >= 0, "customInit must open the log itself");
  assert.ok(probeAt > logAt, "the probe comes after the log is open");
  assert.ok(restAt > probeAt, "the probe must run before the upgrade/backup work");
});

// ------------------------------------------------------- 2. unwritable target

test("an unwritable install directory falls back instead of failing mid-copy", () => {
  const body = code(readWizard());

  assert.match(
    body,
    /^!define RF_FALLBACK_INSTDIR "\$LOCALAPPDATA\\Programs\\ResumeForge"$/m,
    "the fallback must be the per-user default electron-builder itself would pick",
  );
  assert.match(
    body,
    /^!define RF_PROBE_FILE "\.rf-write-probe"$/m,
    "the probe needs a fixed file name so logs can explain a leftover",
  );

  const probeAt = body.indexOf("Function rfProbeWritable");
  assert.ok(probeAt >= 0, "rfProbeWritable must exist");
  const probeBody = body.slice(probeAt, body.indexOf("FunctionEnd", probeAt));
  assert.match(probeBody, /FileOpen \$9 "\$INSTDIR\\\$\{RF_PROBE_FILE\}" w/, "the probe must open a real file for writing");
  assert.match(probeBody, /FileWrite \$9 "probe"/, "the probe must actually write bytes");
  assert.match(probeBody, /Delete "\$INSTDIR\\\$\{RF_PROBE_FILE\}"/, "the probe must clean up after itself");
  assert.match(probeBody, /Call rfCaptureLastError/, "a failed probe must capture GetLastError for the log");
  // 光"有这些指令"不够：把探针改成恒成功也必须变红，所以钉住两个失败分支的**去向**。
  assert.match(
    probeBody,
    /FileOpen \$9 "\$INSTDIR\\\$\{RF_PROBE_FILE\}" w\s*\n\s*\$\{If\} \$\{Errors\}\s*\n\s*StrCpy \$RFProbeState "write"\s*\n\s*Call rfCaptureLastError/,
    "a failed open must mark the folder unwritable and capture the error",
  );
  assert.match(
    probeBody,
    /FileWrite \$9 "probe"\s*\n\s*FileClose \$9\s*\n\s*\$\{If\} \$\{Errors\}\s*\n\s*StrCpy \$RFProbeState "write"/,
    "a failed write must mark the folder unwritable as well (write-only checks are not enough)",
  );
  // An empty-but-writable directory is "not found" by IfFileExists "<dir>\*.*";
  // the rescue copy already paid for that lesson and must not be repeated here.
  assert.doesNotMatch(probeBody, /IfFileExists "\$INSTDIR\\\*\.\*"/, "an empty directory must not be read as unwritable");

  assert.match(
    body,
    /System::Call 'kernel32::GetLastError\(\) i \.R0'/,
    "the probe must record the Win32 error code",
  );
});

test("the fallback keeps the whole install in the new directory", () => {
  const body = code(readWizard());
  const macroAt = body.indexOf("!macro RF_WRITE_PROBE");
  assert.ok(macroAt >= 0, "RF_WRITE_PROBE must exist");
  const macroBody = body.slice(macroAt, body.indexOf("!macroend", macroAt));

  assert.match(
    macroBody,
    /StrCpy \$INSTDIR "\$\{RF_FALLBACK_INSTDIR\}"/,
    "the fallback must move $INSTDIR itself: every later step (copy, registry, shortcuts, updater) reads only $INSTDIR",
  );
  assert.match(macroBody, /SetOutPath "\$INSTDIR"/, "the output directory must follow the new $INSTDIR");
  assert.match(macroBody, /StrCpy \$RFDowngraded "1"/, "the downgrade must be observable afterwards (finish page / log)");
  // 两处插入：customInit 之后 rfPrecheck 还会探一次。第二次探针成功时不能把
  // "这次降级过"擦掉，所以这个标志只允许被置 1。
  assert.doesNotMatch(body, /StrCpy \$RFDowngraded "0"/, "the downgrade flag must never be cleared");

  // Silence on /S is mandatory: the auto-updater runs the installer with /S and
  // waits for it, so a message box there is a hang -- the exact symptom to kill.
  assert.match(
    macroBody,
    /\$\{If\} \$RFSilent != "1"\s*\n\s*MessageBox MB_ICONEXCLAMATION\|MB_OK "\$\(RF_ERR_DIR_UNWRITABLE\)/,
    "the 'using another folder' notice must be skipped in silent mode",
  );
  assert.strictEqual(
    (macroBody.match(/MessageBox/g) || []).length,
    2,
    "exactly two boxes: the downgrade notice and the fatal one",
  );

  // Fatal path: our own message (naming the log and the portable zip), non-zero exit.
  assert.match(macroBody, /SetErrorLevel 5/, "an install that cannot write anywhere must exit non-zero");
  assert.match(macroBody, /Quit/, "it must not continue installing");
  assert.match(macroBody, /\$\(RF_ERR_NO_WRITABLE_DIR\)/, "the fatal notice must be ours, not the template's");
  assert.match(body, /zip/, "the fatal notice must point at the portable zip as a way out");
});

test("the probe runs again after the directory page", () => {
  const body = code(readWizard());
  const precheckAt = body.indexOf("Function rfPrecheck");
  const precheckBody = body.slice(precheckAt, body.indexOf("FunctionEnd", precheckAt));
  assert.match(
    precheckBody,
    /!insertmacro RF_WRITE_PROBE "precheck"/,
    "customInit runs before the 'choose install location' page, so the chosen folder must be probed again",
  );
});

// --------------------------------------------------------- 3. post-install check

test("a half-finished install exits non-zero instead of claiming success", () => {
  const body = code(readWizard());
  const checkAt = body.indexOf("!macro RF_INSTALL_SELFCHECK");
  assert.ok(checkAt >= 0, "RF_INSTALL_SELFCHECK must exist");
  const checkBody = body.slice(checkAt, body.indexOf("!macroend", checkAt));

  assert.match(checkBody, /IfNot\} \$\{FileExists\} "\$INSTDIR\\\$\{PRODUCT_FILENAME\}\.exe"/, "must verify the shell executable");
  assert.match(checkBody, /IfNot\} \$\{FileExists\} "\$INSTDIR\\resources\\app\.asar"/, "must verify resources\\app.asar");
  assert.match(checkBody, /resources\\payload\\backend\\app\\main\.py/, "must verify the copied payload (that is the copy-failure case)");
  assert.match(checkBody, /SetErrorLevel 6/, "a broken install must return a non-zero exit code");
  assert.match(checkBody, /Quit/, "and must not fall through to the finish page");
  assert.match(checkBody, /self-check/, "the outcome must be written to the log");

  // Wiring: customInstall must end with the check (electron-builder calls it after
  // all files are in place, before the finish page).
  const rescue = code(readRescue());
  const installAt = rescue.indexOf("!macro customInstall");
  const installBody = rescue.slice(installAt, rescue.indexOf("!macroend", installAt));
  const finishAt = installBody.indexOf("!insertmacro RF_INSTALL_FINISH");
  const selfCheckAt = installBody.indexOf("!insertmacro RF_INSTALL_SELFCHECK");
  assert.ok(selfCheckAt > finishAt, "customInstall must end with the self-check");
});

// -------------------------------------------------------------- 4. error copy

test("every failure the installer reports has its own bilingual LangString", () => {
  const source = readWizard();

  const required = ["RF_ERR_DIR_UNWRITABLE", "RF_ERR_NO_WRITABLE_DIR", "RF_ERR_COPY_FAILED", "RF_ERR_SELFCHECK"];
  for (const name of required) {
    const match = new RegExp(`!insertmacro RF_STR ${name} \\\\\\r?\\n\\s*"([^"]*)" \\\\\\r?\\n\\s*"([^"]*)"`).exec(source);
    assert.ok(match, `${name} must be defined through RF_STR (26 languages, zh + en)`);
    assert.ok(match[1].trim().length > 0, `${name} needs Chinese copy`);
    assert.ok(match[2].trim().length > 0, `${name} needs English copy`);
  }

  // RF_STR expands to one LangString per bundled language; a missing LCID renders
  // the box empty, which is how the shortcut name broke once already.
  const strMacroAt = source.indexOf("!macro RF_STR");
  const strMacroBody = source.slice(strMacroAt, source.indexOf("!macroend", strMacroAt));
  const defined = new Set();
  for (const match of strMacroBody.matchAll(/LangString \$\{NAME\} (\d+) /g)) {
    defined.add(Number(match[1]));
  }
  assert.deepStrictEqual(
    [...defined].sort((a, b) => a - b),
    [...BUNDLED_LCIDS].sort((a, b) => a - b),
    "RF_STR must cover exactly the languages electron-builder packs",
  );

  // The one string we must not reuse: it means "the app cannot be closed", which is
  // not what any of these failures were. It sent the maintainer looking for a
  // ResumeForge.exe that did not exist.
  for (const [file, text] of [["wizard.nsh", source], ["legacy-data-rescue.nsh", readRescue()]]) {
    assert.ok(
      !code(text).includes("appCannotBeClosed"),
      `${file} must not reuse the template's appCannotBeClosed message`,
    );
  }

  // Each new string must actually be reachable, not just declared.
  const body = code(source);
  for (const name of [...required, "RF_ERR_APP_RUNNING"]) {
    const uses = body.match(new RegExp(`\\$\\(${name}\\)`, "g")) || [];
    assert.ok(uses.length > 0, `${name} is declared but never shown`);
  }
});

// ------------------------------------------------------------ 5. uninstaller

test("the uninstaller never mistakes its own in-place image for the app", () => {
  const body = code(readWizard());
  const checkAt = body.indexOf("!macro customCheckAppRunning");
  assert.ok(checkAt >= 0, "customCheckAppRunning must override the template's check");
  const checkBody = body.slice(checkAt, body.indexOf("!macroend", checkAt));

  // Root cause of "exit 2, nothing deleted": the template decides by *path prefix*
  // (PowerShell `$_.Path.StartsWith($INSTDIR)`), and under `_?=<dir>` the uninstaller
  // itself runs from inside $INSTDIR -- so it matched itself and Stop-Process'd itself.
  assert.doesNotMatch(checkBody, /StartsWith\s*\(\s*'\$INSTDIR'/, "the path-prefix probe must not come back");
  assert.doesNotMatch(checkBody, /Get-CimInstance|Stop-Process|taskkill/, "the check must not kill processes");
  assert.match(
    checkBody,
    /tasklist \/FI "IMAGENAME eq \$\{APP_EXECUTABLE_FILENAME\}"/,
    "the check must match on the image name only: our own image is never ResumeForge.exe",
  );

  // No box on the silent/update path: the auto-updater waits on this process.
  assert.match(checkBody, /IntCmp \$R1 5 rf_app_check_still_running/, "it must wait briefly for a graceful exit");
  assert.match(checkBody, /\$\{If\} \$R3 == "1"[\s\S]*?Goto rf_app_check_done/, "an update run continues without a box");
  assert.match(checkBody, /SetErrorLevel 3/, "a silent non-update run must exit non-zero instead of blocking");
});

test("the uninstaller reports success as success", () => {
  const body = code(readWizard());

  const helperAt = body.indexOf("Function un.rfHasForeignEntries");
  assert.ok(helperAt >= 0, "un.rfHasForeignEntries must exist");
  const helperBody = body.slice(helperAt, body.indexOf("FunctionEnd", helperAt));
  // 判据必须是"本进程自己的镜像名"（$EXEPATH 的 basename），不是某个编译期常量：
  // `${UNINSTALL_FILENAME}` 在 common.nsh 才定义，而本文件先于它编译（warning 6000）。
  assert.match(
    helperBody,
    /\$\{GetFileName\} "\$EXEPATH" \$R8/,
    "the uninstaller's own image name must come from $EXEPATH",
  );
  assert.match(
    helperBody,
    /StrCmp \$R7 "\$R8" un_rf_foreign_next/,
    "the uninstaller's own executable must be ignored when judging residue",
  );
  assert.doesNotMatch(
    helperBody,
    /UNINSTALL_FILENAME/,
    "a constant that is not defined yet at include time cannot be used here",
  );
  assert.match(helperBody, /FindFirst \$R5 \$R7 "\$INSTDIR\\\*\.\*"/, "the residue scan must enumerate the directory");

  const pageAt = body.indexOf("Function un.rfResiduePageShow");
  const pageBody = body.slice(pageAt, body.indexOf("FunctionEnd", pageAt));
  assert.doesNotMatch(
    pageBody,
    /IfFileExists "\$INSTDIR\\\*\.\*"/,
    "resident-by-design own exe must not trigger the retry prompt",
  );
  assert.match(pageBody, /Call un\.rfHasForeignEntries/, "the page must use the helper");
  assert.match(pageBody, /SetErrorLevel 7/, "real residue must be reported as a failure");
  assert.match(pageBody, /SetErrorLevel 0/, "a clean uninstall must report 0 (installUtil decides on the exit code)");
});

test("both scripts stay BOM-prefixed, LF-only and warning-clean by construction", () => {
  for (const [file, full] of [["wizard.nsh", WIZARD_PATH], ["legacy-data-rescue.nsh", RESCUE_PATH]]) {
    const bytes = fs.readFileSync(full);
    assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${file} needs a UTF-8 BOM (Unicode NSIS)`);
    assert.ok(!bytes.includes(0x0d), `${file} must stay LF-only`);
  }
  // Vars declared but never referenced fail the packaging build (makensis warning
  // 6001 + electron-builder's -WX). Cheap static approximation for the new ones.
  const body = code(readWizard());
  for (const name of ["RFInstallDirOriginal", "RFProbeState", "RFProbeError", "RFDowngraded", "RFSelfCheckState", "RFSelfCheckMissing", "RFSilent"]) {
    const decls = body.match(new RegExp(`Var /GLOBAL ${name}\\b`, "g")) || [];
    assert.strictEqual(decls.length, 1, `${name} must be declared exactly once`);
    const uses = body.match(new RegExp(`\\$${name}\\b`, "g")) || [];
    assert.ok(uses.length >= 2, `${name} must be both set and read`);
  }
});
