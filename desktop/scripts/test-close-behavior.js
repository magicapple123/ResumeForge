// SPDX-License-Identifier: Apache-2.0
/**
 * lib/close-behavior.js 的离线用例（问题清单 §18 + 2026-11-20 的真开关）。
 *
 * 这些分支全部是"不可逆"或"看起来没反应"的：选「退出应用」时先置 quitting 再
 * app.quit()（否则无限弹窗）、偏好文件损坏时必须当作"还要询问"（宁可多问一次）、
 * 弹窗未关闭时连点 × 不能叠出第二个框。用**假 dialog / 假 window** 把这些性质
 * 变成字面量断言，而不是靠手点。
 *
 * 2026-11-20 起偏好模型是 `{ ask, action }`（不再是单一的 `remembered`）：
 * 托盘里那项是真开关，关掉询问但没记住动作时**最小化到托盘**。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  PREFERENCE_FILE,
  REMEMBER_MINIMIZE,
  REMEMBER_QUIT,
  createCloseBehavior,
  createPreferenceStore,
  normalizeAction,
  normalizeState,
  readState,
  rememberAction,
  writeAsk,
  writeState,
} = require("../lib/close-behavior");

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeMemoryStore(initial = null) {
  let state = initial ? { ...initial } : { ask: true, action: null };
  const calls = [];
  return {
    readState: () => ({ ...state }),
    writeAsk: (ask) => {
      state = { ask: Boolean(ask), action: state.action };
      calls.push(["ask", state.ask]);
      return true;
    },
    rememberAction: (choice) => {
      state = { ask: false, action: choice };
      calls.push(["remember", choice]);
      return true;
    },
    getAsk: () => state.ask,
    getAction: () => state.action,
    calls,
    read: () => ({ ...state }),
  };
}

/** 假的自绘关闭卡片：队列里写用户最终点了什么（与 close-dialog.html 的回执同形）。 */
function makePromptDial(queue = []) {
  const calls = [];
  return {
    calls,
    promptClose: (parent, options) => {
      calls.push({ parent, options });
      const next = queue.length > 0 ? queue.shift() : { action: "hide", remember: false };
      return Promise.resolve({ action: next.action, remember: Boolean(next.remember) });
    },
  };
}

function makeWindow() {
  return {
    hidden: 0,
    destroyed: false,
    hide() {
      this.hidden += 1;
    },
    isDestroyed() {
      return this.destroyed;
    },
  };
}

function makeBehavior(options = {}) {
  const win = options.win || makeWindow();
  const store = options.store || makeMemoryStore(options.state || null);
  const dialog = options.dialog || makePromptDial(options.queue || []);
  const events = { order: [], preferenceChanged: 0, log: [] };
  let quitting = false;
  const behavior = createCloseBehavior({
    app: {
      quit() {
        events.order.push("app.quit");
      },
    },
    // 用箭头包一层：假 dialog 里 `this.calls.push(...)` 依赖 this，解构出来会丢。
    promptClose: (parent, opts) => dialog.promptClose(parent, opts),
    getWindow: () => win,
    isQuitting: () => quitting,
    setQuitting: (value) => {
      quitting = value;
      events.order.push("setQuitting");
    },
    store,
    platform: options.platform || "win32",
    logLine: (line) => events.log.push(line),
    onPreferenceChanged: () => {
      events.preferenceChanged += 1;
    },
  });
  return { behavior, win, store, dialog, events, getQuitting: () => quitting };
}

const closeEvent = () => {
  const event = {
    prevented: 0,
    preventDefault() {
      this.prevented += 1;
    },
  };
  return event;
};

// ---- 基本分支 ---------------------------------------------------------------

test("quitting 为真：不弹窗、不 preventDefault，放行默认关闭", async () => {
  // 先用一次 close + 「退出应用」响应把 quitting 置真（与真实退出流程一致）。
  const { behavior, dialog } = makeBehavior({ queue: [{ action: "quit", remember: false }] });
  behavior.handleClose(closeEvent());
  await flush();
  const before = dialog.calls.length;
  const second = closeEvent();
  assert.equal(behavior.handleClose(second), true);
  assert.equal(second.prevented, 0, "quitting 时必须放行默认关闭");
  assert.equal(dialog.calls.length, before, "quitting 时不得再弹窗");
});

test("普通 close：preventDefault + 带父窗口的二选一对话框（Esc = 最小化）", async () => {
  const { behavior, win, dialog } = makeBehavior();
  const event = closeEvent();
  assert.equal(behavior.handleClose(event), false);
  assert.equal(event.prevented, 1);
  assert.equal(dialog.calls.length, 1);

  const { parent } = dialog.calls[0];
  assert.equal(parent, win, "自绘卡片必须带父窗口（§18.5，父窗口关闭时连带销毁）");

  await flush();
  assert.equal(win.hidden, 1, "默认响应 = 最小化到托盘");
});

