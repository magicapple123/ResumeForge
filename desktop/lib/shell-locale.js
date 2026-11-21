// SPDX-License-Identifier: Apache-2.0
"use strict";

// 壳层文案（托盘 / 原生菜单 / 对话框 / 窗口标题）的双语表与语言裁决。
//
// 为什么要一个独立模块：壳层有 8 个文件会弹用户可见文案（托盘菜单、启动失败、数据迁移、
// 更新安装失败、关闭卡片等），如果各自写 if-else 或各存一份中文，规则一定会漂移。
// 这里就是唯一出处：语言裁决和文案表都只有这一份。
//
// 语言规则必须与 frontend/src/i18n/localeStore.ts 的 detectPreferredLocale 一致：
// zh / zh-* -> 中文，其余（含 C locale 与空串）-> 英文。壳层不引入 i18n 框架，
// 所以这里只做同一条规则的纯函数版本；两边的一致性由两侧用例各钉一条同值断言
// （desktop/scripts/test-shell-locale.js 与 frontend/src/i18n/shellLocaleBridge.test.tsx）。
//
// 只翻用户可见的界面文案。日志、诊断输出（diagnostic-summary.js）保持原样：
// 那些是给维护者 grep 的，翻译会破坏既有检索习惯。

/** 壳层支持的语言。渲染进程推送时只接受这两个值，其它一律忽略。 */
const SHELL_LOCALES = Object.freeze(["zh", "en"]);

/** 不是中文就是英文——与 detectPreferredLocale 的"非中文一律英文"一致。 */
const DEFAULT_SHELL_LOCALE = "en";

/**
 * 把一个语言标签裁决成壳层支持的语言。
 *
 * 规则与 detectPreferredLocale **逐字相同**（zh / zh-* -> 中文，其余 -> 英文），
 * 不额外接受 POSIX 下划线写法——那是环境变量路径自己的事，在
 * resolveShellLocaleFromEnvironment 里先归一化再进来（否则这里就变成第二套规则了）。
 *
 * @param {unknown} tag 系统/应用语言标签
 * @returns {"zh" | "en"}
 */
function resolveShellLocale(tag) {
  if (typeof tag !== "string") return DEFAULT_SHELL_LOCALE;
  const normalized = tag.trim().toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh";
  return DEFAULT_SHELL_LOCALE;
}

/**
 * POSIX 区域设置（zh_CN.UTF-8）归一化成语言标签（zh-CN）：只给环境变量兜底用。
 *
 * @param {string} value
 * @returns {string}
 */
function normalizePosixLocale(value) {
  return String(value).trim().split(".")[0].replace(/_/g, "-");
}

/**
 * 兜底裁决：IPC 到达之前（窗口刚起、界面语言还没确认）用系统语言。
 *
 * Linux 上 app.getLocale() 可能返回空串，所以按顺序取第一个非空候选：
 * app.getLocale() -> env.LC_ALL -> env.LANG -> "en"。
 *
 * @param {string} appLocale app.getLocale() 的返回值（可能为空）
 * @param {Record<string, string | undefined>} [environment] process.env 的可注入替身
 * @returns {"zh" | "en"}
 */
function resolveShellLocaleFromEnvironment(appLocale, environment) {
  const env = environment || {};
  for (const candidate of [appLocale, env.LC_ALL, env.LANG]) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return resolveShellLocale(normalizePosixLocale(candidate));
    }
  }
  return DEFAULT_SHELL_LOCALE;
}

/** 渲染进程经 IPC 推来的值只认 "zh" / "en"；其它（undefined、对象、"fr"）一律返回 null。 */
function normalizeShellLocale(value) {
  return value === "zh" || value === "en" ? value : null;
}

