// SPDX-License-Identifier: Apache-2.0
"use strict";

// 启动页最短可见时长的离线用例：假时钟 + 假 sleep，不打真实定时器。
// 判据来自用户 2026-11-19 的拍板：界面早于 1.0s 就绪要等到 1.0s；服务本来就慢则不多等。

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { MIN_VISIBLE_MS, createSplashClock } = require("../lib/splash-timing");

function fakeClock(start = 1_000) {
  let now = start;
  const waits = [];
  const clock = createSplashClock({
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  });
  return { clock, waits, tick: (ms) => { now += ms; }, at: () => now };
}

test("the splash is held for a full second when the service is ready in 300ms", async () => {
  const { clock, waits } = fakeClock();
  clock.markShown();
  const waited = await clock.hold(clock.shownAt() + 300);
  assert.equal(waited, MIN_VISIBLE_MS - 300);
  assert.deepEqual(waits, [700]);
});

test("a slow service is not delayed at all", async () => {
  const { clock, waits } = fakeClock();
  clock.markShown();
  const waited = await clock.hold(clock.shownAt() + 2_500);
  assert.equal(waited, 0);
  assert.deepEqual(waits, []);
});

test("the remaining hold never goes past one second or below zero", () => {
  const { clock } = fakeClock();
  clock.markShown();
  assert.equal(clock.remainder(clock.shownAt()), 1000, "just after show");
  assert.equal(clock.remainder(clock.shownAt() + 999), 1, "1ms before the floor");
  assert.equal(clock.remainder(clock.shownAt() + 1000), 0, "exactly at the floor");
  assert.equal(clock.remainder(clock.shownAt() + 5000), 0, "long after the floor");
  assert.equal(clock.remainder(clock.shownAt() - 50), 1000, "a clock that steps back must not add wait");
});

test("without a shown splash the hold is a no-op (test shells, CI probes)", async () => {
  const { clock, waits } = fakeClock();
  assert.equal(clock.shownAt(), 0);
  assert.equal(await clock.hold(), 0);
  assert.deepEqual(waits, []);
});

test("marking the splash twice keeps the first timestamp", () => {
  const { clock, tick } = fakeClock();
  const first = clock.markShown();
  tick(400);
  assert.equal(clock.markShown(), first);
  assert.equal(clock.shownAt(), first);
});
