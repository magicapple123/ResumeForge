// SPDX-License-Identifier: Apache-2.0
/**
 * lib/media-permissions.js 的离线用例。
 *
 * 这条策略只有两个可观测行为，但两个都值得钉住：
 * 1. 语音输入要用麦克风 → `media` 必须放行（回归 #8：桌面壳里录音拿不到麦克风时，
 *    UI 只会静默失败，用户看不出原因）；
 * 2. 其余权限必须拒绝 → 桌面壳用不到摄像头/通知/剪贴板读，默认放行等于把它们暴露给
 *    将来任何一段页面脚本。
 *
 * 用**假 session** 把这两条变成字面量断言，不启动 Electron。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { installMediaPermissionHandler } = require("../lib/media-permissions");
const { flush, loadMain } = require("./lifecycle-harness");

/** 记录处理器并按 (permission) 取回调结果。 */
function fakeSession() {
  const session = {
    handler: null,
    setPermissionRequestHandler(next) {
      session.handler = next;
    },
  };
  return session;
}

function decide(handler, permission) {
  let granted = null;
  handler(null, permission, (value) => {
    granted = value;
  });
  return granted;
}

test("media 放行，其余权限拒绝", () => {
  const session = fakeSession();
  assert.equal(installMediaPermissionHandler(session), true);
  assert.equal(typeof session.handler, "function");

  assert.equal(decide(session.handler, "media"), true);
  for (const denied of ["geolocation", "notifications", "clipboard-read", "openExternal"]) {
    assert.equal(decide(session.handler, denied), false, `${denied} 不该被放行`);
  }
});

test("没有 session 或没有该 API 时返回 false，不抛异常", () => {
  // 桌面壳启动早期、以及未来 Electron 改名时，装配代码不该因此崩掉。
  assert.equal(installMediaPermissionHandler(null), false);
  assert.equal(installMediaPermissionHandler({}), false);
  assert.equal(installMediaPermissionHandler({ setPermissionRequestHandler: 1 }), false);
});

test("main.js 装配时真的装上了（那一行调用不许被删）", async () => {
  // 只测 lib 不够：main.js 里那行调用被删掉时，lib 的用例仍然全绿，而桌面壳里
  // 语音输入会静默失败——这正是 #8 的表现，所以这里从装配层再钉一次。
  const loaded = loadMain();
  try {
    await flush();
    await flush();
    assert.equal(typeof loaded.events.permissionHandler, "function");

    let granted = null;
    loaded.events.permissionHandler(null, "media", (value) => {
      granted = value;
    });
    assert.equal(granted, true);
  } finally {
    loaded.cleanup();
  }
});
