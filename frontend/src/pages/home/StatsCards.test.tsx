// SPDX-License-Identifier: Apache-2.0
/**
 * 首页统计卡（CR-37）：四张里去掉「近 7 天生成」。
 *
 * ## 为什么删
 *
 * 它是一个**负向指标**：新用户那格永远是 0，四张卡片里偏偏它最显眼，读起来像"你什么都没
 * 做"。而"近 7 天生成几份简历"也不驱动任何动作——真正该被看见的是岗位/开放中岗位/
 * 已有简历这三个存量口径，以及下面「接下来做什么」里的待办。
 *
 * 任务书给的两条路（换成「本周投递」或直接去掉）里选后者：投递次数需要后端新增一个
 * 周维度计数，为一个可有可无的数字加接口不划算。
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import type { Stats } from "../../types";
import { StatsCards } from "./StatsCards";

const STATS = {
  job_count: 12,
  open_job_count: 5,
  resume_count: 3,
  week_resume_count: 0,
  latest_jobs: [],
  latest_resumes: [],
  favorite_job_count: 1,
  pending_claim_count: 0,
  pending_claims: [],
  stalled_application_count: 0,
  apply_queue_count: 0,
  claim_count: 0,
  resume_with_job_count: 0,
  latest_applications: [],
} as unknown as Stats;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StatsCards", () => {
  it("只保留三个存量口径：岗位总数 / 开放中岗位 / 已生成简历", () => {
    render(<StatsCards stats={STATS} loading={false} />);

    expect(screen.getByText(t("homePage.stats.jobCount"))).toBeInTheDocument();
    expect(screen.getByText(t("homePage.stats.openJobCount"))).toBeInTheDocument();
    expect(screen.getByText(t("homePage.stats.resumeCount"))).toBeInTheDocument();
  });

  it("不再渲染「近 7 天生成」这张卡（连标签带那个 0 一起没有）", () => {
    render(<StatsCards stats={STATS} loading={false} />);

    expect(screen.queryByText(t("homePage.stats.weekResumeCount"))).toBeNull();
    // 三张卡：不是四张，也不是靠 css 藏掉一张。
    expect(document.querySelectorAll(".ant-statistic").length).toBe(3);
  });
});
