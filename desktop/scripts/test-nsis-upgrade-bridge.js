// SPDX-License-Identifier: Apache-2.0
"use strict";

// Upgrade-bridge half of the NSIS install/upgrade guard: the new installer runs the
// *shipped* 2.1.0 uninstaller before installUtil gets a chance to. That uninstaller's
// defect is already inside a released binary (path-prefix process probe + `_?=` making
// it run in place, so it killed itself), so the only defense is on our side:
//   * never launch it with `_?=`;
//   * parse `UninstallString` properly -- it is `"<exe>" /currentuser`, not a path;
//   * never touch the registration unless the old version is really gone;
//   * never raise a dialog on the `/S` path (the updater ExecWait's this process).
//
// Split from test-nsis-install-hardening.js when that file crossed the 500-line
// desktop budget (backend/tests/test_file_size_budget.py, zero exemptions). Pure
// relocation: every assertion is unchanged.

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

// Source text with comment lines removed: assertions about "what the script does"
// must not be satisfied by a comment describing it.
function code(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

// 2.1.0 的卸载器把缺陷编进了二进制（路径前缀判据 + `_?=` 就地运行 → 自己杀自己），
// 改不了它，所以新安装器在 customInit 里抢先用**不带 `_?=`** 的方式跑一遍旧卸载器。
function preUninstallBody() {
  const body = code(readRescue());
  const at = body.indexOf("!macro RF_PREEMPTIVE_UNINSTALL");
  assert.ok(at >= 0, "RF_PREEMPTIVE_UNINSTALL must exist");
  return body.slice(at, body.indexOf("!macroend", at));
}

// ------------------------------------------------- 6. bridging the shipped 2.1.0

test("the old uninstaller is never launched in place", () => {
  const body = preUninstallBody();
  // `_?=` 是根因开关：它让卸载器就地运行，镜像路径落进 $INSTDIR，模板那套
  // "路径以 $INSTDIR 开头"的进程判据于是命中自己 → Stop-Process 自己 → 退出码非 0。
  assert.doesNotMatch(body, /_\?=/, "_?= must never come back: it is the root cause of the exit-2 uninstall");
  assert.match(
    body,
    /ExecWait '"\$R1" \/S \$R3 --updated' \$R0/,
    "the bridge must run the old uninstaller silently, without _?=",
  );
  // --updated 保留：没有它，旧卸载器会走"用户主动卸载"的默认值（备份/删数据那条路）。
  assert.match(body, /--updated/, "the --updated flag keeps the old uninstaller off the user-uninstall path");
  assert.match(body, /StrCpy \$R3 "\/currentuser"/, "per-user installs must pass /currentuser");
  assert.match(body, /StrCpy \$R3 "\/allusers"/, "per-machine installs must pass /allusers");
  // 这个宏会在 rfPrecheck（header 里编译）里展开，那里 $installMode 还不存在：
  // 必须读 customInit 抄下来的快照，否则 warning 6000 → -WX 打包失败。
  assert.doesNotMatch(body, /\$installMode/, "the bridge must read the $RFInstallMode snapshot, not the template's $installMode");
  assert.match(body, /\$RFInstallMode == "all"/, "the switch must come from the snapshot");
});

test("the registration is dropped only when the old version is really gone", () => {
  const body = preUninstallBody();
  const okAt = body.indexOf('${If} $R0 == "0"');
  const failAt = body.indexOf("pre-uninstall: FAILED");
  assert.ok(okAt >= 0 && failAt > okAt, "the exit-code branch must exist");
  assert.strictEqual(
    (body.slice(okAt, failAt).match(/DeleteRegKey/g) || []).length,
    2,
    "exit 0 must clear both keys so installUtil's uninstallOldVersion returns early (installUtil.nsh:178-182)",
  );
  assert.strictEqual(
    (body.slice(failAt, body.indexOf("!macroend", failAt)).match(/DeleteRegKey/g) || []).length,
    0,
    "a failed uninstall must keep the registration: the template retries, which is no worse than today",
  );
  // 悬空登记（解析出的路径确实不存在）要顺手清掉：现场用户正是手工清登记才装上的。
  const danglingAt = body.indexOf('${IfNot} ${FileExists} "$R1"');
  assert.ok(danglingAt >= 0, "a dangling registration must be recognised");
  assert.strictEqual(
    (body.slice(danglingAt, body.indexOf("ExecWait", danglingAt)).match(/DeleteRegKey/g) || []).length,
    2,
    "a dangling registration is cleared instead of being retried five times",
  );
  // 目录被旧卸载器删了，必须重建，否则 File 指令写进不存在的路径。
  assert.match(body, /CreateDirectory "\$INSTDIR"\s*\n\s*SetOutPath "\$INSTDIR"/, "the install dir must be recreated after the uninstall");
});

test("the UninstallString parser takes the quoted path, not the whole command", () => {
  // electron-builder 写的是 `'"$2" $0'`（include/installer.nsh:122），真实形态是
  //   "C:\...\Uninstall ResumeForge.exe" /currentuser
  // 旧实现只剥首尾引号 → 得到 `...exe" /currentuser` → FileExists 恒假 → 每次都走
  // "悬空登记"、删键，而旧卸载器根本没跑（QA 实测）。这条守卫钉住"扫到闭引号为止"。
  const body = preUninstallBody();
  assert.match(body, /\$\{Do\}/, "the parser must walk the string character by character");
  assert.match(body, /StrCpy \$R4 "\$R1" 1 \$R2/, "it must read one character at a time");
  assert.match(body, /\$\{If\} \$R4 == '"'/, "a closing quote must end the scan");
  assert.match(body, /StrCpy \$R1 "\$R1" \$R2/, "the path is everything before the closing quote");
  assert.match(
    body,
    /\$\{Else\}\s*\n\s*StrCpy \$R1 ""\s*\n\s*\$\{EndIf\}/,
    "no closing quote at all must clear the parsed path (that is what marks a parse failure)",
  );
});

test("a parse failure leaves the registration alone", () => {
  const body = preUninstallBody();
  const failAt = body.indexOf('${If} $R1 == ""');
  assert.ok(failAt >= 0, "the parse-failure branch must exist");
  const elseAt = body.indexOf("${Else}", failAt);
  assert.ok(elseAt > failAt, "the parse-failure branch must have an else");
  const failBlock = body.slice(failAt, elseAt);
  assert.strictEqual(
    (failBlock.match(/DeleteRegKey/g) || []).length,
    0,
    "a parse failure must never delete the registration: deleting it removes a real uninstall entry and still uninstalls nothing",
  );
  assert.match(failBlock, /keeping registration/, "it must say so in the log");
  assert.match(failBlock, /DetailPrint/, "and leave a trace in the details view");
  // 删键只允许出现在"解析出干净路径"之后。
  const firstDelete = body.indexOf("DeleteRegKey");
  assert.ok(firstDelete > elseAt, "deletion must only happen after a successfully parsed path");
});

test("silent runs never show a dialog, they log and exit non-zero", () => {
  const rescue = code(readRescue());
  const marker = '${If} $RFSilent == "1"';
  const blocks = [];
  let from = 0;
  for (;;) {
    const at = rescue.indexOf(marker, from);
    if (at < 0) break;
    // 静默分支的正文 = 到最近的 ${Else} 或 ${EndIf} 为止（不能再往里吞，否则会把
    // 交互分支里的 $LANGUAGE 弹框算进来）。
    const elseAt = rescue.indexOf("${Else}", at);
    const endAt = rescue.indexOf("${EndIf}", at);
    const stop = elseAt >= 0 && elseAt < endAt ? elseAt : endAt;
    blocks.push(rescue.slice(at + marker.length, stop));
    from = stop + 1;
  }
  assert.ok(blocks.length >= 3, "at least the three modal spots must branch on silence");
  for (const block of blocks) {
    assert.doesNotMatch(block, /MessageBox/, "a silent branch must never raise a dialog: the updater waits on this process");
  }
  const exitBlocks = blocks.filter((b) => /SetErrorLevel \d/.test(b));
  assert.strictEqual(exitBlocks.length, 3, "the three failure paths must each set an exit code (the 4th silent branch is the deferred-bridge gate)");
  for (const block of exitBlocks) {
    assert.match(block, /RF_LOG|DetailPrint/, "a silent failure must leave a trace");
  }
  const codes = exitBlocks.map((b) => /SetErrorLevel (\d)/.exec(b)[1]);
  assert.deepStrictEqual(codes, ["4", "8", "9"], "each silent branch sets its own documented exit code (see the table in wizard.nsh)");
});

test("the bridge waits for the last interactive station before touching the old version", () => {
  // Medium 3：customInit 早于目录页，用户那时还能改目录、还能取消。在"还能取消"的
  // 时点删掉旧版本与卸载登记，用户一取消就落到"磁盘上没程序、Add/Remove 里没记录"。
  const wizard = code(readWizard());
  const precheckAt = wizard.indexOf("Function rfPrecheck");
  const precheckBody = wizard.slice(precheckAt, wizard.indexOf("FunctionEnd", precheckAt));
  const probeAt = precheckBody.indexOf('!insertmacro RF_WRITE_PROBE "precheck"');
  const bridgeAt = precheckBody.indexOf("!insertmacro RF_PREEMPTIVE_UNINSTALL");
  assert.ok(bridgeAt > 0, "the interactive path must run the bridge after the directory page");
  assert.ok(probeAt > 0 && bridgeAt > probeAt, "probe (can we write?) must come before touching the old install");

  const rescue = code(readRescue());
  const initAt = rescue.indexOf("!macro customInit");
  const initBody = rescue.slice(initAt, rescue.indexOf("!macroend", initAt));
  assert.strictEqual(
    (initBody.match(/!insertmacro RF_PREEMPTIVE_UNINSTALL/g) || []).length,
    1,
    "exactly one bridge call in customInit",
  );
  // 结构：静默分支里才调用；交互分支只记一行"延后"。
  assert.match(
    initBody,
    /\$\{If\} \$RFSilent == "1"\s*\n\s*!insertmacro RF_PREEMPTIVE_UNINSTALL\s*\n\s*\$\{Else\}\s*\n\s*!insertmacro RF_LOG "[^"]*deferred/,
    "the customInit bridge must sit inside the silent branch, and the interactive branch must only log that it was deferred",
  );
});

