// SPDX-License-Identifier: Apache-2.0
/**
 * 版式控件 · 第一组「结构类」：样式模板 / 版式模板 / 板块顺序 / 最大篇幅。
 *
 * P2 把 `ResumeLayoutControls` 拆成"壳 + 两组"（D4），本文件守的是**拆分后接口没走样**：
 * 四个控件各自只写自己那一个 `layout` 键，而且都把"当前 layout 的其余字段"原样带过去
 * ——少带一个字段的表现是"调页数把字号覆盖丢了"，界面上很难看出来。
 *
 * 这里直接给组件喂 `catalog`（壳负责取数），所以只 mock 画廊自己会发的两个请求。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeTemplateControls from "./ResumeTemplateControls";

const apiMocks = vi.hoisted(() => ({
  fetchResumeTemplates: vi.fn(),
  previewResumeTemplate: vi.fn(),
}));

// 展开真实模块再覆盖：生产代码新增导出时不会因为这里只列了两个而直接抛错。
vi.mock("../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumes")>()),
  fetchResumeTemplates: apiMocks.fetchResumeTemplates,
  previewResumeTemplate: apiMocks.previewResumeTemplate,
}));

/** 带覆盖值的版式：用来验证"只改自己那个键，其它覆盖原样带过去"。 */
const BASE: ResumeLayout = {
  ...DEFAULT_LAYOUT,
  format_name: "standard",
  page_limit: 1,
  format_config: { accent: "#123456" },
};

function renderGroup(
  props: Partial<ComponentProps<typeof ResumeTemplateControls>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <ResumeTemplateControls
        layout={BASE}
        catalog={TEMPLATE_CATALOG}
        onChange={onChange}
        {...props}
      />
    </AntdApp>,
  );
  return onChange;
}

function lastLayout(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

beforeEach(() => {
  apiMocks.fetchResumeTemplates.mockReset();
  apiMocks.previewResumeTemplate.mockReset();
  apiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
  apiMocks.previewResumeTemplate.mockResolvedValue("<html><body>简历</body></html>");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResumeTemplateControls · 样式模板", () => {
  it("按钮显示目录下发的当前模板名，选中即写 layout.template", async () => {
    const onChange = renderGroup();

    // 目录来自 props（壳只取一次），所以按钮文案就是 catalog 里的 label。
    expect(await screen.findByRole("button", { name: "选择简历模板并预览效果" })).toHaveTextContent(
      "经典",
    );

    fireEvent.click(screen.getByRole("button", { name: "选择简历模板并预览效果" }));
    await screen.findByText("选择简历样式模板");

    // 按卡片定位而不是按下标：画廊里"当前使用"的那个按钮是不可点的，
    // 下标会随选中状态漂移，钉住"现代这张卡"才稳。
    const card = (
      await screen.findByText("现代", { selector: ".template-gallery-title > span" })
    ).closest(".template-gallery-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "用这个模板" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastLayout(onChange)).toEqual({ ...BASE, template: "modern" });
  });
});

describe("ResumeTemplateControls · 版式模板", () => {
  it("选定版式写 format_name，并清掉会被该版式覆盖的手动值", async () => {
    const onChange = renderGroup();

    // 按无障碍名定位：这一组里现在有两个下拉（版式 / 简历语言），按 role 裸查会命中两个。
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "版式" }));
    fireEvent.click(await screen.findByText("紧凑"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_name).toBe("compact");
    // 强调色属于"版式会管"的键（「单色强调」改的就是它）。不清掉的话手动值优先级
    // 更高，会把新预设整个盖住——表现就是"选了紧凑，预览一点没变"。
    expect(next.format_config).toEqual({});
    expect(next.template).toBe(BASE.template);
    expect(next.page_limit).toBe(BASE.page_limit);
  });
});

describe("ResumeTemplateControls · 板块顺序", () => {
  it("上移写完整排列进 format_config.section_order，其余覆盖保留", async () => {
    const onChange = renderGroup();

    fireEvent.click(await screen.findByRole("button", { name: "调整简历板块顺序" }));
    await screen.findByRole("list", { name: "简历板块顺序" });
    fireEvent.click(screen.getByRole("button", { name: "把项目经历上移" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config?.section_order).toEqual([
      "summary",
      "education",
      "experience",
      "projects",
      "campus_experience",
      "skills",
      "awards",
    ]);
    // 强调色是另一项覆盖，不该被这次移动覆盖掉。
    expect(next.format_config?.accent).toBe("#123456");
  });

  it("已调整时按钮标出「顺序·已调整」", async () => {
    renderGroup({
      layout: {
        ...BASE,
        format_config: {
          section_order: [
            "projects",
            "summary",
            "education",
            "experience",
            "campus_experience",
            "skills",
            "awards",
          ],
        },
      },
    });

    expect(await screen.findByRole("button", { name: "调整简历板块顺序" })).toHaveTextContent(
      "顺序·已调整",
    );
  });
});

describe("ResumeTemplateControls · 最大篇幅", () => {
  it("点「2 页」只写 layout.page_limit", async () => {
    const onChange = renderGroup();

    fireEvent.click(await screen.findByText("2 页"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastLayout(onChange)).toEqual({ ...BASE, page_limit: 2 });
  });
});
