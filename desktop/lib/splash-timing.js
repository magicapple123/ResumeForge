// SPDX-License-Identifier: Apache-2.0
"use strict";

// 启动页最短可见时长（2026-11-19 用户拍板）：启动页自带约 1.4s 的开场动画，
// 后端如果几百毫秒就绪，直接切界面会把开场切成"闪一下"。所以切界面前补到 1.0s。
//
// 时间基准是"窗口真的可见"那一刻（createWindow 的 ready-to-show），不是 spawn
// 后端那一刻：用户看到的是窗口，只有从窗口可见开始计时，1.0s 才等于"看得到 1s"。
//
// 上限：这里**不做** 0.4s 的硬夹取。实测主进程从 ready-to-show 到后端就绪通常
// 已经超过 600ms，补时一般 ≤400ms；但真出现"服务 300ms 就绪"时仍必须等满 1.0s
// （验收购据），夹取会让它只播 700ms。硬夹取只会在慢机器上制造"动画被切一半"。
//
// 纯函数 + 注入的 now/sleep：desktop/scripts/test-splash-timing.js 用假时钟断言。

const MIN_VISIBLE_MS = 1000;

function createSplashClock({ now = Date.now, sleep = defaultSleep } = {}) {
  let shownAt = 0;
  return {
    /** 窗口可见（ready-to-show）时调用；重复调用只记第一次。 */
    markShown() {
      if (!shownAt) shownAt = now();
      return shownAt;
    },
    shownAt() {
      return shownAt;
    },
    /** 距离 1.0s 还差多少毫秒；启动页没显示过（测试壳 / 无窗口）时返回 0。 */
    remainder(readyAt = now()) {
      if (!shownAt) return 0;
      const elapsed = Math.max(0, readyAt - shownAt);
      return Math.max(0, MIN_VISIBLE_MS - elapsed);
    },
    /** 补足最短可见时长，返回实际等待的毫秒数（0 表示不用等）。 */
    async hold(readyAt = now()) {
      const ms = this.remainder(readyAt);
      if (ms > 0) await sleep(ms);
      return ms;
    },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { MIN_VISIBLE_MS, createSplashClock };
