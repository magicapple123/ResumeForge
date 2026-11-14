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

/**
 * 假的自绘关闭卡片：队列里仍按 `{response, checkboxChecked}` 写（0=最小化/关闭窗口、1=退出），
 * 内部翻译成 `close-behavior` 现在收到的 `{action, remember}`。
 *
 * 为什么保留旧写法：这些用例断言的是"弹没弹 / 退没退 / 记没记"，与卡片长什么样无关；
 * 卡片的文案与二次确认已经搬到 `desktop/close-dialog.html`（视图 2），不再从这里可断言。
 */
function makePromptDial(queue = []) {
  const calls = [];
  return {
    calls,
    promptClose: (parent, options) => {
      calls.push({ parent, options });
      const next = queue.length > 0 ? queue.shift() : { response: 0, checkboxChecked: false };
      return Promise.resolve({
        action: next.response === 1 ? "quit" : "hide",
        remember: Boolean(next.checkboxChecked),
      });
    },
  };
}
const makeDialog = makePromptDial;

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
  assert.equal(parent, win, "自绘卡片必须带父窗口（§18.5，父窗口关闭时连带销毁）");
  // 卡片按平台渲染"最小化到托盘 / 关闭窗口"，并把 Esc 绑成安全默认（都在 close-dialog.html 里）。
  assert.equal(options.isMac, false, "Windows 走「最小化到托盘」口径");

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

test("记住 quit：卡片确认后落盘，下次 close 直接退出不弹窗", async () => {
  // 二次确认现在折叠在卡片里（视图 2），close-behavior 只看最终结果：
  // `{action:"quit", remember:true}` = 用户已经在卡片上确认过"退出并记住"。
  const { behavior, events, store, getQuitting } = makeBehavior({
    queue: [{ response: 1, checkboxChecked: true }],
  });
  behavior.handleClose(closeEvent());
  await flush();
  assert.equal(store.read(), REMEMBER_QUIT);
  assert.equal(getQuitting(), true);
  assert.deepEqual(events.order, ["setQuitting", "app.quit"]);

  // 下一次 close：quitting 已真，直接放行（不会再有对话框）。
  assert.equal(behavior.handleClose(closeEvent()), true);
});

test("卡片上选「只退出这次」：不写记忆，但仍然退出", async () => {
  const { behavior, store } = makeBehavior({
    queue: [{ response: 1, checkboxChecked: false }],
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
