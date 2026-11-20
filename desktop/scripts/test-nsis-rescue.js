// SPDX-License-Identifier: Apache-2.0
"use strict";

// Tests for nsis/legacy-data-rescue.nsh (2026-10-14, 1.0.0 upgrade data-preservation fix).
//
// Why this exists: the published 0.18.0 installer wrote user data inside the install
// payload, and an NSIS in-place upgrade runs the OLD uninstaller first -- which moves
// the whole install directory away and deletes it. Without the rescue hook the user's
// database/attachments/backups are destroyed before the new shell can migrate them.
//
// The .nsh itself is only compiled during packaging (CI's desktop-shell job builds the
// installer right after running this suite, so a syntax error still fails the build).
// These checks pin the properties a refactor could silently drop:
//   1. electron-builder.yml actually includes the file (an un-referenced .nsh is dead code);
//   2. the file carries a UTF-8 BOM (Unicode NSIS reads BOM-less files in the system
//      codepage, which would garble the Chinese user-facing message boxes);
//   3. the whole file is wrapped in !ifndef BUILD_UNINSTALLER (electron-builder compiles
//      custom includes into the uninstaller build too, where non-`un.` Functions are
//      invalid);
//   4. both customInit and customInstall macros are defined (electron-builder's hooks);
//   5. the failure paths are fail-closed: abort on a running app, abort on copy/verify
//      failure, never overwrite an existing database at the destination.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const DESKTOP = path.join(__dirname, "..");
const RESCUE = path.join(DESKTOP, "nsis", "legacy-data-rescue.nsh");
const YAML = path.join(DESKTOP, "electron-builder.yml");

function readRescue() {
  return fs.readFileSync(RESCUE, "utf8");
}

test("electron-builder.yml includes the rescue script", () => {
  const yaml = fs.readFileSync(YAML, "utf8");
  const match = /^\s*include:\s*(\S+)\s*$/m.exec(yaml);
  assert.ok(match, "electron-builder.yml must declare nsis.include");
  const target = path.join(DESKTOP, match[1]);
  assert.strictEqual(target, RESCUE, `nsis.include should point at ${RESCUE}`);
  assert.ok(fs.existsSync(RESCUE), "the include file must exist on disk");
});