// 文案表：键按用途命名，zh / en 两侧的键集合必须完全一致（有守卫用例逐键比对）。
// 占位符统一用 {name}，由 t() 做一次替换；两条语言里的同名占位符必须一致。
const messages = Object.freeze({
  zh: Object.freeze({
    "app.name": "简历通",

    "tray.tooltip": "简历通",
    "tray.open": "打开简历通",
    "tray.openDataDir": "打开数据目录",
    "tray.openLogDir": "打开日志目录",
    "tray.diagnostics": "复制诊断信息",
    "tray.checkUpdate": "检查更新",
    "tray.askOnClose": "关闭窗口时询问",
    "tray.quit": "退出",

    "menu.error.noWindow": "主窗口不可用",
    "menu.error.noPage": "页面不可用",
    "menu.error.noDirectory": "目录不可用",
    "menu.error.unknownExternal": "未知外链：{key}",
    "menu.error.noReload": "当前页面不支持重新加载",
    "menu.error.noDevTools": "当前页面不支持开发者工具",
    "menu.error.noAlwaysOnTop": "当前平台不支持窗口置顶",
    "menu.error.unknownAction": "未知菜单动作：{action}",

    "preflight.message": "诊断日志的位置有变化",
    "preflight.where": "本次运行的诊断日志保存在：\n{logDir}",
    "preflight.whereNone": "本次运行的诊断日志不会被保存。",
    "preflight.why": "\n\n原因：{reason}。",
    "preflight.body":
      "程序的安装目录通常不允许写入，这是正常现象，不影响正常使用。" +
      "如果之后需要排查问题，可以把这个目录里的日志提供给维护者。",
    "preflight.button.ack": "知道了",
    "preflight.button.openLogDir": "打开日志目录",

    "startupFailure.message": "启动失败",
    "startupFailure.detailWithLog":
      "{message}\n\n诊断日志目录：\n{logDir}\n\n" +
      "把这里的 desktop-main.log 与 desktop-backend.log 提供给维护者，可以定位这次启动失败。",
    "startupFailure.detailNoLog":
      "{message}\n\n本次运行没能写下诊断日志（安装目录与系统临时目录都不可写）。",
    "startupFailure.button.openLogDir": "打开日志目录",
    "startupFailure.button.quit": "退出",

    "quit.installSpawnFailed.body": "更新安装程序未能启动，请保留下载文件后手动重试。",
    "quit.installBlocked.body":
      "更新未安装：后端服务未被确认停止（{reason}）。\n" +
      "为避免覆盖仍在使用数据文件的后端进程，安装已取消。" +
      "请手动结束残留的后端进程后重试更新。",
    "quit.reason.stopTimeout": "停止后端超时",
    "quit.reason.unknown": "未知原因",

    "crashBudget.body":
      "后端服务在 {minutes} 分钟内连续异常退出 {count} 次，已停止自动重启。\n" +
      "诊断日志：{logHint}\n请重新启动应用。",

    "migration.confirm.message": "检测到旧版本数据",
    "migration.confirm.body":
      "检测到旧版本的数据仍保存在安装目录内。是否迁移到新的用户数据目录？" +
      "旧数据将保留备份，迁移失败时旧数据也原样保留。",
    "migration.confirm.repeatNote":
      "\n\n注意：上一次迁移的标记还在，但新位置已经找不到数据库文件" +
      "（可能被移动、删除或同步工具移走）。现在重新迁移会从旧位置再复制一份。",
    "migration.confirm.locations": "\n\n旧位置：{from}\n新位置：{to}",
    "migration.confirm.button.migrate": "迁移",
    "migration.confirm.button.later": "暂不迁移",
    "migration.recovery.title": "数据目录需要确认",
    "migration.recovery.detail":
      "{message}\n\n「创建全新数据库」会删除上一次迁移的标记并在新位置新建一份空数据库。",
    "migration.recovery.button.quit": "退出（先去恢复备份）",
    "migration.recovery.button.createFresh": "创建全新数据库",
    "migration.inconsistent.message":
      "数据目录「{dataDir}」里没有数据库文件，但上一次迁移的标记仍在。\n\n" +
      "应用不会自动新建一份空数据库盖在它上面。请先恢复备份（设置 → 数据 → 导入备份），" +
      "或选择「创建全新数据库」从零开始。",
    "migration.failed.body":
      "数据迁移失败，本次仍按旧的数据位置启动，旧数据完好无损，可下次启动时重试。\n\n" +
      "原因：{reason}",

    // 应用内更新（第 9.3 条）：updater.js 的三个对话框此前是硬编码中文，英文界面
    // 会看到中文。文案里必须留下"数据不会被覆盖"这句——用户明确要求告知，而它是
    // 有事实依据的（数据在用户目录，安装器只写安装目录）。
    "update.available.message": "发现新版本 {version}",
    "update.available.body":
      "将下载并安装更新，安装完成后会自动重新打开。\n\n" +
      "你的简历、岗位与资料都保存在用户目录，更新不会覆盖或删除它们。",
    "update.incomplete.message": "这个版本的安装包还没传全",
    "update.incomplete.body":
      "最新版本是 {version}，但发布页上缺少 {missing}，所以这次没有自动更新。\n\n" +
      "可以稍后再检查一次，或到发布页手动下载安装。",
    "update.upToDate.message": "已是最新版本",
    "update.upToDate.body": "当前版本 {version}，没有可用的更新。",
    "update.failed.message": "更新没有装成",
    "update.failed.body":
      "上一次更新（{from} → {to}）没有安装成功，当前仍是 {from}。\n\n" +
      "你的简历、岗位与资料都保存在用户目录，没有受到任何影响；" +
      "可以手动下载安装包再试一次。\n\n更新日志：{logDir}",
    "update.failed.bodyNoLog":
      "上一次更新（{from} → {to}）没有安装成功，当前仍是 {from}。\n\n" +
      "你的简历、岗位与资料都保存在用户目录，没有受到任何影响；" +
      "可以手动下载安装包再试一次。",
    // 这条"手动下载"出口同时服务 macOS 与 Linux（win32 走 checkAndOfferUpdate，到不了
    // 这里），而两个平台的包形态**相反**：.dmg 拖进「应用程序」 vs 单文件 AppImage
    // 原地替换。所以宁可两条 key，也不要一句"谁都能用、谁都不对"的通用话——此前两者
    // 共用 body，Linux 用户看到的就是"下载 .dmg 拖进应用程序"。
    "update.manual.message": "当前平台的更新需要手动下载",
    "update.manual.body":
      "macOS 版请在发布页下载最新的 .dmg 安装包；打开后把应用拖进「应用程序」即可。",
    // 架构名写 arm64，不是 aarch64：AppImage 的产物名是
    // ResumeForge-<ver>-arm64.AppImage（electron-builder 只对 pacman/rpm/flatpak 把
    // arm64 改写成 aarch64；x64 在 AppImage 上才是 x86_64）。用户要在发布页按名字找
    // 文件，写错就等于指了个不存在的东西——用例里有守卫（test-update-feedback.js）。
    // 版本号写成占位符：这条文案是常驻的，写死某个版本发一次就过期。
    "update.manual.bodyLinux":
      "Linux 版是单文件 AppImage，不需要安装：在发布页按架构（x86_64 / arm64）下载最新的 " +
      ".AppImage 文件（形如 ResumeForge-<版本>-x86_64.AppImage），用它替换你现在启动的那个" +
      "文件即可，重启应用就是新版本。\n\n" +
      "AppImage 运行时挂在只读的 squashfs 上，程序没法就地改自己，所以这一步只能手动做。",
    "update.error.title": "检查更新失败",
    "update.error.body": "请检查网络后重试。\n\n{reason}",
    // 停滞（下载 45 秒零字节）单独一套文案：真实成因通常是代理只通了一半——连得上
    // GitHub、响应头也回来了，正文一个字节都不来。让用户去"检查网络"是查不出问题的，
    // 必须点名代理与手动下载两条出路。
    "update.error.stalled.title": "下载没有进展",
    "update.error.stalled.body":
      "更新包下载了 45 秒仍然没有收到任何数据，已中止。\n\n" +
      "如果必须通过代理访问 GitHub，请确认代理已开启并允许该应用直连；" +
      "也可以到发布页手动下载安装包。",
    "update.button.install": "立即更新",
    "update.button.later": "暂不",
    "update.button.ok": "好",
    "update.button.openReleases": "打开发布页",
    "update.button.close": "关闭",
    "update.failed.button.download": "手动下载",
    "update.failed.button.openLogDir": "打开日志",
    "update.failed.button.ack": "知道了",
  }),
  en: Object.freeze({
    "app.name": "ResumeForge",

    "tray.tooltip": "ResumeForge",
    "tray.open": "Open ResumeForge",
    "tray.openDataDir": "Open data folder",
    "tray.openLogDir": "Open log folder",
    "tray.diagnostics": "Copy diagnostics",
    "tray.checkUpdate": "Check for updates",
    "tray.askOnClose": "Ask when closing the window",
    "tray.quit": "Quit",

    "menu.error.noWindow": "Main window is unavailable",
    "menu.error.noPage": "Page is unavailable",
    "menu.error.noDirectory": "Folder is unavailable",
    "menu.error.unknownExternal": "Unknown external link: {key}",
    "menu.error.noReload": "This page cannot be reloaded",
    "menu.error.noDevTools": "This page does not support developer tools",
    "menu.error.noAlwaysOnTop": "This platform does not support always-on-top",
    "menu.error.unknownAction": "Unknown menu action: {action}",

    "preflight.message": "Diagnostic log location changed",
    "preflight.where": "Diagnostic logs for this run are saved to:\n{logDir}",
    "preflight.whereNone": "Diagnostic logs for this run cannot be saved.",
    "preflight.why": "\n\nReason: {reason}.",
    "preflight.body":
      "The installation folder is usually read-only; this is expected and does not affect normal use. " +
      "If you need to troubleshoot later, you can share the logs in that folder with the maintainers.",
    "preflight.button.ack": "Got it",
    "preflight.button.openLogDir": "Open log folder",

    "startupFailure.message": "Startup failed",
    "startupFailure.detailWithLog":
      "{message}\n\nDiagnostic log folder:\n{logDir}\n\n" +
      "Share desktop-main.log and desktop-backend.log from that folder with the maintainers " +
      "to diagnose this startup failure.",
    "startupFailure.detailNoLog":
      "{message}\n\nThis run could not write diagnostic logs " +
      "(both the installation folder and the system temp folder are read-only).",
    "startupFailure.button.openLogDir": "Open log folder",
    "startupFailure.button.quit": "Quit",

    "quit.installSpawnFailed.body":
      "The update installer could not start. Keep the downloaded file and try again manually.",
    "quit.installBlocked.body":
      "Update not installed: the backend service was not confirmed stopped ({reason}).\n" +
      "The installation was cancelled to avoid overwriting a backend process that may still use data files. " +
      "Stop the remaining backend process manually, then retry the update.",
    "quit.reason.stopTimeout": "backend stop timed out",
    "quit.reason.unknown": "unknown reason",

    "crashBudget.body":
      "The backend service exited unexpectedly {count} times within {minutes} minutes " +
      "and automatic restarts have stopped.\n" +
      "Diagnostic log: {logHint}\nPlease restart the application.",

    "migration.confirm.message": "Older version data detected",
    "migration.confirm.body":
      "Data from an older version is still stored inside the installation folder. " +
      "Migrate it to the new user data folder? " +
      "The old data is kept as a backup, and it stays intact if the migration fails.",
    "migration.confirm.repeatNote":
      "\n\nNote: the marker from the previous migration is still present, but the database at the new location is gone " +
      "(it may have been moved, deleted, or taken away by a sync tool). Migrating again copies the old data once more.",
    "migration.confirm.locations": "\n\nOld location: {from}\nNew location: {to}",
    "migration.confirm.button.migrate": "Migrate",
    "migration.confirm.button.later": "Not now",
    "migration.recovery.title": "Data folder needs confirmation",
    "migration.recovery.detail":
      "{message}\n\n\"Create a new database\" removes the marker from the previous migration " +
      "and creates an empty database in the new location.",
    "migration.recovery.button.quit": "Quit (restore a backup first)",
    "migration.recovery.button.createFresh": "Create a new database",
    "migration.inconsistent.message":
      "The data folder \"{dataDir}\" has no database file, but the marker from the previous migration is still there.\n\n" +
      "The app will not create an empty database over it. Restore a backup first " +
      "(Settings → Data → Import backup), or choose \"Create a new database\" to start from scratch.",
    "migration.failed.body":
      "Data migration failed. This run keeps using the old data location; the old data is intact " +
      "and you can retry on the next launch.\n\nReason: {reason}",

    // In-app update (item 9.3): these three dialogs used to be hard-coded Chinese, so an
    // English UI showed Chinese. The data-safety sentence is mandatory -- the user asked
    // to be told, and it is factually safe (data lives in the user folder; the installer
    // only writes the install folder).
    "update.available.message": "Update available: {version}",
    "update.available.body":
      "The app will download and install the update, then reopen automatically.\n\n" +
      "Your resumes and data live in your user folder and will not be overwritten or deleted.",
    "update.incomplete.message": "This release's installer is not fully uploaded",
    "update.incomplete.body":
      "The latest version is {version}, but {missing} is missing from the release page, " +
      "so nothing was updated automatically this time.\n\n" +
      "Check again later, or download the installer manually from the release page.",
    "update.upToDate.message": "You are up to date",
    "update.upToDate.body": "Current version {version}; no update is available.",
    "update.failed.message": "The update did not install",
    "update.failed.body":
      "The last update ({from} → {to}) did not install successfully; you are still on {from}.\n\n" +
      "Your resumes and data live in your user folder and were not affected. " +
      "You can download the installer manually and try again.\n\nUpdate log: {logDir}",
    "update.failed.bodyNoLog":
      "The last update ({from} → {to}) did not install successfully; you are still on {from}.\n\n" +
      "Your resumes and data live in your user folder and were not affected. " +
      "You can download the installer manually and try again.",
    // Same split as the zh table: this exit serves macOS and Linux, whose package
    // shapes are opposites (.dmg vs single-file AppImage), so one shared sentence
    // would always be wrong for one of them.
    "update.manual.message": "This platform needs a manual download to update",
    "update.manual.body":
      "On macOS, download the latest .dmg from the release page and drag the app into Applications.",
    // Architecture is spelled arm64, not aarch64: AppImages are published as
    // ResumeForge-<ver>-arm64.AppImage (electron-builder only rewrites arm64 to
    // aarch64 for pacman/rpm/flatpak; x64 is x86_64 for AppImage). The version is a
    // placeholder for the same reason as the zh table: this copy is permanent.
    "update.manual.bodyLinux":
      "The Linux build is a single-file AppImage and there is nothing to install: download the " +
      "latest .AppImage for your architecture (x86_64 / arm64) from the release page -- for " +
      "example ResumeForge-<version>-x86_64.AppImage -- and replace the file you are running now. " +
      "Restart the app and you are on the new version.\n\n" +
      "An AppImage runs from a read-only squashfs mount, so the app cannot rewrite itself in " +
      "place; that replacement has to be done by hand.",
    "update.error.title": "Update check failed",
    "update.error.body": "Check your network connection and try again.\n\n{reason}",
    // Same split as the zh table: a stalled download is usually a half-working proxy
    // (GitHub reachable, headers arrive, the body never does), so "check your network"
    // would send the user in the wrong direction.
    "update.error.stalled.title": "Update download stalled",
    "update.error.stalled.body":
      "The update download received no data for 45 seconds and was aborted.\n\n" +
      "If GitHub is only reachable through a proxy, check that the proxy is running and " +
      "allowed for this app; you can also download the installer manually from the release page.",
    "update.button.install": "Update now",
    "update.button.later": "Not now",
    "update.button.ok": "OK",
    "update.button.openReleases": "Open release page",
    "update.button.close": "Close",
    "update.failed.button.download": "Download manually",
    "update.failed.button.openLogDir": "Open log",
    "update.failed.button.ack": "Got it",
  }),
});

/**
 * 取一条壳层文案。
 *
 * 缺 key 时返回 key 本身（界面出现 tray.open 这种字样，比空白更容易被发现），
 * 与前端 translate 的缺 key 约定一致。
 *
 * @param {"zh" | "en"} locale
 * @param {string} key
 * @param {Record<string, string | number>} [params] {name} 占位符的取值
 * @returns {string}
 */
function t(locale, key, params) {
  const table = messages[locale === "zh" ? "zh" : "en"];
  const template = table[key];
  if (typeof template !== "string") return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

module.exports = {
  DEFAULT_SHELL_LOCALE,
  SHELL_LOCALES,
  messages,
  normalizeShellLocale,
  resolveShellLocale,
  resolveShellLocaleFromEnvironment,
  t,
};
