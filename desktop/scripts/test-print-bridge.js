"use strict";

/**
 * R1：简历 PDF 走 Chromium 打印 —— 静态守卫。
 *
 * 真机行为（打印出来长什么样、保存对话框）只能在桌面环境里验；这里钉住三件静态却
 * 容易坏的事：通道名两边一致、打印参数是 A4 + 打印背景 + 无边距、以及 preload 只
 * 暴露这一个固定通道。
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = (name) => readFileSync(path.join(ROOT, name), "utf8");

test("print.js 用 A4 + 打印背景 + 无边距，并把 HTML 交给 Chromium", () => {
  const source = read("print.js");

  assert.match(source, /printToPDF\(/);
  assert.match(source, /printBackground:\s*true/);
  assert.match(source, /pageSize:\s*"A4"/);
  assert.match(source, /marginType:\s*"none"/);
  // 隐藏窗口 + 关闭 Node 集成：HTML 里就算有脚本也拿不到 Node。
  assert.match(source, /show:\s*false/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /contextIsolation:\s*true/);
  // 空内容要明确报错，而不是打印一张白纸。
  assert.match(source, /没有可打印的简历内容/);
});

test("preload 暴露 resumeForge.printPdf，且只用一个固定通道", () => {
  const preload = read("preload.js");
  assert.match(preload, /exposeInMainWorld\("resumeForge"/);
  assert.match(preload, /ipcRenderer\.invoke\("resume:print-pdf"/);
  // 不接受调用方传进来的通道名（暴露面最小）。
  assert.doesNotMatch(preload, /invoke\(\s*[a-zA-Z_$]/);
});

test("main.js 注册了打印通道，且通道名与 preload 一致", () => {
  const main = read("main.js");
  const print = read("print.js");
  assert.match(main, /require\("\.\/print"\)\.registerPrintHandler\(\)/);

  const channel = /PRINT_CHANNEL = "([^"]+)"/.exec(print)?.[1];
  assert.equal(channel, "resume:print-pdf");
  assert.match(read("preload.js"), new RegExp(channel));
});

test("前端在桌面壳里用这条桥，浏览器里回落到 window.print", () => {
  const modal = readFileSync(
    path.join(ROOT, "..", "frontend", "src", "components", "ExportOptionsModal.tsx"),
    "utf8",
  );
  assert.match(modal, /window\.resumeForge\?\.printPdf/);
  assert.match(modal, /printHtml\(html\)/);
});
