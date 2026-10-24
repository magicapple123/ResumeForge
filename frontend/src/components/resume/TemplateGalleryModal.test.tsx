// SPDX-License-Identifier: Apache-2.0
/**
 * 模板一览：缩略图必须反映用户当前设定的版式与字号系数。
 *
 * 这是"选模板即见预览"里最容易悄悄坏掉的一环——缩略图少传 `format_config` 不会报错，
 * 只会让用户按一张"没带字号系数"的图选模板，选完才发现不一样。所以这里钉住请求参数：
 * `format_name`（基础版式）与 `format_config`（含 `font_scale_adjust`）都要带上。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeLayout } from "../../types";
import TemplateGalleryModal from "./TemplateGalleryModal";

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

const LAYOUT_WITH_ADJUST: ResumeLayout = {
  template: "classic",
  format_name: "compact",
  page_limit: 1,
  font_scale: "standard",
  format_config: { font_scale_adjust: 1.021, accent: "#123456" },
};

beforeEach(() => {
  apiMocks.fetchResumeTemplates.mockReset();
  apiMocks.previewResumeTemplate.mockReset();
  apiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
  apiMocks.previewResumeTemplate.mockResolvedValue("<html><body>简历</body></html>");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderModal(layout: ResumeLayout, onFontScaleChange = vi.fn()) {
  render(
    <AntdApp>
      <TemplateGalleryModal
        open
        layout={layout}
        onFontScaleChange={onFontScaleChange}
        onSelect={() => {}}
        onClose={() => {}}
      />
    </AntdApp>,
  );
  return { onFontScaleChange };
}

describe("TemplateGalleryModal · 缩略图反映字号系数（洞2）", () => {
  it("预览请求带上 format_name 与当前 format_config（含字号系数）", async () => {
    renderModal(LAYOUT_WITH_ADJUST);

    await waitFor(() =>
      expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(
        TEMPLATE_CATALOG.templates.length,
      ),
    );
    // 关键：format_config 必须原样透出——后端靠它把用户拖出来的字号系数乘进档位基准，
    // 少了它缩略图就会停在"无系数"的默认字号。
    expect(apiMocks.previewResumeTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        template_name: "modern",
        format_name: "compact",
        format_config: { font_scale_adjust: 1.021, accent: "#123456" },
        font_scale: "standard",
      }),
    );
  });

  it("没有 format_config 时按空对象下发，不伪造系数", async () => {
    const layoutWithoutConfig: ResumeLayout = {
      template: "classic",
      format_name: "compact",
      page_limit: 1,
      font_scale: "standard",
    };
    renderModal(layoutWithoutConfig);

    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalled());
    const firstCall = apiMocks.previewResumeTemplate.mock.calls[0][0];
    expect(firstCall.format_name).toBe("compact");
    // 没有系数就不该凭空造一个：后端会把空覆盖与 format_name 正常叠加。
    expect(firstCall.format_config ?? {}).toEqual({});
  });

  it("预览内容固定是内置示例：请求里不带 resume_id", async () => {
    renderModal(LAYOUT_WITH_ADJUST);
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalled());

    // 用户口径（2026-10-24）：模板一览的预览不该读自己的简历——既慢，也分不清
    // "这是模板的效果还是我内容的效果"。
    for (const [payload] of apiMocks.previewResumeTemplate.mock.calls) {
      expect("resume_id" in (payload as Record<string, unknown>)).toBe(false);
    }
  });

  it("换字号档位会写回当前简历（受控），而不是只改缩略图", async () => {
    const { onFontScaleChange } = renderModal(LAYOUT_WITH_ADJUST);
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("radio", { name: "大字号" }));

    // 只动这一份简历的 `font_scale`：owner 收到回调后会重排，缩略图也跟着重取。
    expect(onFontScaleChange).toHaveBeenCalledWith("large");
  });
});

// ── "一直加载不出来"（2026-10-24 用户反馈）───────────────────────────────
//
// 旧实现要等 `Promise.all` 全部返回才一次性 setState：六张卡里**任意一张**慢，
// 整屏就一直是三个灰点，看起来就是"模板加载失败"。现在逐张上屏、失败逐张给重试。

describe("TemplateGalleryModal · 缩略图不会整屏卡在加载中", () => {
  function labelOf(name: string): string {
    const item = TEMPLATE_CATALOG.templates.find((entry) => entry.name === name);
    return item ? item.label : name;
  }

  it("一张卡挂住时，先回来的那张照常显示", async () => {
    apiMocks.previewResumeTemplate.mockImplementation((payload: { template_name?: string }) =>
      payload.template_name === "classic"
        ? Promise.resolve("<html><body>ok</body></html>")
        : new Promise<string>(() => {}),
    );

    renderModal(LAYOUT_WITH_ADJUST);

    expect(await screen.findByTitle(`${labelOf("classic")} 预览`)).toBeInTheDocument();
    // 其余卡还在等：证明没有"等最慢的一起上屏"。
    expect(screen.queryByTitle(`${labelOf("modern")} 预览`)).toBeNull();
  });

  it("渲染失败的卡给原因与「重试」，点了会重新取数", async () => {
    apiMocks.previewResumeTemplate.mockImplementation((payload: { template_name?: string }) =>
      payload.template_name === "modern"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve("<html><body>ok</body></html>"),
    );

    renderModal(LAYOUT_WITH_ADJUST);

    expect(await screen.findByText("boom")).toBeInTheDocument();
    const before = apiMocks.previewResumeTemplate.mock.calls.length;

    // antd 会在两个汉字之间插一个空格（「重 试」），按整串取会命中不到。
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));

    await waitFor(() =>
      expect(apiMocks.previewResumeTemplate.mock.calls.length).toBeGreaterThan(before),
    );
  });
});
