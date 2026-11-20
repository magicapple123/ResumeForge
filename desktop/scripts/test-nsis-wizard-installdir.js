// SPDX-License-Identifier: Apache-2.0
"use strict";

// 安装目录相关三条已知问题（2026-11-2x 复盘 Low 1 / Low 3 / Low 4）的守卫。
//
//   1. 降级不改 $installMode：per-machine 的安装一旦降到 $LOCALAPPDATA，就出现
//      "文件在单用户目录、注册表写 HKLM、快捷方式在 Common 桌面"的三处错位；
//   2. 二次探针覆盖 $RFInstallDirOriginal：RF_WRITE_PROBE 在 customInit 与 rfPrecheck
//      各展开一次，无条件赋值会让收尾日志里的"原始目录"变成目录页选的那个；
//   3. 探针打在"没有应用子目录"的路径上：模板 assistedInstaller.nsh:33-39 的
//      instFilesPre 会在 INSTFILES 之前把 ${APP_FILENAME} 追加到 $INSTDIR。
//
// 与同目录另外两个 NSIS 守卫一样，这些是**文本守卫**：`.nsh` 只在打包时编译，
// 而 CI 的 desktop-shell 作业紧接着真的打一次安装包，语法错/警告在那里暴露。
// 每条断言都对应一个"改回去就必须变红"的实现细节。

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

