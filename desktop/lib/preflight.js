// SPDX-License-Identifier: Apache-2.0
"use strict";

// 启动前的可写性体检（故障诊断 P0）。
//
// 桌面壳要往用户目录写日志和 pid 记录。正常情况下这些目录都可写；出问题的
// 环境（受限账户、被安全软件锁定的临时目录、被清理工具删掉的 runtime 目录）
// 里我们希望**先知道**，再把结论写进日志、用一个非阻断的提示告诉用户日志去了
// 哪里——而不是等到某次 mkdir 抛出去把启动打断。
//
// 这里只做探测与文案，不改变任何行为：ok=false / degraded=true 都只是信息，
// 调用方（main.js）不允许据此阻断启动。

const path = require("path");
const { createFileLogger, logHint, probeWritable, resolveLogDir } = require("./shell-paths");

const MAIN_LOG_NAME = "desktop-main.log";

// 检查 runtimeDir 本身和 runtimeDir/logs：前者是运行时解包目录，后者是日志
// 目录，两者都可能是"存在的只读目录"或"被文件占住的位置"。
function runPreflight({ runtimeDir, tmpDir } = {}) {
  const targets = [];
  const dirs = [];
  if (runtimeDir) {
    dirs.push(runtimeDir);
    dirs.push(path.join(runtimeDir, "logs"));
  }
  // 探测复用 resolveLogDir 的那一套（真写文件再删），保证"体检结论"和"日志
  // 实际落地位置"永远是同一个判断，不会自相矛盾。
  const resolved = resolveLogDir({ runtimeDir, tmpDir });
  // resolveLogDir 只返回"第一个可写的候选"，其余结论要自己探：体检报告要列出
  // 每个目录的结论，而不是只有最终落点。
  for (const dir of dirs) {
    targets.push({ path: dir, writable: probeWritable(dir) });
  }
  const degraded = resolved.degraded;
  return {
    ok: targets.every((target) => target.writable) && resolved.dir !== null,
    logDir: resolved.dir,
    runtimeDir: runtimeDir || null,
    degraded,
    reason: resolved.reason,
    targets,
  };
}

// 降级时给用户看的说明。文案必须是给人看的：说清"日志去了哪、为什么"，
// 不出现 EPERM / ENOENT 之类的原文（用户拿它没办法，只会以为程序坏了）。
function preflightNoticeText(info = {}) {
  const logDir = info.logDir || info.runtimeDir || "";
  const where = logDir ? `本次运行的诊断日志保存在：\n${logDir}` : "本次运行的诊断日志不会被保存。";
  const why = info.reason ? `\n\n原因：${info.reason}。` : "";
  return {
    message: "诊断日志的位置有变化",
    detail:
      `${where}${why}\n\n` +
      "程序的安装目录通常不允许写入，这是正常现象，不影响正常使用。" +
      "如果之后需要排查问题，可以把这个目录里的日志提供给维护者。",
  };
}

// 非阻断提示：只有两个按钮，第二个顺手把日志目录打开。
// dialog / shell 由调用方注入（main.js 传 electron 的实现），这里全部做防御，
// 因为一个弹不出来的提示绝不该影响启动。
async function presentPreflightNotice({ dialog, shell, info } = {}) {
  if (!dialog || typeof dialog.showMessageBox !== "function") return null;
  const text = preflightNoticeText(info || {});
  let result;
  try {
    result = await dialog.showMessageBox({
      type: "info",
      title: "简历通",
      message: text.message,
      detail: text.detail,
      buttons: ["知道了", "打开日志目录"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
  } catch {
    return null;
  }
  if (result && result.response === 1) {
    const target = (info && (info.logDir || info.runtimeDir)) || "";
    try {
      if (target && shell && typeof shell.openPath === "function") {
        await shell.openPath(target);
      }
    } catch {
      // 打不开目录是可接受的失败：用户已经从文案里拿到了路径。
    }
  }
  return result || null;
}

// 主进程的日志/降级状态装配（main.js 有 500 行预算，接线只留几行）。
//
// logLine 的目录是**懒解析**的：模块加载期不碰文件系统；第一次真正写日志时
// 才探测，preflight() 跑完之后落点被钉在体检结论上，两者永远一致。
// degradedHint 由调用方提供（后端管理器更清楚自己降级到了哪里），返回 null
// 表示"后端还没结论，用体检结论"。
function createShellLogging({ resolveRuntimeDir, degradedHint, fileName = MAIN_LOG_NAME } = {}) {
  let info = null;
  const log = createFileLogger(
    () => (info ? info.logDir : resolveLogDir({ runtimeDir: resolveRuntimeDir() }).dir),
    fileName,
  );

  // 启动前体检：结论先记进日志，再把 logLine 的落点钉到体检结果上。
  function preflight() {
    info = runPreflight({ runtimeDir: resolveRuntimeDir() });
    log(
      `preflight ok=${info.ok} degraded=${info.degraded} logDir=${info.logDir} ` +
        `reason=${info.reason || "-"}`,
    );
    return info;
  }

  // 用户可见的日志位置：后端管理器优先（它是真的在写），其次体检结论。
  function hint() {
    const fromBackend = typeof degradedHint === "function" ? degradedHint() : null;
    if (fromBackend) return fromBackend;
    return info ? logHint(info.logDir, info.degraded) : logHint(null, true);
  }

  return { hint, info: () => info, log, preflight };
}

// 窗口就绪之后再提示降级：启动流程已经跑起来了，用户这时才需要知道"日志去了
// 哪里"。未降级直接返回，调用方可以无条件调用（main.js 因此只留一行接线）。
function announceDegradedOnReady({ window, dialog, shell, info } = {}) {
  if (!info || !info.degraded || !window || typeof window.once !== "function") return;
  window.once("ready-to-show", () => presentPreflightNotice({ dialog, shell, info }));
}

module.exports = {
  MAIN_LOG_NAME,
  announceDegradedOnReady,
  createShellLogging,
  preflightNoticeText,
  presentPreflightNotice,
  runPreflight,
};
