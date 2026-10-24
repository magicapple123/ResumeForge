// SPDX-License-Identifier: Apache-2.0
/**
 * D20 核对摘要测试（契约 §6.5）：六项信息 + 版本变化 + 隐藏条目计数。
 */
import { describe, expect, it } from "vitest";
import { ensureIds } from "../resume-document/identity";
import type { ResumeContent } from "../../types/resume";
import {
  buildExportCheckSummary,
  collectExportWarnings,
  countHiddenEntries,
  exportBlockedByRevision,
  hasContact,
} from "./check";

function content(): ResumeContent {
  return ensureIds({
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "13800000000",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

describe("buildExportCheckSummary", () => {
  it("六项信息齐全：目标公司/岗位、标题、联系方式、版本、模式、隐藏数", () => {
    const base = content();
    const summary = buildExportCheckSummary({
      resumeTitle: "后端简历",
      company: "甲公司",
      jobTitle: "后端工程师",
      content: base,
      revision: 7,
      expectedRevision: 7,
      documentMode: "resume",
    });
    expect(summary).toEqual({
      target_company: "甲公司",
      target_job_title: "后端工程师",
      resume_title: "后端简历",
      contact_present: true,
      document_mode: "resume",
      revision: 7,
      revision_changed: false,
      hidden_count: 0,
    });
    expect(exportBlockedByRevision(summary)).toBe(false);
  });

  it("隐藏条目计数覆盖六类；修订号不一致 → 阻断并给 warning", () => {
    const base = content();
    const withHidden: ResumeContent = {
      ...base,
      skills: [{ name: "Python", level: "熟练", hidden: true }],
      awards: [{ name: "一等奖", date: "2021", description: "", hidden: true }],
    };
    expect(countHiddenEntries(withHidden)).toBe(2);
    const summary = buildExportCheckSummary({
      resumeTitle: "后端简历",
      company: "",
      jobTitle: "",
      content: withHidden,
      revision: 8,
      expectedRevision: 7,
    });
    expect(summary.revision_changed).toBe(true);
    expect(exportBlockedByRevision(summary)).toBe(true);
    expect(collectExportWarnings(summary)).toEqual(["no-target", "has-hidden", "revision-changed"]);
  });

  it("缺联系方式、长 CV 只提醒不阻断", () => {
    const base = { ...content(), phone: "", email: "" };
    expect(hasContact(base)).toBe(false);
    const summary = buildExportCheckSummary({
      resumeTitle: "长简历",
      company: "乙公司",
      jobTitle: "研究",
      content: base,
      revision: 1,
      documentMode: "long_cv",
    });
    expect(summary.contact_present).toBe(false);
    expect(collectExportWarnings(summary)).toEqual(["no-contact", "long-cv"]);
    expect(exportBlockedByRevision(summary)).toBe(false);
  });
});
