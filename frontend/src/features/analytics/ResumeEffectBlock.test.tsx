// SPDX-License-Identifier: Apache-2.0
/** T32：统计口径含外部简历。
 *
 * 守三条界面契约（中文文案一律走 `t()`，不许在测试里写中文字面量）：
 *
 * 1. 「简历版本效果」那块柱图**标了「仅内部简历」**；
 * 2. 外部简历是**另一块**（独立标题 + 独立空态），id 与内部撞号也不会并进同一行；
 * 3. 口径图例写明「含外部简历」并把内部/外部/未关联三个数摊开；脏数据时未关联夹到 0。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { analyticsDashboard } from "../../pages/analyticsTestFixtures";
import ResumeEffectBlock from "./ResumeEffectBlock";
import ResumeLinkLegend from "./ResumeLinkLegend";

function renderWithApp(node: React.ReactElement) {
  return render(<AntdApp>{node}</AntdApp>);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeEffectBlock 的内外两套口径", () => {
  it("内部那块标「仅内部简历」，外部那块有独立标题", () => {
    renderWithApp(<ResumeEffectBlock data={analyticsDashboard()} />);

    expect(screen.getByText(t("analyticsPage.resumeEffect.internalOnly"))).toBeInTheDocument();
    expect(screen.getByText(t("analyticsPage.resumeEffect.externalTitle"))).toBeInTheDocument();
    expect(
      screen.getByText(t("analyticsPage.resumeEffect.externalDescription")),
    ).toBeInTheDocument();
  });

  it("内部与外部各自显示自己的行，两条不会因为 id 撞号而被并成一条", () => {
    renderWithApp(<ResumeEffectBlock data={analyticsDashboard()} />);

    // 夹具里内部与外部两份简历的 resume_id 都是 1——真实场景就是这样撞号的。
    // 内部标题会同时出现在柱图标签与下方数值行里，所以用 getAllByText。
    expect(screen.getAllByText("Backend v1").length).toBeGreaterThan(0);
    expect(screen.getByText("external-v1.pdf")).toBeInTheDocument();
    expect(
      screen.getByText(t("analyticsPage.resumeEffect.hint", { interview: 1, total: 3 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("analyticsPage.resumeEffect.hint", { interview: 1, total: 2 })),
    ).toBeInTheDocument();
  });

  it("没有外部关联时外部那块显示自己的空态，不影响内部柱图", () => {
    renderWithApp(<ResumeEffectBlock data={analyticsDashboard({ external_resume_effects: [] })} />);

    expect(
      screen.getByText(t("analyticsPage.resumeEffect.externalEmpty")),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Backend v1").length).toBeGreaterThan(0);
  });
});

describe("ResumeLinkLegend 的口径图例", () => {
  it("写明「含外部简历」并给出内部/外部/未关联三个数", () => {
    renderWithApp(<ResumeLinkLegend data={analyticsDashboard()} />);

    expect(screen.getByText(t("analyticsPage.resumeLink.includesExternal"))).toBeInTheDocument();
    // 夹具：总投递 7、关联 3（内部 2 + 外部 1）→ 未关联 4。
    expect(
      screen.getByText(
        t("analyticsPage.resumeLink.legend", { internal: 2, external: 1, none: 4 }),
      ),
    ).toBeInTheDocument();
  });

  it("关联数大于总投递（历史脏数据）时未关联夹到 0，不渲染负数", () => {
    renderWithApp(
      <ResumeLinkLegend
        data={analyticsDashboard({ total_applications: 1, track_resume_linked_count: 2 })}
      />,
    );

    expect(
      screen.getByText(
        t("analyticsPage.resumeLink.legend", { internal: 2, external: 1, none: 0 }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/-1/u)).toBeNull();
  });
});
