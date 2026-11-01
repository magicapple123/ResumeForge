// SPDX-License-Identifier: Apache-2.0
/**
 * 「生成简历」弹窗的目录引导：后端下发的模板目录 → 版式默认值 + 板块顺序（纯映射）。
 *
 * 从 `GenerateResumeModal.tsx` 拆出——那个文件到 502 行，超 `tests/test_file_size_budget.py`
 * 的 500 行预算。拆出来的是**纯函数**：没有 hook、没有请求、没有 i18n，输入一份目录 +
 * 当前版式，输出四份展示状态和一份新版式。弹窗那边只剩「取目录 → 灌进 setState」这一层，
 * 这段"哪个字段回退到哪个字段"的口径也因此可以单独钉。
 *
 * 三条既有口径（搬过来时逐字保留，别在这里"顺手改好"）：
 *
 * 1. 生成新简历的默认板块顺序跟随「我的资料」（`profile_section_order`）；旧后端不下发
 *    这一项时退回内置默认顺序；
 * 2. 与内置默认顺序**相同时不写** `section_order`（由 `buildSectionOrderConfig` 保证，
 *    老简历外观不因这次生成被追溯改变）；
 * 3. 四个版式参数（模板 / 版式名 / 字号 / 页数）都要重置——此前漏了 `page_limit`，上次选
 *    3 页会被带进下一次，与默认一页矛盾。
 */
import type { ResumeLayout, ResumeTemplateCatalog } from "../../types";
import {
  buildSectionOrderConfig,
  DEFAULT_RESUME_SECTION_ORDER,
} from "../../utils/resumeSectionOrder";

/** 目录里与「生成」相关的默认值（弹窗拿到后直接灌 state）。 */
export interface TemplateCatalogDefaults {
  /** 系统里找到了中文字体：决定「直接下载 PDF」是否可用。 */
  pdfDirectAvailable: boolean;
  /** 「调整板块顺序」的可选项。 */
  sectionOptions: { key: string; label: string }[];
  /** 内置默认顺序（已保存简历没有自己的 `section_order` 时读它）。 */
  builtInSectionOrder: string[];
  /** 「我的资料」里排好的顺序（生成新简历时的默认值）。 */
  profileSectionOrder: string[];
  /**
   * 把当前版式重置成目录里的默认值。
   *
   * 做成"传入 current 再返回新版式"而不是直接给一个补丁对象：弹窗那边是
   * `setLayout(defaults.applyTo)`，保持函数式更新——闭包里的 `layout` 可能是打开瞬间的
   * 旧值，直接 `setLayout({...layout, ...})` 会把这段时间里的其它修改覆盖掉。
   */
  applyTo: (current: ResumeLayout) => ResumeLayout;
}

/**
 * 读一份模板目录，产出「生成」弹窗的默认值。
 *
 * @param catalog 后端 `/resumes/templates` 的返回。
 * @returns 四份展示状态 + 一个版式重置函数。
 */
export function readTemplateCatalogDefaults(
  catalog: ResumeTemplateCatalog,
): TemplateCatalogDefaults {
  const builtInSectionOrder = catalog.default_section_order ?? DEFAULT_RESUME_SECTION_ORDER;
  const profileSectionOrder = catalog.profile_section_order ?? builtInSectionOrder;
  return {
    pdfDirectAvailable: catalog.pdf_direct_available,
    sectionOptions: catalog.section_options ?? [],
    builtInSectionOrder,
    profileSectionOrder,
    applyTo: (current) => ({
      ...current,
      template: catalog.defaults.template,
      format_name: catalog.defaults.format_name ?? "",
      font_scale: catalog.defaults.font_scale,
      page_limit: catalog.defaults.page_limit,
      format_config: buildSectionOrderConfig(
        profileSectionOrder,
        builtInSectionOrder,
        current.format_config ?? {},
      ),
    }),
  };
}
