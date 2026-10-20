// SPDX-License-Identifier: Apache-2.0
/**
 * PR-17 前端性能测量 mock 的契约测试（node:test，不依赖前端构建）。
 *
 * 覆盖审计 C-2 的三条红线：
 * 1. mock 覆盖补齐（/tracker/stats、/reminders/upcoming、应用壳 settings）；
 * 2. 未匹配请求显式失败（fail-closed），不再默认 EMPTY_PAGE；
 * 3. mock 形状对齐真实 DTO schema（字段清单钉住，凭记忆编字段会变红）。
 *
 * 运行：node --test scripts/tests/test-measure-frontend-mock.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_ORB,
  EMPTY_PAGE,
  JOBS_PAGE,
  NAVIGATION_VISIBILITY,
  REMINDER_POPUP,
  RESUMES_PAGE,
  ROUTE_EVIDENCE,
  STATS,
  TRACK_LIST,
  TRACK_PAGE,
  TRACK_STATS,
  UNMATCHED_DETAIL,
  assertRenderEvidence,
  classifyMockRequest,
  mockBodyFor,
  mockResponseFor,
} from "../measure_frontend_perf.mjs";

test("覆盖补齐：新端点与应用壳端点都有点名", () => {
  const required = [
    "http://x/api/dataset-scope",
    "http://x/api/tracker/stats",
    "http://x/api/tracker/page?page=1&page_size=20",
    "http://x/api/tracker",
    "http://x/api/stats",
    "http://x/api/reminders/upcoming?limit=5",
    "http://x/api/settings/navigation",
    "http://x/api/settings/reminder-popup",
    "http://x/api/settings/assistant-orb",
    "http://x/api/apply/queue",
    "http://x/api/knowledge/page?page=1&page_size=20",
    "http://x/api/candidate-jobs/page?page=1&page_size=20",
  ];
  for (const url of required) {
    assert.equal(classifyMockRequest(url) !== null, true, `mock 未覆盖: ${url}`);
  }
});

test("fail-closed：未匹配的 /api/ 请求显式 500，而不是 EMPTY_PAGE", () => {
  const decision = mockResponseFor("http://x/api/totally-unknown-endpoint");
  assert.equal(decision.matched, false);
  assert.equal(decision.status, 500);
  assert.equal(decision.body.detail, UNMATCHED_DETAIL);
  // 具体性检查：EMPTY_PAGE 不能被用来兜底未知路径。
  assert.notDeepEqual(decision.body, EMPTY_PAGE);
});

test("字面量段优先：/tracker/page 与 /tracker/stats 不被 /tracker 吞掉", () => {
  assert.equal(classifyMockRequest("http://x/api/tracker/stats"), "tracker_stats");
  assert.equal(classifyMockRequest("http://x/api/tracker/page?page=2"), "tracker_page");
  assert.equal(classifyMockRequest("http://x/api/tracker"), "tracker_list");
});

test("mock 形状对齐 Page[T]：items + total", () => {
  for (const page of [TRACK_PAGE, JOBS_PAGE, RESUMES_PAGE]) {
    assert.equal(Array.isArray(page.items), true);
    assert.equal(typeof page.total, "number");
    assert.equal(page.items.length > 0, true);
  }
});

test("mock 形状对齐 TrackOut（backend/app/schemas/tracker.py）", () => {
  const track = TRACK_PAGE.items[0];
  for (const field of [
    "id",
    "company",
    "title",
    "status",
    "stage_note",
    "applied_at",
    "status_date",
    "next_action",
    "next_action_date",
    "note",
    "evidence",
    "job_id",
    "source",
    "created_at",
    "updated_at",
  ]) {
    assert.equal(Object.hasOwn(track, field), true, `TrackOut 缺字段: ${field}`);
  }
  assert.equal(TRACK_LIST.status_counts !== undefined, true);
});

test("mock 形状对齐 TrackStatsOut（/tracker/stats 独立端点）", () => {
  for (const field of [
    "total",
    "status_counts",
    "active_count",
    "offer_count",
    "rejected_count",
    "month_count",
  ]) {
    assert.equal(Object.hasOwn(TRACK_STATS, field), true, `TrackStatsOut 缺字段: ${field}`);
  }
  assert.equal(mockBodyFor("tracker_stats"), TRACK_STATS);
});

test("mock 形状对齐 Stats（schemas/search.py，含新口径 claim_count/resume_with_job_count）", () => {
  for (const field of [
    "job_count",
    "open_job_count",
    "resume_count",
    "week_resume_count",
    "latest_jobs",
    "latest_resumes",
    "favorite_job_count",
    "pending_claim_count",
    "pending_claims",
    "stalled_application_count",
    "apply_queue_count",
    "claim_count",
    "resume_with_job_count",
    "latest_applications",
  ]) {
    assert.equal(Object.hasOwn(STATS, field), true, `Stats 缺字段: ${field}`);
  }
  const job = STATS.latest_jobs[0];
  for (const field of ["id", "title", "company", "status", "source", "created_at", "updated_at"]) {
    assert.equal(Object.hasOwn(job, field), true, `latest_jobs 的 JobOut 缺字段: ${field}`);
  }
  const resume = STATS.latest_resumes[0];
  for (const field of ["id", "title", "job_id", "job_title", "company", "source"]) {
    assert.equal(Object.hasOwn(resume, field), true, `latest_resumes 的 ResumeBrief 缺字段: ${field}`);
  }
});

test("应用壳设置 mock 对齐 schemas/setting.py", () => {
  assert.deepEqual(Object.keys(NAVIGATION_VISIBILITY), ["hidden"]);
  assert.deepEqual(Object.keys(REMINDER_POPUP), ["enabled"]);
  for (const field of ["enabled", "tips_enabled"]) {
    assert.equal(Object.hasOwn(ASSISTANT_ORB, field), true, `AssistantOrbSetting 缺字段: ${field}`);
  }
});

test("业务断言：mock 数据标记缺失 / pageerror / 未命中 mock 都会判失败", () => {
  const good = assertRenderEvidence("/tracker", {
    bodyText: "星河科技 已投递 400",
    rowishCount: 5,
    pageErrors: [],
    unmatched: [],
  });
  assert.equal(good.ok, true);

  const missingText = assertRenderEvidence("/tracker", {
    bodyText: "别的页面",
    rowishCount: 5,
    pageErrors: [],
    unmatched: [],
  });
  assert.equal(missingText.ok, false);
  assert.equal(missingText.reasons.some((r) => r.includes("mock 数据标记")), true);

  const noRows = assertRenderEvidence("/tracker", {
    bodyText: "星河科技 已投递 400",
    rowishCount: 0,
    pageErrors: [],
    unmatched: [],
  });
  assert.equal(noRows.ok, false);
  assert.equal(noRows.reasons.some((r) => r.includes("列表/卡片元素不足")), true);

  const withPageError = assertRenderEvidence("/tracker", {
    bodyText: "星河科技 已投递 400",
    rowishCount: 5,
    pageErrors: ["TypeError: boom"],
    unmatched: [],
  });
  assert.equal(withPageError.ok, false);
  assert.equal(withPageError.reasons.some((r) => r.includes("pageerror")), true);

  const withUnmatched = assertRenderEvidence("/tracker", {
    bodyText: "星河科技 已投递 400",
    rowishCount: 5,
    pageErrors: [],
    unmatched: ["GET /api/unknown"],
  });
  assert.equal(withUnmatched.ok, false);
  assert.equal(withUnmatched.reasons.some((r) => r.includes("未命中 mock")), true);
});

test("每条被测路由都定义了证据口径（防止静默跳过断言）", () => {
  for (const route of ["/", "/tracker"]) {
    const config = ROUTE_EVIDENCE[route];
    assert.notEqual(config, undefined, `缺 ROUTE_EVIDENCE: ${route}`);
    assert.equal(config.requiredTexts.length > 0, true);
    assert.equal(config.minRowishElements >= 1, true);
  }
});
