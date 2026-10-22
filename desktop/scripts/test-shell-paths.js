// SPDX-License-Identifier: Apache-2.0
"use strict";

// 运行期可写位置的回归用例（故障诊断 P0，2026-10）。
//
// 缺陷：桌面壳把日志/pid 记录写进应用包内部（payload/runtime/...）。打包态那里
// 只读——mac 从 dmg 运行走 AppTranslocation，Windows 装进管理员目录也会 EPERM
// ——而 start() 里的 mkdir 没有兜底，于是"日志初始化失败"直接让壳起不来。
//
// 这里固化的契约：
//   1. logFile() 永远指向用户目录，绝不包含 payload/projectRoot；
//   2. payload 不可写时 start() 不抛，日志降级到系统临时目录并真的落盘；
//   3. pid 记录：打包态写 runtimeDir，开发树仍写 projectRoot/runtime，
//      读取时两种位置都能读到（兜底启动器还会往 payload 写记录）。
//
// 前两条在修复前必红：那时候 1) 路径就是 payload/runtime/logs/...，
// 2) 只读 payload 下 mkdir 直接抛 ENOTDIR/EPERM。

const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");

const { BackendManager } = require("../backend-manager");
const {
  createFileLogger,
  launcherStateEnv,
  logHint,
  probeWritable,
  resolveLogDir,
} = require("../lib/shell-paths");
const {
  preflightNoticeText,
  presentPreflightNotice,
  runPreflight,
} = require("../lib/preflight");
const { makeTempRoot } = require("./testkit");

// 跨平台的"不可写"手法：把一个普通文件当目录用。mkdir 在任何平台都会失败
// （Windows ENOTDIR/ENOENT，POSIX ENOTDIR），不依赖 chmod/ACL，也不需要管理员。
function blockWithFile(root, name) {
  const blocker = path.join(root, name);
  fs.writeFileSync(blocker, "not a directory");
  return blocker;
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // pid 留空：attachBackendChild 只在有整数 pid 时去写 pid 记录，
  // 这条用例要验证的是日志，不是记录。
  child.pid = undefined;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {};
  return child;
}

// 写日志用的是 createWriteStream（异步打开 + 缓冲写）：文件出现和内容落盘都比
// start() 返回晚，所以这里等一小会儿，而不是立刻 readFileSync。
async function waitForLogContent(logPath, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = fs.readFileSync(logPath, "utf-8");
      if (text.length > 0) return text;
    } catch {
      // 文件还没创建出来，继续等。
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return fs.readFileSync(logPath, "utf-8");
}

// --- 1. 路径形状 ---------------------------------------------------------------

test("logFile() 永远在用户目录里，绝不包含 payload/projectRoot（P0）", () => {
  const payload = path.join(os.tmpdir(), "rf-payload-readonly");
  const runtime = path.join(os.tmpdir(), "rf-user-runtime");
  const manager = new BackendManager(payload, runtime);

  const logFile = manager.logFile();
  assert.strictEqual(
    logFile,
    path.join(runtime, "logs", "desktop-backend.log"),
    "后端日志必须落在 runtimeDir（用户目录）下",
  );
  assert.strictEqual(
    logFile.startsWith(payload),
    false,
    `日志路径不能位于安装 payload 内：${logFile}`,
  );
  assert.strictEqual(
    logFile.includes(path.join(payload, "runtime")),
    false,
    "payload/runtime/logs 是修复前的错误位置（只读，写不进去）",
  );
});

// --- 2. 只读 payload 下的启动 ---------------------------------------------------

