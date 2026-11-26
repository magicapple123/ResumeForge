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
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { Track } from "../../types";
import { formatServerTime } from "../../utils/serverTime";
import TrackCard from "./TrackCard";

const COMPANY = "示例科技";
const JOB_TITLE = "后端开发";
/** 真实场景里会长到被 260px 砍断：这三段都得留在页面上。 */
const LONG_RESUME_TITLE = "示例科技-后端开发-2026 秋招定制版（第三轮面试专用，含项目补丁）";
const LINK_URL = "https://jobs.example.com/apply?utm_source=referral";
/** 外部简历的标题快照：取的是 `external_resume.name`（通常是安全化后的原文件名）。 */
const EXTERNAL_TITLE = "外部简历-后端-2026-秋招.pdf";

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
  external_resume_id: null,
  channel: "unknown",
  resume_title: "",
  link: "",
  source: "manual",
  created_at: "2026-09-18T08:00:00",
  updated_at: "2026-09-18T08:00:00",
};

function renderCard(patch: Partial<Track> = {}) {
  return render(
    <MemoryRouter initialEntries={["/tracker"]}>
      <AntdApp>
        <TrackCard track={{ ...BASE, ...patch }} onEdit={vi.fn()} onDelete={vi.fn()} />
      </AntdApp>
    </MemoryRouter>,
  );
}

/**
 * 岗位深链（整改 #7）：岗位名可点，公司名不承担跳转。
 *
 * 两个来源：已关联的 `job_id`，与后端派生的 `job_link_id`（识别导入的行没有 job_id，
 * 靠"同公司 + 岗位名唯一命中"补出来）。都没有时保持纯文本——不给死链。
 */
describe("TrackCard 的岗位名深链", () => {
  it("有 job_id 时岗位名是链接，指向岗位广场的深链", () => {
    renderCard({ job_id: 7 });

    const link = screen.getByRole("link", { name: JOB_TITLE });
    expect(link).toHaveAttribute("href", "/jobs?job_id=7");
    expect(link).toHaveAttribute("title", t("trackerUi.card.openJob"));
    // 公司名仍是纯文本（这一行的身份，不做跳转）。
    expect(screen.queryByRole("link", { name: COMPANY })).toBeNull();
  });

  it("job_id 为空、只有派生 job_link_id 时也可点（导入的行）", () => {
    renderCard({ job_id: null, job_link_id: 12 });

    expect(screen.getByRole("link", { name: JOB_TITLE })).toHaveAttribute(
      "href",
      "/jobs?job_id=12",
    );
  });

  it("两个 id 都没有时岗位名是纯文本：不给死链", () => {
    renderCard({ job_id: null, job_link_id: null });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(JOB_TITLE)).toBeInTheDocument();
  });
});

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

/**
 * 外部简历（T6）：进度可以关联"在别处做的原件"。两个判据必须分清——
 * 显示条件要看**三个**字段，而「历史关联」的判据是**两个关联都为空**。
 */
describe("TrackCard 的外部简历关联", () => {
  it("只填了外部关联时也显示简历名，并标明「外部」", () => {
    const { container } = renderCard({ external_resume_id: 9, resume_title: EXTERNAL_TITLE });

    const node = container.querySelector(".track-card-resume");
    expect(node).not.toBeNull();
    expect(node).toHaveTextContent(EXTERNAL_TITLE);
    expect(node).toHaveTextContent(t("trackerUi.card.resumeExternal"));
    // 活关联不该被标成「历史关联」——判据得是两个关联都为空。
    expect(node).not.toHaveTextContent(t("trackerUi.card.resumeHistorical"));
    // 可见文本与 title 仍是同一份完整字符串（带标注）。
    expect(node).toHaveAttribute("title", `${EXTERNAL_TITLE}${t("trackerUi.card.resumeExternal")}`);
  });

  it("外部关联消失（外键 SET NULL）后只剩快照：标历史关联，不再说「外部」", () => {
    const { container } = renderCard({ external_resume_id: null, resume_title: EXTERNAL_TITLE });

    const node = container.querySelector(".track-card-resume");
    expect(node).toHaveTextContent(t("trackerUi.card.resumeHistorical"));
    expect(node).not.toHaveTextContent(t("trackerUi.card.resumeExternal"));
  });

  it("只有标题快照、没有任何关联 id 时仍然显示（显示条件含 external_resume_id 与快照）", () => {
    const { container } = renderCard({
      resume_id: null,
      external_resume_id: null,
      resume_title: EXTERNAL_TITLE,
    });

    expect(container.querySelector(".track-card-resume")).toHaveTextContent(EXTERNAL_TITLE);
  });
});

/**
 * CR-19：首页任务卡的步骤链到 `/tracker?job_id=` 之后，进度行要能看出跟进痕迹。
 * 「已联系 · 11-25」只来自**最近一次 contacted**；其余决策与旧数据都不显示。
 */
describe("TrackCard 的最近跟进（CR-19）", () => {
  const LAST_CONTACT = "2026-11-25T12:00:00";

  it("有已联系记录时显示「已联系 · 月-日」，日期按设备时区", () => {
    const { container } = renderCard({ latest_followup: LAST_CONTACT });

    const node = container.querySelector(".track-card-followup");
    expect(node).not.toBeNull();
    const expectedDate = formatServerTime(LAST_CONTACT, { dateOnly: true }).slice(5);
    expect(node).toHaveTextContent(t("trackerUi.card.followup", { date: expectedDate }));
  });

  it("没有已联系记录（null / 旧接口缺字段）时不显示这一段", () => {
    const { container: withNull } = renderCard({ latest_followup: null });
    expect(withNull.querySelector(".track-card-followup")).toBeNull();

    const { container: withOldShape } = renderCard({});
    expect(withOldShape.querySelector(".track-card-followup")).toBeNull();
  });
});