test("the rescue script starts with a UTF-8 BOM", () => {
  const bytes = fs.readFileSync(RESCUE);
  assert.deepStrictEqual(
    [...bytes.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    "Unicode NSIS reads BOM-less sources in the ANSI codepage; Chinese messages would be garbled",
  );
});

// 注意用例名只说"抢救体"：文件顶部故意有**不属于**这个守卫的内容——`LogicLib` 的
// include 与 `customHeader` 里的 26 条 `LangString RF_SHORTCUT`。它们是"两趟都要编"的
// 例外：卸载器也会调用 setLinkVars 算快捷方式路径（见下面 customHeader 那条用例），
// 所以必须同时出现在安装器与卸载器两个构建里。
//
// 2026-11-19（WF-07/WF-08）：文件末尾多了一行 `!include "${__FILEDIR__}\wizard.nsh"`，
// **故意放在守卫之外**——wizard.nsh 里既有安装器页面也有卸载器页面，卸载器那一趟会
// 整段跳过守卫，放进去就等于卸载器没有自己的页面。守卫的语义因此变成"抢救体只编进
// 安装器"，由下面三条断言钉住：守卫恰好一处、抢救体在守卫内、向导 include 在守卫之后。
test("the rescue body compiles into the installer only", () => {
  const source = readRescue();
  const guards = source.match(/!ifndef\s+BUILD_UNINSTALLER/g) || [];
  assert.strictEqual(guards.length, 1, "exactly one BUILD_UNINSTALLER guard");

  const guardAt = source.search(/!ifndef\s+BUILD_UNINSTALLER/);
  const closeAt = source.lastIndexOf("\n!endif");
  assert.ok(closeAt > guardAt, "the guard must be closed before the shared wizard include");
  for (const marker of ["!macro customInit", "!macro customInstall", "Function RF_CopyTree"]) {
    const at = source.indexOf(marker);
    assert.ok(
      at > guardAt && at < closeAt,
      `${marker} must stay inside the installer-only guard (uninstallers cannot use non-un. functions)`,
    );
  }

  const lastLine = source.trimEnd().split("\n").pop().trim();
  assert.strictEqual(
    lastLine,
    '!include "${__FILEDIR__}\\wizard.nsh"',
    "the shared wizard include must come after the guard closes (the uninstaller build skips the guard)",
  );
  assert.ok(
    fs.existsSync(path.join(DESKTOP, "nsis", "wizard.nsh")),
    "the included wizard.nsh must exist",
  );
  const wizard = fs.readFileSync(path.join(DESKTOP, "nsis", "wizard.nsh"));
  assert.deepStrictEqual(
    [...wizard.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    "wizard.nsh carries Chinese copy, so it needs a UTF-8 BOM as well",
  );
});

test("both electron-builder hooks are defined", () => {
  const source = readRescue();
  assert.match(source, /^!macro customInit$/m, "customInit runs before the old uninstaller");
  assert.match(source, /^!macro customInstall$/m, "customInstall restores the data afterwards");
});

test("the rescue is keyed on resume_forge.db and never overwrites an existing database", () => {
  const source = readRescue();
  assert.match(source, /resume_forge\.db/, "the migration criterion is the database file");
  // Destination guard: restore only when the target does not already hold a database.
  assert.match(
    source,
    /IfFileExists\s+"\$INSTDIR\\\$\{RF_LEGACY_RELATIVE\}\\resume_forge\.db"\s+rf_restore_done\s+0/,
    "customInstall must skip the copy when the new payload already has a database",
  );
  // Already-migrated guard: the app writes migrated-away.json into the legacy dir
  // after a successful migration (desktop/lib/data-migration.js), and the hook must
  // decide from install-directory files alone -- never by guessing the app's user
  // data path (%APPDATA% can hold another install's database, and the shell
  // supports --user-data-dir; the 2026-10-14 drill skipped a rescue exactly that way).
  assert.match(
    source,
    /IfFileExists\s+"\$RFOldDataDir\\migrated-away\.json"/,
    "customInit must skip the rescue only on the app-written archival marker",
  );
  // ($APPDATA is still allowed as a last-resort *write* target when the restore
  // fails; what the hook must never do is READ a user-profile database to decide.)
  assert.doesNotMatch(
    source,
    /\$APPDATA[^\n]*resume_forge\.db/,
    "the skip decision must not read a user-profile database path",
  );
});

test("the rescue fails closed on a running app and on copy failure", () => {
  const source = readRescue();
  // Running app: wait, then abort with an explanation instead of copying a live database.
  // 判据是"有没有探测进程在跑"，不是"用不用 nsProcess"：该插件不在 electron-builder
  // 的 NSIS 插件目录里（2026-11-19 实测 `Plugin not found, cannot call
  // nsProcess::_FindProcess`），所以改成系统自带的 tasklist + find。
  assert.match(
    source,
    /nsExec::Exec[^\n]*tasklist[^\n]*find\s+\/I\s+"\$\{PRODUCT_FILENAME\}\.exe"/,
    "must check whether the app is running",
  );
  const aborts = source.match(/\bAbort\b/g) || [];
  assert.strictEqual(aborts.length, 2, "exactly two abort paths: app running, rescue copy failed");
  assert.match(
    source,
    /MessageBox[^\n]*(原样保留|保持原样)/,
    "the abort message must promise the old data is untouched",
  );
  // Byte-for-byte verification while copying is what makes the abort meaningful.
  assert.match(source, /StrCmp\s+\$R6\s+\$R7/, "copy verification compares source and destination sizes");
});

// 26 种语言 = electron-builder 26.17.0 默认打包集（app-builder-lib/out/util/langs.js
// 的 bundledLanguages，未配置 installerLanguages 时全打包）。少一条就会让该语言下
// $(RF_SHORTCUT) 解析成空串 —— 实测 $LANGUAGE=1031 时快捷方式变成 ".lnk"。
const BUNDLED_LCIDS = [
  1033, 1031, 1036, 3082, 2052, 1028, 1041, 1042, 1040, 1043, 1030, 1053, 1044, 1035, 1049, 2070,
  1046, 1045, 1058, 1029, 1051, 1038, 1025, 1055, 1054, 1066,
];
const CHINESE_LCIDS = new Set([2052, 1028]);

test("the shortcut name is a LangString that every bundled language defines", () => {
  const yaml = fs.readFileSync(YAML, "utf8");
  const shortcut = /^\s*shortcutName:\s*"(\$\(RF_SHORTCUT\))"\s*$/m.exec(yaml);
  assert.ok(
    shortcut,
    'nsis.shortcutName must be "$(RF_SHORTCUT)" so the name follows the system language',
  );
  assert.strictEqual(shortcut[1], "$(RF_SHORTCUT)");

  const source = readRescue();
  const defined = new Map();
  for (const match of source.matchAll(/^\s*LangString RF_SHORTCUT (\d+) "([^"]*)"/gm)) {
    defined.set(Number(match[1]), match[2]);
  }
  assert.strictEqual(
    defined.size,
    BUNDLED_LCIDS.length,
    "exactly one LangString RF_SHORTCUT per bundled language",
  );
  for (const lcid of BUNDLED_LCIDS) {
    assert.ok(defined.has(lcid), `LangString RF_SHORTCUT ${lcid} is missing`);
    const expected = CHINESE_LCIDS.has(lcid) ? "简历通" : "ResumeForge";
    assert.strictEqual(defined.get(lcid), expected, `RF_SHORTCUT ${lcid} must read ${expected}`);
  }
  assert.deepStrictEqual(
    [...defined.keys()].filter((lcid) => !BUNDLED_LCIDS.includes(lcid)),
    [],
    "no LangString for a language electron-builder does not pack",
  );
});

test("customHeader is defined outside the installer-only guard", () => {
  const source = readRescue();
  const headerIndex = source.indexOf("!macro customHeader");
  const guardIndex = source.indexOf("!ifndef BUILD_UNINSTALLER");
  assert.ok(
    headerIndex >= 0,
    "customHeader must exist: it is the only hook expanded after addLangs loads the languages",
  );
  // The uninstaller build calls setLinkVars too (templates/nsis/uninstaller.nsh), so
  // $(RF_SHORTCUT) must stay resolvable there even though the rescue body must not compile in.
  assert.ok(
    headerIndex < guardIndex,
    "customHeader must sit before the BUILD_UNINSTALLER guard",
  );
});

test("every user-facing message box is bilingual", () => {
  const source = readRescue();
  const branches = (source.match(/\$\{If\} \$LANGUAGE/g) || []).length;
  assert.ok(branches > 0, "the installer messages must branch on $LANGUAGE");

  // 逐块校验，而不是**全文件**数 `${Else}` / `${EndIf}`：2026-11-2x 加了抢占式卸旧
  // （RF_PREEMPTIVE_UNINSTALL，里面有 4 组自己的 ${If}/${Else}/${EndIf}）之后，
  // 全文件计数把无关分支也算了进来，守卫于是误红。改成"每个 $LANGUAGE 分支内部
  // 必须有 中文 MessageBox → ${Else} → English MessageBox → ${EndIf}"，
  // 判定比原来更严：只有语言分支里漏了英文那一条才会红。
  const blocks = [...source.matchAll(/\$\{If\} \$LANGUAGE\b[\s\S]*?\$\{EndIf\}/g)];
  assert.strictEqual(blocks.length, branches, "each $LANGUAGE branch must be closed by ${EndIf}");
  for (const match of blocks) {
    const block = match[0];
    const elseAt = block.indexOf("${Else}");
    assert.ok(elseAt > 0, "each language branch needs an ${Else} English fallback");
    const zh = block.slice(0, elseAt);
    const en = block.slice(elseAt);
    assert.strictEqual((zh.match(/^\s*MessageBox\b/gm) || []).length, 1, "one Chinese message box");
    assert.strictEqual((en.match(/^\s*MessageBox\b/gm) || []).length, 1, "one English message box");
  }

  // 剩下的 MessageBox 必须走**本地化文案通道**：`$(RF_...)`，由 wizard.nsh 的 RF_STR
  // 一次铺满 26 个 LCID。原来是"全文件 MessageBox 数 === 语言分支数 × 2"，那个等式在
  // 2026-11-2x 之后不再成立 —— 桥的"旧版本还在运行"提示用 `$(RF_BRIDGE_APP_RUNNING)`
  // 而不是复制一份中文/英文，那是对的写法，却会被纯计数误判成"少了一条英文"。
  //
  // ⚠️ 判据必须是"开引号后**紧跟** LangString"，不能只测"这一行里出现过 $(RF_*)"：
  // QA 注入过 `MessageBox ... "正在恢复数据。$(RF_LOG_HINT)$RFLogFile"` —— 硬编码中文
  // 散文 + 一个 LangString 尾巴，用子串判定 39 条全绿（2026-11-2x 复验发现的真洞）。
  // 允许 LangString 后面接运行期变量（$RFLogFile / $INSTDIR），不允许它前面有散文。
  const ranges = blocks.map((match) => [match.index, match.index + match[0].length]);
  const boxes = [...source.matchAll(/^\s*MessageBox\b[^\n]*$/gm)];
  assert.ok(boxes.length >= branches * 2, "every $LANGUAGE branch box must still be found by the scan");
  for (const box of boxes) {
    const inLanguageBlock = ranges.some(([start, end]) => box.index > start && box.index < end);
    const localized = /^\s*MessageBox\b[^"\n]*"\$\(RF_[A-Z0-9_]+\)/.test(box[0]);
    assert.ok(
      inLanguageBlock || localized,
      `unlocalised message box (neither a $LANGUAGE branch nor an $(RF_*) LangString right after the opening quote): ${box[0].trim()}`,
    );
  }
});

test("the recursive copy detects directories without IfFileExists", () => {
  const source = readRescue();
  // An empty directory (data/exports is one in practice) is "not found" by
  // IfFileExists "<dir>\*.*", so the copy would try to FileOpen it and abort the
  // whole rescue. Directory detection must go through FindFirst (a directory
  // yields "." first even when empty) -- the 2026-10-14 drill caught this.
  assert.match(
    source,
    /FindFirst\s+\$R5\s+\$R6\s+"\$R1\\\$R4\\\*\.\*"\s*\n\s*StrCmp\s+\$R6\s+""\s+rf_copy_file/,
    "directory detection must use FindFirst, not IfFileExists",
  );
  assert.doesNotMatch(
    source,
    /IfFileExists\s+"\$R1\\\$R4\\\*\.\*"/,
    "the empty-directory trap must not come back",
  );
  // Path building must never produce a doubled separator ("...\data\\user_files\x"):
  // CopyFiles sets the error flag on such paths, and the root level (where the
  // shape happens to differ) still succeeds -- a combination that cost a full
  // drill cycle to localise. The root case must therefore be branched explicitly.
  assert.match(
    source,
    /StrCmp\s+\$R9\s+""\s+0\s+rf_paths_nested/,
    "the relative-path prefix must be branched so no doubled separator is built",
  );
});