test("the app-running check opens the log before it judges anything", () => {
  const wizard = code(readWizard());
  const at = wizard.indexOf("!macro customCheckAppRunning");
  const body = wizard.slice(at, wizard.indexOf("!macroend", at));
  const openAt = body.indexOf('!insertmacro RF_LOG_OPEN "app-check"');
  const firstLog = body.indexOf("!insertmacro RF_LOG ");
  assert.ok(openAt > 0, 'customCheckAppRunning must call RF_LOG_OPEN "app-check" itself');
  assert.ok(
    openAt < firstLog,
    "it runs before customUnInit in the uninstaller, where $RFLogFile is still empty and RF_LOG is a silent no-op (Low 2)",
  );
});

// ------------------------------------------------- 7. app-exit gate (Medium 2)

// 软等待宏的正文（与 RF_WaitForAppExit 同一套判定、不同的超时后果）。
function softWaitBody() {
  const rescue = code(readRescue());
  const at = rescue.indexOf("!macro RF_WAIT_APP_EXIT_SOFT");
  assert.ok(at >= 0, "RF_WAIT_APP_EXIT_SOFT must exist");
  return rescue.slice(at, rescue.indexOf("!macroend", at));
}

test("the app is confirmed gone before the old uninstaller runs", () => {
  // 模板的 CHECK_APP_RUNNING 排在安装段开头（installSection.nsh:33），而桥跑在
  // `.onInit` 的 customInit / 目录页之后的 rfPrecheck —— 两者都早于那次提问。
  // 静默升级时应用可能还开着，此时旧卸载器会把 $INSTDIR 整个删掉。
  const body = preUninstallBody();
  const waitAt = body.indexOf("!insertmacro RF_WAIT_APP_EXIT_SOFT");
  const execAt = body.indexOf("ExecWait");
  assert.ok(waitAt > 0, "the bridge must ask whether the app is gone (RF_WAIT_APP_EXIT_SOFT)");
  assert.ok(execAt > waitAt, "that question must come *before* launching the old uninstaller");
  assert.ok(
    body.indexOf('${If} $RFAppStillRunning == "1"') > waitAt,
    "the result of the wait must actually gate the ExecWait",
  );

  // 还在跑 → **放弃卸旧**：保留登记、安装继续。删登记或中止安装都比今天更差。
  const giveUpAt = body.indexOf('${If} $RFAppStillRunning == "1"');
  const giveUpElse = body.indexOf("${Else}", giveUpAt);
  assert.ok(giveUpElse > giveUpAt, "the give-up branch must have an else (the real uninstall)");
  const giveUp = body.slice(giveUpAt, giveUpElse);
  assert.doesNotMatch(giveUp, /DeleteRegKey/, "an app that is still running must keep its registration");
  assert.doesNotMatch(giveUp, /Quit|Abort|SetErrorLevel/, "leaving the old version in place must never abort the install");
  assert.match(giveUp, /RF_LOG/, "the give-up must be logged");
  assert.match(giveUp, /DetailPrint/, "and leave a trace in the details view");
});