test("只读 payload：start() 不抛，日志降级到临时目录并真的落盘（P0）", async () => {
  const root = makeTempRoot("readonly-payload");
  // 把临时目录重定向到本用例自己的地盘，降级落点才是可断言、可清理的。
  const isolatedTmp = path.join(root, "tmp");
  fs.mkdirSync(isolatedTmp, { recursive: true });
  const savedTmp = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TMPDIR = isolatedTmp;
  process.env.TEMP = isolatedTmp;
  process.env.TMP = isolatedTmp;
  try {
    const blocker = blockWithFile(root, "blocked");
    // 安装 payload 与 runtimeDir 都在一个普通文件下面：mkdir 必然失败，
    // 这正是"安装目录只读"的可复现形态。
    const payload = path.join(blocker, "payload");
    const runtimeDir = path.join(blocker, "runtime");

    const manager = new BackendManager(payload, runtimeDir, {
      packaged: true,
      spawnFn: () => fakeChild(),
    });
    manager.isHealthy = async () => true; // 后端立刻健康，用例只关心日志

    const url = await manager.start(() => {});
    assert.ok(url.startsWith("http://127.0.0.1:"), "启动必须成功，日志问题不得阻断启动");

    const logPath = manager.logPath;
    assert.ok(logPath, "降级后仍应有一个实际写入的日志路径");
    assert.strictEqual(manager.logDegraded, true, "写不到用户目录时必须标记为降级");
    assert.strictEqual(
      logPath.startsWith(payload),
      false,
      "降级也不能退回 payload（那里永远写不进去）",
    );
    assert.strictEqual(
      logPath,
      path.join(isolatedTmp, "ResumeForge", "logs", "desktop-backend.log"),
      "首选降级位置是系统临时目录",
    );
    assert.match(await waitForLogContent(logPath), /desktop launch/,
      "降级位置的日志里必须有本次启动的横幅（说明真的写进去了）");

    // 用户可见的提示必须给出真实路径，而不是 payload 里的死路径。
    assert.match(manager.logHint(), /ResumeForge/);
    assert.match(manager.degradedLogNotice(), /临时目录|不可用/);
    manager.closeLog();
  } finally {
    process.env.TMPDIR = savedTmp.TMPDIR;
    process.env.TEMP = savedTmp.TEMP;
    process.env.TMP = savedTmp.TMP;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("用户目录可写时日志就近写入 runtimeDir，不算降级", () => {
  const root = makeTempRoot("writable-runtime");
  try {
    const resolved = resolveLogDir({ runtimeDir: path.join(root, "runtime") });
    assert.strictEqual(resolved.dir, path.join(root, "runtime", "logs"));
    assert.strictEqual(resolved.degraded, false);
    assert.strictEqual(resolved.reason, "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("两个候选目录都不可写时返回 dir=null 和可读的原因，绝不抛", () => {
  const root = makeTempRoot("no-writable-dir");
  try {
    const blocker = blockWithFile(root, "blocked");
    const resolved = resolveLogDir({
      runtimeDir: path.join(blocker, "runtime"),
      tmpDir: path.join(blocker, "tmp"),
    });
    assert.strictEqual(resolved.dir, null);
    assert.strictEqual(resolved.degraded, true);
    assert.match(resolved.reason, /不可写/);
    assert.strictEqual(resolved.candidates.length, 2, "两个候选都要报告出来，便于诊断");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("probeWritable 只看能不能真写：普通文件下面的路径一律 false", () => {
  const root = makeTempRoot("probe");
  try {
    assert.strictEqual(probeWritable(path.join(root, "ok")), true);
    const blocker = blockWithFile(root, "blocked");
    assert.strictEqual(probeWritable(path.join(blocker, "logs")), false);
    assert.strictEqual(probeWritable(null), false);
    // 探测文件不许残留。
    const leftovers = fs.readdirSync(path.join(root, "ok")).filter((name) =>
      name.startsWith(".rf-write-probe-"));
    assert.deepStrictEqual(leftovers, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createFileLogger 吞掉一切异常（日志不能把壳带下去）", () => {
  const root = makeTempRoot("file-logger");
  try {
    const blocker = blockWithFile(root, "blocked");
    const log = createFileLogger(() => path.join(blocker, "logs"));
    assert.doesNotThrow(() => log("写到不可写目录"));
    assert.doesNotThrow(() => createFileLogger(() => {
      throw new Error("目录解析自己炸了");
    })("x"));
    assert.doesNotThrow(() => createFileLogger(() => null)("没有目录可用"));

    const realDir = path.join(root, "logs");
    createFileLogger(() => realDir)("hello");
    const written = fs.readFileSync(path.join(realDir, "desktop-main.log"), "utf-8");
    assert.match(written, /^\d{4}-\d{2}-\d{2}T.* hello$/m, "正常路径要带 ISO 时间戳");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("logHint 只说人话：有路径给路径，没有就直说不可用", () => {
  assert.strictEqual(logHint("D:/user/runtime/logs/x.log", false), "D:/user/runtime/logs/x.log");
  assert.match(logHint("D:/user/runtime/logs/x.log", true), /临时目录/);
  assert.match(logHint(null, true), /不可用/);
});

// --- 3. pid 记录的位置 ---------------------------------------------------------

test("pid 记录：打包态写 runtimeDir，开发树仍写 projectRoot/runtime", () => {
  const root = makeTempRoot("pid-dir");
  try {
    const runtimeDir = path.join(root, "user-runtime");
    const packagedManager = new BackendManager(root, runtimeDir, { packaged: true });
    assert.strictEqual(
      packagedManager.adoptedPidFile(),
      path.join(runtimeDir, "backend.json"),
      "打包态的安装目录只读，记录只能写用户目录",
    );
    assert.strictEqual(
      packagedManager.adoptedPidMacosFile(),
      path.join(runtimeDir, "backend.macos.pid"),
      "文件名与 start.sh 写出的保持一致",
    );

    const devManager = new BackendManager(root, runtimeDir, { packaged: false });
    assert.strictEqual(
      devManager.adoptedPidFile(),
      path.join(root, "runtime", "backend.json"),
      "开发树的 start.cmd / stop.cmd 仍按仓库内 runtime/ 找记录",
    );
    assert.strictEqual(
      devManager.readAdoptedPid(),
      null,
      "没有记录时读取返回 null，不抛",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readAdoptedRecord：用户目录优先，payload 下的历史记录仍可兜底读到", () => {
  const root = makeTempRoot("pid-read-both");
  try {
    const runtimeDir = path.join(root, "user-runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const manager = new BackendManager(root, runtimeDir, { packaged: true });

    // 兜底启动器（start.sh）写进 payload 的历史记录：读得到，才停得掉后端。
    fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "runtime", "backend.macos.pid"),
      "process_id=222\nstarted_at=2026-10-13T00:00:00Z\n",
    );
    assert.strictEqual(manager.readAdoptedRecord().pid, 222,
      "payload 下的历史记录必须能兜底读到");

    // 两个位置都有记录时，写入位置（用户目录）优先。
    fs.writeFileSync(
      manager.adoptedPidFile(),
      JSON.stringify({ process_id: 111, started_at: "2026-10-14T00:00:00Z" }),
    );
    assert.strictEqual(manager.readAdoptedRecord().pid, 111,
      "用户目录的记录必须优先于 payload 里的旧记录");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("打包态 pid 记录的目录不在 payload 里（安装目录只读）", () => {
  const root = makeTempRoot("pid-write-packaged");
  try {
    const runtimeDir = path.join(root, "user-runtime");
    const manager = new BackendManager(root, runtimeDir, { packaged: true });
    assert.strictEqual(
      path.dirname(manager.adoptedPidFile()),
      runtimeDir,
      "打包态的唯一写入目录是用户目录",
    );
    // 目录是按需创建的：写入动作之前不应该有任何副作用。
    assert.strictEqual(fs.existsSync(path.join(root, "runtime")), false,
      "构造管理器不该去创建 payload/runtime");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 5. 启动前体检与提示 -------------------------------------------------------

test("runPreflight：正常环境 ok；不可写时给出 degraded 与每个目录的结论", () => {
  const root = makeTempRoot("preflight");
  try {
    const healthy = runPreflight({ runtimeDir: path.join(root, "runtime"), tmpDir: path.join(root, "tmp") });
    assert.strictEqual(healthy.ok, true);
    assert.strictEqual(healthy.degraded, false);
    assert.strictEqual(healthy.logDir, path.join(root, "runtime", "logs"));
    assert.deepStrictEqual(healthy.targets.map((t) => t.writable), [true, true]);

    const blocked = blockWithFile(root, "blocked");
    const degraded = runPreflight({
      runtimeDir: path.join(blocked, "runtime"),
      tmpDir: path.join(root, "tmp"),
    });
    assert.strictEqual(degraded.ok, false, "首选目录不可写 -> ok=false（但绝不阻断启动）");
    assert.strictEqual(degraded.degraded, true);
    assert.strictEqual(degraded.logDir, path.join(root, "tmp", "ResumeForge", "logs"),
      "体检结论必须和日志实际落点一致");
    assert.deepStrictEqual(degraded.targets.map((t) => t.writable), [false, false]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("降级提示是给人看的：有路径、有原因、没有 EPERM/ENOENT 原文", () => {
  const text = preflightNoticeText({
    logDir: "/tmp/ResumeForge/logs",
    reason: "安装目录不可写，日志已切换到系统临时目录",
  });
  assert.match(text.detail, /\/tmp\/ResumeForge\/logs/, "必须告诉用户日志在哪");
  assert.match(text.detail, /安装目录不可写/, "必须说明原因");
  assert.doesNotMatch(`${text.message}${text.detail}`, /EPERM|ENOENT|errno/i,
    "面向用户/诊断的文案不能出现原始 errno");

  const nothing = preflightNoticeText({ logDir: null, runtimeDir: null, reason: "都不可写" });
  assert.match(nothing.detail, /不会被保存/, "完全不可写时要说清楚后果");
});

test("presentPreflightNotice：第二条按钮才打开目录，任何缺失都安全", async () => {
  const calls = [];
  const dialog = {
    showMessageBox: async () => {
      calls.push("dialog");
      return { response: 1 };
    },
  };
  const shell = { openPath: async (target) => calls.push(`open:${target}`) };
  const info = { logDir: "/tmp/ResumeForge/logs", degraded: true, reason: "x" };

  await presentPreflightNotice({ dialog, shell, info });
  assert.deepStrictEqual(calls, ["dialog", "open:/tmp/ResumeForge/logs"]);

  // 选"知道了"不打开目录。
  const opened = [];
  await presentPreflightNotice({
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    shell: { openPath: async (target) => opened.push(target) },
    info,
  });
  assert.deepStrictEqual(opened, [], "默认按钮不该打开目录");

  // 没有 dialog / dialog 抛错 / 没有 shell：一律安静返回，不阻断启动。
  assert.strictEqual(await presentPreflightNotice({ info }), null);
  assert.strictEqual(await presentPreflightNotice({
    dialog: { showMessageBox: async () => { throw new Error("no display"); } },
    shell,
    info,
  }), null);
  await assert.doesNotReject(presentPreflightNotice({
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    shell: null,
    info,
  }));
});

test("mac 打包态把状态目录传给 start.sh：它拼出的 runtime 必须等于壳的 runtimeDir", () => {
  // 壳的 runtimeDir()（mac 分支）与 start.sh 的默认值站在同一层：userData 已经
  // 按 productName 分好目录，壳不再多拼一层 ResumeForge。
  const runtimeDir = "/Users/x/Library/Application Support/ResumeForge/runtime";
  const env = launcherStateEnv({ packaged: true, runtimeDir, platform: "darwin" });
  assert.deepStrictEqual(env, {
    RF_STATE_DIR: "/Users/x/Library/Application Support/ResumeForge",
  });
  // common.sh 的 rf_resolve_runtime_dir 拼的是 STATE_HOME/runtime：两边必须一致，
  // 否则 start.sh 写的 backend.macos.pid 壳读不到，退出后后端还在占端口。
  assert.strictEqual(path.posix.join(env.RF_STATE_DIR, "runtime"), runtimeDir);

  // 旧版 runtimeDir()（多拼一层 ResumeForge）也必须满足同一条不变量：注入的永远
  // 是 path.dirname(runtimeDir)，与路径里各层叫什么名字无关。
  const doubled = "/Users/x/Library/Application Support/ResumeForge/ResumeForge/runtime";
  const doubledEnv = launcherStateEnv({ packaged: true, runtimeDir: doubled, platform: "darwin" });
  assert.strictEqual(path.posix.join(doubledEnv.RF_STATE_DIR, "runtime"), doubled);

  // 其它形态不注入：开发树不走兜底启动器，Windows 的启动器是另一套记录格式。
  assert.deepStrictEqual(launcherStateEnv({ packaged: false, runtimeDir, platform: "darwin" }), {});
  assert.deepStrictEqual(launcherStateEnv({ packaged: true, runtimeDir, platform: "win32" }), {});
  assert.deepStrictEqual(launcherStateEnv({ packaged: true, runtimeDir: null, platform: "darwin" }), {});
});

// --- 6. 启动失败信息不说谎 -----------------------------------------------------

test("启动失败信息里带的是真实日志位置，不是 payload 死路径", async () => {
  const root = makeTempRoot("hint-in-error");
  try {
    const payload = path.join(root, "payload");
    const runtimeDir = path.join(root, "runtime");
    const child = fakeChild();
    const manager = new BackendManager(payload, runtimeDir, {
      packaged: true,
      spawnFn: () => child,
    });
    // 用"spawn 异步报错"这条真实失败路径：错误信息必须指向用户目录下的日志。
    manager.isHealthy = async () => {
      child.emit("error", new Error("synthetic ENOENT"));
      return false;
    };

    let caught = null;
    try {
      await manager.start(() => {});
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "spawn 失败必须以错误结束启动");
    assert.match(caught.message, /synthetic ENOENT/);
    assert.ok(
      caught.message.includes(path.join(runtimeDir, "logs", "desktop-backend.log")),
      `错误信息必须给出真实日志路径：${caught.message}`,
    );
    assert.strictEqual(caught.message.includes(payload), false,
      "错误信息不能把用户引向只读的 payload");
    manager.closeLog();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
