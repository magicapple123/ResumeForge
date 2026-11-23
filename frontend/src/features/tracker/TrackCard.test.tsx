// SPDX-License-Identifier: Apache-2.0
/**
 * 进度行的两处展示契约（本轮整改的两条）：
 *
 * 1. **关联链接图标**：只在真的填了、且能解析成 http/https 时才可点。新窗口必须带
 *    `rel="noopener noreferrer"`——否则新页面能用 `window.opener` 反向操纵本页。
 * 2. **简历名不截断**：可见文本就是完整标题，`title` 也是同一份。在 JS 里 `slice`
 *    掉的字符，用户既看不到、也没法在 tooltip 里找回来。
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { Track } from "../../types";
import TrackCard from "./TrackCard";

const COMPANY = "示例科技";
const JOB_TITLE = "后端开发";
/** 真实场景里会长到被 260px 砍断：这三段都得留在页面上。 */
const LONG_RESUME_TITLE = "示例科技-后端开发-2026 秋招定制版（第三轮面试专用，含项目补丁）";
const LINK_URL = "https://jobs.example.com/apply?utm_source=referral";

const BASE: Track = {
  id: 1,
  company: COMPANY,
  title: JOB_TITLE,
  status: "applied",
  stage_note: "",
  applied_at: "2026-09-18",
  status_date: "",
  next_action: "",
  next_action_date: "",
  note: "",
  evidence: "",
  job_id: null,
  resume_id: null,
  channel: "unknown",
  resume_title: "",
  link: "",
  source: "manual",
  created_at: "2026-09-18T08:00:00",
  updated_at: "2026-09-18T08:00:00",
};

function renderCard(patch: Partial<Track> = {}) {
  return render(
    <AntdApp>
      <TrackCard track={{ ...BASE, ...patch }} onEdit={vi.fn()} onDelete={vi.fn()} />
    </AntdApp>,
  );
}

describe("TrackCard 的关联链接", () => {
  it("有链接时给出一个在新窗口打开、且不把 opener 交出去的图标", () => {
    renderCard({ link: LINK_URL });

    const link = screen.getByRole("link", {
      name: t("trackerUi.card.aria.link", { name: COMPANY }),
    });
    expect(link).toHaveAttribute("href", LINK_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // 悬停能看到完整地址（表单里填的就是这个）。
    expect(link).toHaveAttribute("title", LINK_URL);
  });

  it("没填链接就不画图标——不留一个点了没反应的壳", () => {
    renderCard({ link: "" });

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("不是 http/https 的地址不渲染成链接（后端已拦，这里再兜一层）", () => {
    renderCard({ link: "javascript:alert(1)" });

    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("TrackCard 的简历名", () => {
  it("长标题完整显示，可见文本与 title 是同一份", () => {
    const { container } = renderCard({ resume_id: 3, resume_title: LONG_RESUME_TITLE });

    const node = container.querySelector(".track-card-resume");
    expect(node).not.toBeNull();
    expect(node).toHaveTextContent(LONG_RESUME_TITLE);
    expect(node).toHaveAttribute("title", LONG_RESUME_TITLE);
  });

  it("只剩标题快照（简历已删）时标注历史关联，不臆造还关联着", () => {
    const { container } = renderCard({ resume_id: null, resume_title: LONG_RESUME_TITLE });

    const node = container.querySelector(".track-card-resume");
    const expected = `${LONG_RESUME_TITLE}${t("trackerUi.card.resumeHistorical")}`;
    expect(node).toHaveTextContent(t("trackerUi.card.resumeHistorical"));
    expect(node).toHaveAttribute("title", expected);
  });

  it("标题未知时退回 #id，可见文本与 title 一致", () => {
    const { container } = renderCard({ resume_id: 4, resume_title: "" });

    const node = container.querySelector(".track-card-resume");
    expect(node).toHaveTextContent("#4");
    expect(node).toHaveAttribute("title", "#4");
  });

  it("没有简历关联时整段不出现", () => {
    const { container } = renderCard({ resume_id: null, resume_title: "" });

    expect(container.querySelector(".track-card-resume")).toBeNull();
  });
});
