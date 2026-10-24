// SPDX-License-Identifier: Apache-2.0
/**
 * `buildExactPreviewOptions`：精确预览上下文的唯一构造处。
 *
 * 这里只钉两件事：
 *
 * 1. **全部走草稿值**（模板 / 版式 / 页数 / 字号 / 语言 / 覆盖）：换完模板还没保存时，精确
 *    预览就得按新的排。历史 bug 是"草稿选了英文、精确预览还是中文"——语言那一项一旦漏掉，
 *    界面上完全看不出来，只有导出的文件才错。
 * 2. **衬线标题标志**（P1-2）：只在模板目录判定它是衬线模板时为真；目录缺省或自制模板
 *    一律 false（那时不该给"标题字族与草稿不同"的说明）。
 */
import { describe, expect, it } from "vitest";
import type { ResumeDetail, ResumeLayout, ResumeTemplateCatalog } from "../../types";
import { buildExactPreviewOptions } from "./exactPreviewOptions";

const DETAIL = { id: 42 } as unknown as ResumeDetail;

function layout(overrides: Partial<ResumeLayout> = {}): ResumeLayout {
  return {
    template: "elegant",
    format_name: "compact",
    page_limit: 2,
    font_scale: "large",
    language: "en-US",
    format_config: { accent: "#123456" },
    ...overrides,
  } as ResumeLayout;
}

function catalog(templates: { name: string; serif_heading?: boolean }[]): ResumeTemplateCatalog {
  return { templates } as unknown as ResumeTemplateCatalog;
}

describe("buildExactPreviewOptions", () => {
  it("取的全是草稿值（模板 / 版式 / 字号 / 语言 / 覆盖），并带上正文签名", () => {
    const options = buildExactPreviewOptions(DETAIL, layout(), "sig-1");

    expect(options.resumeId).toBe(42);
    expect(options.template).toBe("elegant");
    expect(options.formatName).toBe("compact");
    expect(options.fontScale).toBe("large");
    expect(options.language).toBe("en-US");
    expect(options.formatConfig).toEqual({ accent: "#123456" });
    expect(options.contentSignature).toBe("sig-1");
  });

  it("语言缺省（undefined）时回落 zh-CN——与后端 DEFAULT_RESUME_LANGUAGE 同口径", () => {
    const options = buildExactPreviewOptions(DETAIL, layout({ language: undefined }), "sig-1");

    expect(options.language).toBe("zh-CN");
  });

  it("衬线模板 → headingSerif 为真；非衬线模板 → 假", () => {
    const serifCatalog = catalog([
      { name: "elegant", serif_heading: true },
      { name: "classic", serif_heading: false },
    ]);

    expect(buildExactPreviewOptions(DETAIL, layout(), "s", serifCatalog).headingSerif).toBe(true);
    expect(
      buildExactPreviewOptions(DETAIL, layout({ template: "classic" }), "s", serifCatalog)
        .headingSerif,
    ).toBe(false);
  });

  it("目录缺省，或模板不在目录里（自制模板）→ 不提示", () => {
    expect(buildExactPreviewOptions(DETAIL, layout(), "s").headingSerif).toBe(false);
    expect(
      buildExactPreviewOptions(
        DETAIL,
        layout({ template: "my-own" }),
        "s",
        catalog([{ name: "elegant", serif_heading: true }]),
      ).headingSerif,
    ).toBe(false);
  });
});