test("the soft wait probes by image name only, and gives up instead of aborting", () => {
  const body = softWaitBody();

  // 判定方式必须与 RF_WaitForAppExit / customCheckAppRunning 一致：tasklist + find。
  // 路径前缀判据是 `_?=` 卸载失败的根因，绝不能借这条路径回来。
  assert.match(
    body,
    /nsExec::Exec 'cmd \/c tasklist \/FI "IMAGENAME eq \$\{PRODUCT_FILENAME\}\.exe" \/NH \| find \/I "\$\{PRODUCT_FILENAME\}\.exe" >nul'/,
    "the probe must ask tasklist for the image name (no path prefix, no plugin)",
  );
  assert.doesNotMatch(body, /StartsWith|Get-CimInstance|Stop-Process|taskkill/, "the wait must not kill anything");
  assert.doesNotMatch(body, /\$INSTDIR/, "the wait must not judge by the install path");
  assert.doesNotMatch(body, /nsProcess::/, "the nsProcess plugin is not in the packaged plugin set");

  // 有界轮询：静默上限 60 秒（题干要求 ≤60s），交互先给 10 秒再问人。
  assert.match(body, /StrCpy \$R4 "60"/, "the silent bound must be 60 seconds");
  assert.match(body, /StrCpy \$R4 "10"/, "interactive runs ask after a short grace period");
  assert.match(body, /IntCmp \$R1 \$R4 rf_soft_wait_timeout/, "the loop must be bounded by that value");
  assert.match(body, /Sleep 1000/, "polling interval");

  // 静默分支：不弹框、不中止 —— 只把"应用仍在运行"写进日志并放弃。
  const silentAt = body.indexOf('StrCmp $RFSilent "1" 0 rf_soft_wait_ask');
  const askAt = body.indexOf("rf_soft_wait_ask:");
  assert.ok(silentAt > 0 && askAt > silentAt, "the silent branch must be a separate, clearly delimited block");
  const silent = body.slice(silentAt, askAt);
  assert.doesNotMatch(silent, /MessageBox/, "no dialog on /S: the updater ExecWait's this process");
  assert.doesNotMatch(silent, /Quit|Abort|SetErrorLevel/, "a running app must not abort the install (unlike RF_WaitForAppExit)");
  assert.match(silent, /StrCpy \$RFAppStillRunning "1"/, "silent timeout means 'do not touch the old version'");
  assert.match(silent, /RF_LOG/, "and it must be in the log");

  // 交互分支：我们自己的提示 + 重试（重试要重置计数，否则第二次提问立刻超时）。
  assert.match(
    body,
    /MessageBox MB_RETRYCANCEL\|MB_ICONEXCLAMATION "\$\(RF_BRIDGE_APP_RUNNING\)" IDRETRY rf_soft_wait_retry/,
    "the interactive prompt must be ours and offer retry",
  );
  const retryAt = body.indexOf("rf_soft_wait_retry:");
  assert.ok(retryAt > askAt, "the retry label must exist");
  assert.match(body.slice(retryAt), /StrCpy \$R1 "0"\s*\n\s*Goto rf_soft_wait_loop/, "a retry restarts the bounded wait");
  assert.match(body, /StrCpy \$RFAppStillRunning "0"[\s\S]*?RF_LOG "app exited/, "a clean exit must be logged too");
});

test("the abort-confirmation copy knows whether the old version is gone", () => {
  // wizard.nsh 的 .onUserAbort 有两档文案，靠这个标志选。它只能在"旧卸载器 exit 0"
  // 的分支里被置 1，否则取消确认会对用户说错话。
  const body = preUninstallBody();
  const okAt = body.indexOf('${If} $R0 == "0"');
  const failAt = body.indexOf("pre-uninstall: FAILED");
  assert.ok(okAt >= 0 && failAt > okAt, "the exit-code branch must exist");
  const okBlock = body.slice(okAt, failAt);
  assert.match(okBlock, /StrCpy \$RFOldVersionRemoved "1"/, "the flag is set when the old version really went away");
  assert.strictEqual(
    (body.match(/StrCpy \$RFOldVersionRemoved "1"/g) || []).length,
    1,
    "and nowhere else (a failed uninstall must not claim the old version is gone)",
  );
});

test("the bridge is silent and runs after the user data is safe", () => {
  const body = preUninstallBody();
  assert.doesNotMatch(body, /MessageBox/, "no dialog: the auto-updater waits on this process with ExecWait");
  assert.match(body, /DetailPrint/, "failures still need a trace in the details view");
  assert.match(
    body,
    /\$\{ElseIf\} \$RFRescueState == "ok"[^\n]*\n\s*!insertmacro RF_LOG "pre-uninstall: skipped/,
    "when the rescued data lives only in $PLUGINSDIR, keep the old path: cancelling must not lose it",
  );

  // 顺序：先抢救（RF_CopyTree 把数据搬出来），再卸旧（旧卸载器会删掉整个 $INSTDIR）。
  const rescue = code(readRescue());
  const copyAt = rescue.indexOf("Call RF_CopyTree");
  const callAt = rescue.indexOf("!insertmacro RF_PREEMPTIVE_UNINSTALL");
  assert.ok(copyAt > 0 && callAt > copyAt, "the bridge must run after the data rescue, never before");
  const initAt = rescue.indexOf("!macro customInit");
  const initEnd = rescue.indexOf("!macroend", initAt);
  assert.ok(callAt > initAt && callAt < initEnd, "the bridge belongs inside customInit (before installUtil runs)");
});