test("选「退出应用」：先 setQuitting(true) 再 app.quit()，且之后的 close 不再弹窗", async () => {
  const { behavior, events, win, getQuitting } = makeBehavior({
    queue: [{ action: "quit", remember: false }],
  });
  behavior.handleClose(closeEvent());
  await flush();
  assert.deepEqual(events.order, ["setQuitting", "app.quit"], "顺序不可交换（否则无限弹窗）");
  assert.equal(getQuitting(), true);
  assert.equal(win.hidden, 0);

  const next = closeEvent();
  assert.equal(behavior.handleClose(next), true, "退出流程中 close 必须放行");
  assert.equal(next.prevented, 0);
});

test("弹窗未关闭时再次触发 close：不产生第二个 dialog", async () => {
  let release;
  const dialog = {
    calls: [],
    promptClose(parent, options) {
      this.calls.push({ parent, options });
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const { behavior } = makeBehavior({ dialog });
  behavior.handleClose(closeEvent());
  behavior.handleClose(closeEvent());
  behavior.handleClose(closeEvent());
  assert.equal(dialog.calls.length, 1, "连点 × 只能叠出一个对话框");
  assert.equal(behavior.isPromptOpen(), true);
  release({ action: "hide", remember: false });
  await flush();
  assert.equal(behavior.isPromptOpen(), false);
});

test("macOS：交给卡片的是 isMac=true（口径退化为「关闭窗口」，不是托盘）", async () => {
  const { behavior, dialog, win } = makeBehavior({ platform: "darwin" });
  behavior.handleClose(closeEvent());
  const { options } = dialog.calls[0];
  assert.equal(options.isMac, true);
  await flush();
  assert.equal(win.hidden, 1, "安全默认仍是隐藏/关闭窗口，不是退出");
});

test("对话框抛错：退化为最小化到托盘，绝不把窗口留在关不掉的状态", async () => {
  const dialog = {
    calls: [],
    promptClose() {
      return Promise.reject(new Error("dialog blocked by policy"));
    },
  };
  const { behavior, win, events } = makeBehavior({ dialog });
  behavior.handleClose(closeEvent());
  await flush();
  await flush();
  assert.equal(win.hidden, 1, "弹不出来时隐藏到托盘（可逆、不丢数据）");
  assert.equal(events.order.includes("app.quit"), false, "失败路径不能静默退出");
  assert.ok(events.log.some((line) => /prompt failed/.test(line)));
  assert.equal(behavior.isPromptOpen(), false);
});

// ---- 偏好分支（ask / action） -----------------------------------------------

test("记住 minimize：卡片两个按钮都生效，落盘 {ask:false, action:minimize}", async () => {
  const { behavior, win, store, events } = makeBehavior({
    queue: [{ action: "hide", remember: true }],
  });
  behavior.handleClose(closeEvent());
  await flush();
  assert.deepEqual(store.read(), { ask: false, action: REMEMBER_MINIMIZE });
  assert.equal(events.preferenceChanged, 1, "偏好变化后要刷新托盘");
  assert.equal(win.hidden, 1);

  const again = closeEvent();
  behavior.handleClose(again);
  assert.equal(again.prevented, 1);
  assert.equal(win.hidden, 2, "已记住「最小化」：直接 hide，不再弹窗");
  assert.equal(behavior.isPromptOpen(), false);
});

test("记住 quit：卡片确认后落盘 {ask:false, action:quit}，下次 close 直接退出不弹窗", async () => {
  // 二次确认现在折叠在卡片里（视图 2），close-behavior 只看最终结果：
  // `{action:"quit", remember:true}` = 用户已经在卡片上确认过"退出并记住"。
  const { behavior, events, store, getQuitting } = makeBehavior({
    queue: [{ action: "quit", remember: true }],
  });
  behavior.handleClose(closeEvent());
  await flush();
  assert.deepEqual(store.read(), { ask: false, action: REMEMBER_QUIT });
  assert.equal(getQuitting(), true);
  assert.deepEqual(events.order, ["setQuitting", "app.quit"]);

  // 下一次 close：quitting 已真，直接放行（不会再有对话框）。
  assert.equal(behavior.handleClose(closeEvent()), true);
});

test("卡片上选「只退出这次」：不写偏好，但仍然退出", async () => {
  const { behavior, store } = makeBehavior({ queue: [{ action: "quit", remember: false }] });
  behavior.handleClose(closeEvent());
  await flush();
  assert.deepEqual(store.read(), { ask: true, action: null });
  assert.equal(store.calls.some(([kind]) => kind === "remember"), false);
  assert.equal(behavior.getAsk(), true);
});

test("取消勾选「关闭窗口时询问」后仍然无勾（不再是勾不掉的镜像）", () => {
  const store = makeMemoryStore();
  const { behavior } = makeBehavior({ store });
  assert.equal(behavior.getAsk(), true);
  assert.equal(behavior.setAsk(false), true);
  assert.equal(behavior.getAsk(), false);
  assert.equal(store.read().ask, false, "取消勾选是真写盘，不是刷新回真相");
  assert.equal(behavior.getAction(), null, "只关询问、没指定动作");
});

test("ask=false 且没有动作时点 × 直接最小化到托盘（不弹卡、不退出）", async () => {
  const store = makeMemoryStore({ ask: false, action: null });
  const { behavior, win, dialog, events } = makeBehavior({ store });
  const event = closeEvent();
  assert.equal(behavior.handleClose(event), false);
  assert.equal(event.prevented, 1, "仍然 preventDefault（否则窗口直接消失）");
  assert.equal(dialog.calls.length, 0, "不询问");
  assert.equal(win.hidden, 1);
  assert.equal(events.order.includes("app.quit"), false, "没有动作时绝不能退出");
});

test("重新勾上「关闭窗口时询问」会再问（ask 是唯一判据）", async () => {
  const store = makeMemoryStore({ ask: false, action: REMEMBER_MINIMIZE });
  const { behavior, win, dialog } = makeBehavior({ store });
  // 先确认关掉询问时直接最小化。
  behavior.handleClose(closeEvent());
  assert.equal(win.hidden, 1);
  assert.equal(dialog.calls.length, 0);

  behavior.setAsk(true);
  behavior.handleClose(closeEvent());
  assert.equal(dialog.calls.length, 1, "重新打开询问后必须弹卡");
  await flush();
});

test("旧文件迁移：{remembered} → {ask:false, action}；损坏/缺失 → 询问", () => {
  assert.equal(normalizeAction("minimize"), "minimize");
  assert.equal(normalizeAction("quit"), "quit");
  assert.equal(normalizeAction("Minimize"), null);
  assert.equal(normalizeAction(1), null);
  assert.equal(normalizeAction(null), null);
  assert.deepEqual(normalizeState(null), { ask: true, action: null });
  assert.deepEqual(normalizeState("nope"), { ask: true, action: null });
  assert.deepEqual(normalizeState({ remembered: "quit" }), { ask: false, action: "quit" });
  assert.deepEqual(normalizeState({ remembered: "explode" }), { ask: true, action: null });
  assert.deepEqual(normalizeState({ ask: "no", action: "quit" }), { ask: true, action: "quit" });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-close-behavior-"));
  const file = path.join(dir, PREFERENCE_FILE);
  try {
    assert.deepEqual(readState(file), { ask: true, action: null }, "文件不存在 = 询问");
    fs.writeFileSync(file, "{not json", "utf8");
    assert.deepEqual(readState(file), { ask: true, action: null }, "JSON 损坏 = 询问");
    // 真机升级路径：旧版本只写过 remembered。
    fs.writeFileSync(file, JSON.stringify({ remembered: "quit" }), "utf8");
    assert.deepEqual(readState(file), { ask: false, action: "quit" }, "旧格式必须迁移");
    fs.writeFileSync(file, JSON.stringify({ ask: false }), "utf8");
    assert.deepEqual(readState(file), { ask: false, action: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("写/读偏好文件：ask 与 action 分开写，坏路径不抛", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-close-behavior-"));
  const file = path.join(dir, "nested", PREFERENCE_FILE);
  try {
    assert.equal(rememberAction(file, REMEMBER_QUIT), true);
    assert.deepEqual(readState(file), { ask: false, action: REMEMBER_QUIT });
    assert.equal(writeAsk(file, true), true);
    assert.deepEqual(readState(file), { ask: true, action: REMEMBER_QUIT }, "写开关不丢已记住的动作");
    assert.equal(rememberAction(file, "bogus"), false, "非法动作不写");
    assert.equal(writeState(file, { ask: false, action: "explode" }), true);
    assert.deepEqual(readState(file), { ask: false, action: null }, "非法动作被收敛成 null");
    // 把文件当目录用：写入失败必须返回 false 而不是抛。
    const blocked = path.join(dir, "blocked");
    fs.writeFileSync(blocked, "x", "utf8");
    assert.equal(writeAsk(path.join(blocked, PREFERENCE_FILE), false), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createPreferenceStore：文件固定在 userData 根，接口是新契约", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-close-store-"));
  try {
    const store = createPreferenceStore({ app: { getPath: () => dir } });
    assert.equal(store.getAsk(), true);
    assert.equal(store.getAction(), null);
    assert.equal(store.rememberAction(REMEMBER_MINIMIZE), true);
    assert.equal(fs.existsSync(path.join(dir, PREFERENCE_FILE)), true);
    assert.equal(store.getAsk(), false);
    assert.equal(store.getAction(), REMEMBER_MINIMIZE);
    assert.equal(store.writeAsk(true), true);
    assert.equal(store.getAsk(), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, PREFERENCE_FILE), "utf8")).ask, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
