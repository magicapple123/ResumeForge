// SPDX-License-Identifier: Apache-2.0
"use strict";

// `updater.js` 及其 `lib/*.js` 的 VM 沙箱加载器（两个用例文件共用一份）。
//
// 为什么需要它：用例把 updater.js 放进 VM、把 `electron` 与 `fetch` 换成桩。但 updater.js
// 现在 require 了 `lib/update-net.js`，而**那个文件自己也 require("electron")**。若相对
// require 交给宿主的 require 处理，它会在仓库的 node_modules 里真加载 electron 包——拿到
// 的是可执行文件路径，不是 API，于是 `net` 是 undefined、`net.fetch` 的桩失效，用例会去
// 打真网络（表现为整份用例超时，而不是某条断言变红）。
//
// 所以：相对路径的模块也在**同一份 sandbox** 里求值（`electron` 由调用方给的桩接管），
// 并且基目录取**发起 require 的那个文件**所在目录——`lib/update-feedback.js` 里的
// `require("./shell-locale")` 指的是 `desktop/lib/`，不是 `desktop/`。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

/** 仓库里的 `desktop/`（本文件在 `desktop/scripts/`）。 */
const REPO_DESKTOP = path.join(__dirname, "..");

/**
 * 把 `sandbox.require` 换成"沙箱内 require"。
 *
 * 必须在第一次求值任何模块**之前**调用：模块的 require 就是这里塞进去的那一个。
 *
 * @param {object} sandbox `vm.runInNewContext` 的 globals
 * @param {object} electronStub `require("electron")` 的返回值（app / dialog / shell / net）
 * @returns {(spec: string) => any} 装到 `sandbox.require` 上的那个函数
 */
function attachRequire(sandbox, electronStub) {
  const cache = new Map();

  function requireLocal(resolved) {
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const child = { exports: {} };
    // 先入缓存再执行：模块互相 require 时（哪怕只是将来）不会无限递归。
    cache.set(resolved, child);
    const dir = path.dirname(resolved);
    // 字符串拼接而不是模板字符串：被加载的源码里本来就有 `${...}`，模板会把它插值掉。
    const factory = vm.runInNewContext(
      "(function (exports, require, module, __filename, __dirname) {\n" +
        fs.readFileSync(resolved, "utf-8") +
        "\n})",
      sandbox,
      { filename: resolved },
    );
    factory(child.exports, makeRequire(dir), child, resolved, dir);
    return child.exports;
  }

  function makeRequire(baseDir) {
    return (spec) => {
      if (spec === "electron") return electronStub;
      if (!spec.startsWith(".")) return require(spec);
      return requireLocal(require.resolve(path.resolve(baseDir, spec)));
    };
  }

  const sandboxRequire = makeRequire(REPO_DESKTOP);
  sandbox.require = sandboxRequire;
  return sandboxRequire;
}

/**
 * 在沙箱里求值 updater.js。
 *
 * @param {object} sandbox globals（含 `module` / `__filename` / `fetch` 等）
 * @param {object} electronStub `require("electron")` 的返回值
 * @returns {object} `sandbox.module.exports`
 */
function loadUpdater(sandbox, electronStub) {
  attachRequire(sandbox, electronStub);
  const entry = path.join(REPO_DESKTOP, "updater.js");
  vm.runInNewContext(fs.readFileSync(entry, "utf-8"), sandbox, {
    filename: "desktop/updater.js",
  });
  return sandbox.module.exports;
}

module.exports = { REPO_DESKTOP, attachRequire, loadUpdater };