// 去掉整行注释：关于"脚本做什么"的断言，不能被一句描述它的注释满足。
function code(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function macroBody(source, name) {
  const at = source.indexOf(`!macro ${name}`);
  assert.ok(at >= 0, `!macro ${name} must exist`);
  return source.slice(at, source.indexOf("!macroend", at));
}

function functionBody(source, name) {
  const at = source.indexOf(`Function ${name}`);
  assert.ok(at >= 0, `Function ${name} must exist`);
  return source.slice(at, source.indexOf("FunctionEnd", at));
}

// ---------------------------------------- Low 1：降级不许跨到别的用户上下文

test("a per-machine install never downgrades into a user folder", () => {
  const wizard = code(readWizard());
  const body = macroBody(wizard, "RF_WRITE_PROBE");

  // 降级目标必须按安装方式分档，读的必须是 $RFInstallMode 快照：本宏会在
  // rfPrecheck（header 里就地编译的函数）里展开，那里模板的 $installMode 还不存在
  // （warning 6000 → -WX 打包失败）。
  const branchAt = body.indexOf('${If} $RFInstallMode == "all"');
  const elseAt = body.indexOf("${Else}", branchAt);
  assert.ok(branchAt > 0, "the fallback target must branch on the install mode");
  assert.ok(elseAt > branchAt, "the per-machine branch must have a per-user else");

  const machine = body.slice(branchAt, elseAt);
  assert.match(
    machine,
    /StrCpy \$INSTDIR "\$\{RF_FALLBACK_INSTDIR_MACHINE\}"/,
    "per-machine installs must fall back to a folder in the same user context",
  );
  const perUser = body.slice(elseAt, body.indexOf("${EndIf}", elseAt));
  assert.match(
    perUser,
    /StrCpy \$INSTDIR "\$\{RF_FALLBACK_INSTDIR\}"/,
    "per-user installs keep the electron-builder default fallback",
  );

  // per-machine 的目标必须仍在 $PROGRAMFILES 下：写成 $LOCALAPPDATA 就是把文件
  // 放进用户目录、而注册表与快捷方式还留在机器级位置。
  assert.match(
    wizard,
    /^!define RF_FALLBACK_INSTDIR_MACHINE "\$PROGRAMFILES\\\$\{APP_FILENAME\}"$/m,
    "the per-machine fallback must live under $PROGRAMFILES",
  );
  assert.doesNotMatch(
    wizard,
    /^!define RF_FALLBACK_INSTDIR_MACHINE "\$LOCALAPPDATA/m,
    "the per-machine fallback must not land in a user profile",
  );

  // $installMode 本身一步都不许改：它是"注册表写 HKLM/HKCU、快捷方式放 Common/用户桌面"
  // 的总开关，改了只会让错位更隐蔽（题面明确要求不要动它）。
  //
  // 两个文件都要扫：wizard.nsh 有降级逻辑，而 legacy-data-rescue.nsh 这轮才刚加了
  // `StrCpy $RFInstallMode "$installMode"` 的快照 —— 最该守住"只读不写"的正是它。
  // （只写 $RFInstallMode 是合法的：那是我们自己的副本。这里禁的是对模板变量的任何
  // 写入，包括栈操作绕道。）
  const rescueSource = code(readRescue());
  for (const [file, text] of [
    ["wizard.nsh", wizard],
    ["legacy-data-rescue.nsh", rescueSource],
  ]) {
    for (const op of ["StrCpy", "Pop", "Exch"]) {
      assert.doesNotMatch(
        text,
        new RegExp(`(?:^|\\s)${op}\\s+\\$installMode\\b`, "m"),
        `${file} must never write $installMode (${op}) — it belongs to the template`,
      );
    }
  }
  assert.doesNotMatch(body, /StrCpy \$installMode/, "the downgrade must never rewrite $installMode");
  assert.doesNotMatch(wizard, /StrCpy \$installMode/, "$installMode belongs to the template, not to us");

  // 快照必须在**第一次**写探针之前就落地：customInit 的探针排在 RF_INSTALL_INIT 之前，
  // 若等那里才抄，per-machine 的第一次探针会按 per-user 选目标。
  const init = macroBody(code(readRescue()), "customInit");
  const snapshotAt = init.indexOf('StrCpy $RFInstallMode "$installMode"');
  const probeAt = init.indexOf('!insertmacro RF_WRITE_PROBE "customInit"');
  assert.ok(snapshotAt > 0, "customInit must take the install-mode snapshot itself");
  assert.ok(probeAt > snapshotAt, "and take it before the first probe decides a fallback target");
});

// ------------------------------------- Low 3：$RFInstallDirOriginal 只记一次

test("the original install directory is recorded once, not per probe", () => {
  const body = macroBody(code(readWizard()), "RF_WRITE_PROBE");

  // 本宏展开两次（customInit / rfPrecheck）。无条件赋值会让 precheck 那次覆盖掉
  // "用户原本想装到哪"，收尾日志里的 downgraded=1 与原始目录于是自相矛盾。
  assert.match(
    body,
    /\$\{If\} \$RFInstallDirOriginal == ""\s*\n\s*StrCpy \$RFInstallDirOriginal "\$INSTDIR"\s*\n\s*\$\{EndIf\}/,
    "the original directory must only be recorded while it is still empty",
  );
  assert.strictEqual(
    (body.match(/StrCpy \$RFInstallDirOriginal/g) || []).length,
    1,
    "exactly one assignment: an unconditional one anywhere else defeats the guard",
  );
  // 收尾日志仍然要读它（否则这就是个死变量，makensis 会报 6001）。
  assert.match(body, /original=\$RFInstallDirOriginal/, "the log must keep reporting the original directory");
});

// ---------------------- Low 4：探针要打在实际落盘的目录上（含应用子目录）

test("the precheck probes the directory the files actually land in", () => {
  const wizard = code(readWizard());
  const resolver = functionBody(wizard, "rfResolveFinalInstallDir");

  // 必须与模板同义：instFilesPre 用 StrContains（NSIS 的 StrCmp 不区分大小写，
  // 所以它实际也不区分），这里用 shlwapi 的 StrStrIW。写成区分大小写会让
  // "D:\resumeforge" 这类路径与模板判定分叉，凭空多套一层目录。
  assert.match(
    resolver,
    /System::Call 'shlwapi::StrStrIW\(w "\$INSTDIR", w "\$\{APP_FILENAME\}"\) p \.R6'/,
    "the resolver must reuse the template's case-insensitive substring test",
  );
  assert.match(
    resolver,
    /StrCpy \$INSTDIR "\$INSTDIR\\\$\{APP_FILENAME\}"/,
    "and append the app sub-directory exactly like instFilesPre does",
  );
  // 模板没有 MUI_PAGE_DIRECTORY 时 instFilesPre 根本不存在，不能替它追加。
  assert.match(
    resolver,
    /!ifdef allowToChangeInstallationDirectory/,
    "only mirror the template when the template actually has a directory page",
  );
  // 探测失败不是阻断式失败：这条只负责"把路径补对"。
  assert.doesNotMatch(resolver, /Abort|Quit|SetErrorLevel/, "resolving the path must never fail the install");

  // 顺序：先补目录，再探。反了就等于没修。
  const precheck = functionBody(wizard, "rfPrecheck");
  const resolveAt = precheck.indexOf("Call rfResolveFinalInstallDir");
  const probeAt = precheck.indexOf('!insertmacro RF_WRITE_PROBE "precheck"');
  assert.ok(resolveAt > 0, "rfPrecheck must resolve the final directory");
  assert.ok(probeAt > resolveAt, "the probe must run on the resolved (final) directory");
  assert.match(
    precheck,
    /Call rfResolveFinalInstallDir\s*\n\s*!insertmacro RF_LOG "precheck: final install dir=\$INSTDIR"/,
    "the resolved directory must be in the log (that is what makes a failed install diagnosable)",
  );

  // 注释要留下"为什么不能直接写 ${StrContains}"的线索，否则下一个人会"顺手统一"回
  // 模板那个宏，然后撞上 warning 6000 —— 这个坑本项目已经踩过三次。
  const raw = readWizard();
  const header = raw.slice(raw.indexOf("Function rfResolveFinalInstallDir") - 1600, raw.indexOf("Function rfResolveFinalInstallDir"));
  assert.match(header, /StrContains/, "the comment must explain why ${StrContains} cannot be used here");
  assert.match(header, /instFilesPre/, "and point at the template hook it mirrors");
});
