// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「开机自启」的应用内开关（WF-08 第三处联动）。
//
// **只读系统真相，不存数据库**：安装器在 `HKCU\...\Run` 写了一条值，卸载器删同一条；
// 应用内若再存一份布尔，就会出现"装机时勾了自启、进应用看到的是关"的两个事实源。
//
// 值名/键名与 `desktop/nsis/wizard.nsh` 的 `RF_INSTALL_FINISH` 逐字一致（都是
// `ResumeForge`）——**改这里必须同步改那里**，否则应用关不掉安装器写的那条。
//
// 为什么不用 Electron 的 `app.getLoginItemSettings()/setLoginItemSettings()`：
// Windows 上那套要拿 exe 路径做匹配，而安装器写的是带引号的 `"C:\...\ResumeForge.exe"`，
// 版本/目录一变就可能"明明开着却读成关"。直接读写注册表没有这层推断。
//
// 依赖注入（platform / runCommand / exePath），离线用例可以喂假注册表。

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/** 与安装器同一条值名：`WriteRegStr HKCU "…\Run" "ResumeForge" …`。 */
const VALUE_NAME = "ResumeForge";

/** 只允许这两条命令：不接受调用方传任意参数（写注册表是一件要克制的事）。 */
function defaultRunCommand(args) {
  const { spawnSync } = require("child_process");
  const result = spawnSync("reg", args, { windowsHide: true, encoding: "utf8" });
  return {
    code: typeof result.status === "number" ? result.status : 1,
    stdout: `${result.stdout || ""}`,
  };
}

/**
 * @param {object} [deps]
 * @param {string} [deps.platform] 默认 process.platform；非 win32 一律"不支持"
 * @param {(args: string[]) => {code: number, stdout: string}} [deps.runCommand]
 * @param {string} [deps.exePath] 写进 Run 值的可执行文件路径，默认 process.execPath
 * @param {(msg: string) => void} [deps.logLine]
 */
function createLaunchAtLogin(deps = {}) {
  const {
    platform = process.platform,
    runCommand = defaultRunCommand,
    exePath = process.execPath,
    logLine = () => {},
  } = deps;

  const supported = platform === "win32";

  /** 读当前状态：`{supported, enabled}`。读失败按"关"报，但 supported 保持 true。 */
  function read() {
    if (!supported) return { supported: false, enabled: false };
    const { code, stdout } = runCommand(["query", RUN_KEY, "/v", VALUE_NAME]);
    if (code !== 0) return { supported: true, enabled: false };
    // `reg query` 命中时输出三列：值名 / 类型 / 数据。数据里可能带引号，按"有没有值"判断即可。
    const hit = stdout.split(/\r?\n/).some((line) => line.trim().startsWith(VALUE_NAME));
    return { supported: true, enabled: hit };
  }

  /** 写状态：true → 写 Run 值（数据带引号，与安装器同格式）；false → 删该值。 */
  function write(enabled) {
    if (!supported) return { supported: false, enabled: false };
    const args = enabled
      ? ["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", `"${exePath}"`, "/f"]
      : ["delete", RUN_KEY, "/v", VALUE_NAME, "/f"];
    const { code } = runCommand(args);
    // `reg delete` 对"本来就没有"返回 1，这不算失败：目标状态已经达到了。
    if (code !== 0 && enabled) {
      logLine(`launch-at-login: write failed (code ${code})`);
      return { supported: true, enabled: false };
    }
    const next = read();
    logLine(`launch-at-login: set ${Boolean(enabled)} -> ${next.enabled}`);
    return next;
  }

  return { read, write, supported, valueName: VALUE_NAME, runKey: RUN_KEY };
}

module.exports = { createLaunchAtLogin, RUN_KEY, VALUE_NAME };
