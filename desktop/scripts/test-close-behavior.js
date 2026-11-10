// SPDX-License-Identifier: Apache-2.0
/**
 * lib/close-behavior.js 的离线用例（问题清单 §18.4）。
 *
 * 这些分支全部是"不可逆"或"看起来没反应"的：选「退出应用」时先置 quitting 再
 * app.quit()（否则无限弹窗）、记忆文件损坏时必须当作没记住（宁可多问一次）、
 * 弹窗未关闭时连点 × 不能叠出第二个框。用**假 dialog / 假 window** 把这些性质
 * 变成字面量断言，而不是靠手点。
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
  clearPreference,
  createCloseBehavior,
  createPreferenceStore,
  normalizeRemembered,
  readPreference,
  writePreference,
} = require("../lib/close-behavior");

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeMemoryStore(initial = null) {
  let remembered = initial;
  const calls = [];
  return {
    read: () => remembered,
    save: (choice) => {
      remembered = choice;
      calls.push(["save", choice]);
      return true;
    },
    clear: () => {
      remembered = null;
      calls.push(["clear"]);
    },
    calls,
  };
}

/** 假 dialog：按队列依次返回 {response, checkboxChecked}；队列空了给"最小化"。 */
function makeDialog(queue = []) {
  const calls = [];
  return {
    calls,
    showMessageBox: (parent, options) => {
      calls.push({ parent, options });
      const next = queue.length > 0 ? queue.shift() : { response: 0, checkboxChecked: false };
      return Promise.resolve(next);
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
  const store = options.store || makeMemoryStore(options.remembered ?? null);
  const dialog = options.dialog || makeDialog(options.queue || []);
  const events = { order: [], preferenceChanged: 0, log: [] };
  let quitting = false;
  const behavior = createCloseBehavior({
    app: {
      quit() {
        events.order.push("app.quit");
      },
    },
    dialog,
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
  const { behavior, dialog } = makeBehavior({
    queue: [{ response: 1, checkboxChecked: false }],
  });
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

  const { parent, options } = dialog.calls[0];
  assert.equal(parent, win, "showMessageBox 必须带父窗口（§18.5）");
  assert.deepEqual([...options.buttons], ["最小化到托盘", "退出应用"]);
  assert.equal(options.defaultId, 0, "默认 = 最小化（安全默认）");
  assert.equal(options.cancelId, 0, "Esc = 最小化（安全默认）");
  assert.equal(options.checkboxLabel, "记住我的选择");
  assert.equal(options.checkboxChecked, false);

  await flush();
  assert.equal(win.hidden, 1, "默认响应 0 = 最小化到托盘");
});

test("选「退出应用」：先 setQuitting(true) 再 app.quit()，且之后的 close 不再弹窗", async () => {
  const { behavior, events, win, getQuitting } = makeBehavior({
    queue: [{ response: 1, checkboxChecked: false }],
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
    showMessageBox(parent, options) {
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
  release({ response: 0, checkboxChecked: false });
  await flush();
  assert.equal(behavior.isPromptOpen(), false);
});

test("macOS：按钮退化为「关闭窗口 / 退出应用」，文案按平台分支", async () => {
  const { behavior, dialog } = makeBehavior({ platform: "darwin" });
  behavior.handleClose(closeEvent());
  const { options } = dialog.calls[0];
  assert.deepEqual([...options.buttons], ["关闭窗口", "退出应用"]);
  assert.match(options.detail, /Dock/);
  assert.doesNotMatch(options.detail, /托盘/);
  await flush();
});

test("对话框抛错：退化为最小化到托盘，绝不把窗口留在关不掉的状态", async () => {
  const dialog = {
    calls: [],
    showMessageBox() {
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

// ---- 记忆分支 ---------------------------------------------------------------

test("记住 minimize：下次 close 不弹窗、直接 hide", async () => {
  const { behavior, win, store, events } = makeBehavior({
    queue: [{ response: 0, checkboxChecked: true }],
  });
  behavior.handleClose(closeEvent());
  await flush();
  assert.equal(store.read(), REMEMBER_MINIMIZE);
  assert.equal(events.preferenceChanged, 1, "记忆变化后要刷新托盘勾选态");
  assert.equal(win.hidden, 1);

  const again = closeEvent();
  behavior.handleClose(again);
  assert.equal(again.prevented, 1);
  assert.equal(win.hidden, 2);
  assert.equal(behavior.isPromptOpen(), false);
});

test("记住 quit：二次确认通过才落盘；下次 close 直接退出不弹窗", async () => {
  const { behavior, events, store, getQuitting } = makeBehavior({
    queue: [
      { response: 1, checkboxChecked: true },
      { response: 0, checkboxChecked: false },
    ],
  });
  behavior.handleClose(closeEvent());
  await flush();
  assert.equal(store.read(), REMEMBER_QUIT);
  assert.equal(getQuitting(), true);
  assert.deepEqual(events.order, ["setQuitting", "app.quit"]);

  // 下一次 close：quitting 已真，直接放行（不会再有对话框）。
  assert.equal(behavior.handleClose(closeEvent()), true);
});

test("记住 quit 的二次确认里选「只退出这次」：不写记忆，但仍然退出", async () => {
  const { behavior, store } = makeBehavior({
    queue: [
      { response: 1, checkboxChecked: true },
      { response: 1, checkboxChecked: false },
    ],
  });
  behavior.handleClose(closeEvent());
  await flush();
  assert.equal(store.read(), null, "取消二次确认时不得记住 quit");
  assert.equal(store.calls.some(([kind]) => kind === "save"), false);
  assert.equal(behavior.getRemembered(), null);
});

test("记忆文件损坏 / 字段非法：当作未记住，恢复询问（宁可多问一次，不要误退）", () => {
  assert.equal(normalizeRemembered("minimize"), "minimize");
  assert.equal(normalizeRemembered("quit"), "quit");
  assert.equal(normalizeRemembered("Minimize"), null);
  assert.equal(normalizeRemembered(1), null);
  assert.equal(normalizeRemembered(null), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-close-behavior-"));
  const file = path.join(dir, PREFERENCE_FILE);
  try {
    assert.equal(readPreference(file), null, "文件不存在 = 未记住");
    fs.writeFileSync(file, "{not json", "utf8");
    assert.equal(readPreference(file), null, "JSON 损坏 = 未记住");
    fs.writeFileSync(file, JSON.stringify({ remembered: "explode" }), "utf8");
    assert.equal(readPreference(file), null, "非法字段 = 未记住");
    fs.writeFileSync(file, JSON.stringify({ remembered: "minimize" }), "utf8");
    assert.equal(readPreference(file), "minimize");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("托盘「关闭窗口时询问」勾上 = 清掉记忆、恢复弹窗", async () => {
  const store = makeMemoryStore(REMEMBER_MINIMIZE);
  const { behavior, dialog } = makeBehavior({ store });
  // 有记忆时直接执行，不弹窗。
  behavior.handleClose(closeEvent());
  assert.equal(dialog.calls.length, 0);
  behavior.clearRemembered();
  assert.equal(store.read(), null);
  behavior.handleClose(closeEvent());
  assert.equal(dialog.calls.length, 1, "清掉记忆后必须恢复询问");
  await flush();
});

test("写/读/清记忆文件：落盘位置由 store 注入，坏路径不抛", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-close-behavior-"));
  const file = path.join(dir, "nested", PREFERENCE_FILE);
  try {
    assert.equal(writePreference(file, REMEMBER_QUIT), true);
    assert.equal(readPreference(file), REMEMBER_QUIT);
    assert.equal(writePreference(file, "bogus"), false, "非法值不写");
    assert.equal(clearPreference(file), true);
    assert.equal(readPreference(file), null);
    // 把文件当目录用：写入失败必须返回 false 而不是抛。
    const blocked = path.join(dir, "blocked");
    fs.writeFileSync(blocked, "x", "utf8");
    assert.equal(writePreference(path.join(blocked, PREFERENCE_FILE), REMEMBER_MINIMIZE), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createPreferenceStore：文件固定在 userData 根（与 window-state.json 同处）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-close-store-"));
  try {
    const store = createPreferenceStore({ app: { getPath: () => dir } });
    assert.equal(store.read(), null);
    assert.equal(store.save(REMEMBER_MINIMIZE), true);
    assert.equal(fs.existsSync(path.join(dir, PREFERENCE_FILE)), true);
    assert.equal(store.read(), REMEMBER_MINIMIZE);
    store.clear();
    assert.equal(store.read(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
