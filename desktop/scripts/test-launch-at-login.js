// SPDX-License-Identifier: Apache-2.0
// lib/launch-at-login.js 的离线用例（WF-08 第三处联动）。
//
// 三个必须成立的语义：
//   1. 读 = 查 HKCU Run 里有没有那条值（值名与安装器逐字相同）；
//   2. 写 true = `reg add` 且数据带引号（与安装器 `WriteRegStr … '"…\ResumeForge.exe"'` 同格式）；
//   3. 非 Windows / 命令失败 = `supported:false`，让设置卡渲染成禁用，而不是假装能切。

const test = require("node:test");
const assert = require("node:assert/strict");

const { createLaunchAtLogin, RUN_KEY, VALUE_NAME } = require("../lib/launch-at-login");

/** 假注册表：把 reg query/add/delete 三次调用翻译成一次内存状态变更。 */
function fakeRegistry(initial) {
  const state = { value: initial, calls: [] };
  function runCommand(args) {
    state.calls.push(args);
    const [op] = args;
    if (op === "query") {
      if (state.value == null) return { code: 1, stdout: "" };
      return {
        code: 0,
        stdout: `${RUN_KEY}\r\n    ${VALUE_NAME}    REG_SZ    ${state.value}\r\n`,
      };
    }
    if (op === "add") {
      // `/d` 之后的参数就是数据
      state.value = args[args.indexOf("/d") + 1];
      return { code: 0, stdout: "" };
    }
    if (op === "delete") {
      const had = state.value != null;
      state.value = null;
      return { code: had ? 0 : 1, stdout: "" };
    }
    return { code: 1, stdout: "" };
  }
  return { state, runCommand };
}

test("值名与键名必须和安装器写的那一条一致", () => {
  assert.equal(VALUE_NAME, "ResumeForge");
  assert.equal(RUN_KEY, "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
});

test("读：没有启动项时报 enabled:false，但 supported 仍为 true", () => {
  const { runCommand } = fakeRegistry(null);
  const api = createLaunchAtLogin({ platform: "win32", runCommand, exePath: "C:\\X\\ResumeForge.exe" });
  assert.deepEqual(api.read(), { supported: true, enabled: false });
});

test("读：安装器写过（数据带引号）时也能认出是开", () => {
  const { runCommand } = fakeRegistry('"D:\\Apps\\ResumeForge\\ResumeForge.exe"');
  const api = createLaunchAtLogin({ platform: "win32", runCommand, exePath: "C:\\X\\ResumeForge.exe" });
  assert.deepEqual(api.read(), { supported: true, enabled: true });
});

test("写 true：reg add 的数据带引号，且写完立刻读回是开", () => {
  const { state, runCommand } = fakeRegistry(null);
  const api = createLaunchAtLogin({
    platform: "win32",
    runCommand,
    exePath: "C:\\Program Files\\RF\\ResumeForge.exe",
  });
  assert.deepEqual(api.write(true), { supported: true, enabled: true });
  assert.equal(state.value, '"C:\\Program Files\\RF\\ResumeForge.exe"');
  const add = state.calls.find((c) => c[0] === "add");
  assert.ok(add, "must call reg add");
  assert.deepEqual(add.slice(0, 3), ["add", RUN_KEY, "/v"]);
  assert.equal(add[add.indexOf("/f")], "/f", "must overwrite without prompting");
});

test("写 false：reg delete 删掉同一条；本来就没有也算成功", () => {
  const { state, runCommand } = fakeRegistry('"D:\\old\\ResumeForge.exe"');
  const api = createLaunchAtLogin({ platform: "win32", runCommand, exePath: "C:\\X\\ResumeForge.exe" });
  assert.deepEqual(api.write(false), { supported: true, enabled: false });
  assert.equal(state.value, null);
  // 幂等：再关一次仍返回 enabled:false，不抛
  assert.deepEqual(api.write(false), { supported: true, enabled: false });
});

test("非 Windows：supported:false，且一个 reg 命令都不发", () => {
  const { state, runCommand } = fakeRegistry(null);
  const api = createLaunchAtLogin({ platform: "darwin", runCommand });
  assert.deepEqual(api.read(), { supported: false, enabled: false });
  assert.deepEqual(api.write(true), { supported: false, enabled: false });
  assert.deepEqual(state.calls, []);
});
