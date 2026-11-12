// SPDX-License-Identifier: Apache-2.0
/**
 * 「生成简历」弹窗的目录引导：后端下发的模板目录 → 版式默认值 + 板块顺序（纯映射）。
 *
 * 从 `GenerateResumeModal.tsx` 拆出——那个文件到 502 行，超 `tests/test_file_size_budget.py`
 * 的 500 行预算。拆出来的是**纯函数**：没有 hook、没有请求、没有 i18n，输入一份目录 +
 * 当前版式，输出四份展示状态和一份新版式。弹窗那边只剩「取目录 → 灌进 setState」这一层，
 * 这段"哪个字段回退到哪个字段"的口径也因此可以单独钉。
 *
 * 四条既有口径（搬过来时逐字保留，别在这里"顺手改好"）：
 *
 * 1. 生成新简历的默认板块顺序跟随「我的资料」（`profile_section_order`）；旧后端不下发
 *    这一项时退回内置默认顺序；
 * 2. 与内置默认顺序**相同时不写** `section_order`（由 `buildSectionOrderConfig` 保证，
 *    老简历外观不因这次生成被追溯改变）；
 * 3. 四个版式参数（模板 / 版式名 / 字号 / 页数）都要重置——此前漏了 `page_limit`，上次选
 *    3 页会被带进下一次，与默认一页矛盾；
 * 4. 与「当前组」有关的两个字段（4-A）**只影响可排清单与默认顺序**：`group_section_keys`
 *    为空或缺省时必须回退到全量清单（组读不到、组里只有页眉、旧后端都落在这里）——
 *    这是"宁可多列几个板块"而不是"列表空了、用户什么都排不了"的取舍。组里有、目录标签
 *    表里没有的键补**兜底标签**（不是丢掉、也不是显示裸 key），理由见 `fallbackSectionLabel`。
 */
import type { GroupSectionScope, ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import { sectionKeyLabel } from "../outline/sectionLabels";
import {
  buildSectionOrderConfig,
  DEFAULT_RESUME_SECTION_ORDER,
} from "../../../utils/resumeSectionOrder";

/**
 * 目录响应 + 4-A 的组范围字段。
 *
 * 为什么用交叉类型而不是直接把两个字段写进 `ResumeTemplateCatalog`：那个文件正好卡在
 * 500 行预算上（`test_file_size_budget`，`resume.ts` 已在 500 行）。契约与口径写在
 * `types/resumeGroupScope.ts`（同目录、已从 `types/index` 导出），这里只做拼装；
 * 等 `resume.ts` 腾出空间后把 `extends GroupSectionScope` 补回去即可，这一行不用改
 * （可选字段的交叉类型对既有调用方是**宽松**的：`ResumeTemplateCatalog` 仍然可传入）。
 */
export type ResumeTemplateCatalogWithGroupScope = ResumeTemplateCatalog & GroupSectionScope;

/** 目录里与「生成」相关的默认值（弹窗拿到后直接灌 state）。 */
export interface TemplateCatalogDefaults {
  /** 系统里找到了中文字体：决定「直接下载 PDF」是否可用。 */
  pdfDirectAvailable: boolean;
  /**
   * 「调整板块顺序」的可选项（4-A 起按当前组裁剪；组读不到时为全量）。
   *
   * 裁剪时**只含组内键**；组里有、目录标签表里没有的键会带上兜底标签（不是裸 key），
   * 因此"行数 = 组内板块数"这条口径在任何情况下都成立。
   */
  sectionOptions: { key: string; label: string }[];
  /** 内置默认顺序（已保存简历没有自己的 `section_order` 时读它）。 */
  builtInSectionOrder: string[];
  /** 「我的资料」里排好的顺序（生成新简历时的默认值；按组裁剪时为组内顺序）。 */
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

/** 从任意 JSON 里取一列非空字符串（旧后端 / 脏数据都不许让这里抛）。 */
function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/**
 * 组内键在目录标签表里查不到时的兜底标签。
 *
 * 为什么必须有：目录 `section_options` 是**全局静态表**（12 个系统键 + 当前**启用中**的自建
 * 板块），而组范围是另算的一份清单，两者会错开——自建板块被停用、映射口径调整后多出的新
 * 键、后端比前端先加一个分区，都会出现"组里参与、目录里没有标签"。这时两个都会错的做法：
 * 丢掉这个键（少一行就少一个能排的板块，而它的内容确实会参与这次生成）、显示裸 key
 * （界面上出现 `patents` / `custom:17`）。
 *
 * `sectionKeyLabel` 是系统分区名的唯一映射入口（结构树 / 条目字段排版 / 分页面板共用）：
 * 12 个系统键走语言包，未知键与 `custom:<key>` 落到「未命名板块」，中英界面都不露 key。
 */
function fallbackSectionLabel(key: string): string {
  return sectionKeyLabel(key);
}

/**
 * 按当前组裁剪可排清单。
 *
 * 返回 `filtered=false` 表示**没有裁剪**（清单必须保持全量）：组字段缺省/为空（旧后端、
 * 组里只有页眉、投影读取失败）或组里的键在目录里一个都对不上（映射口径变化时的自保）。
 * 这两种情况下都绝不能返回空数组——「调整板块顺序」会因为清单为空而整块消失。
 *
 * 部分对得上时按组裁剪，并把**对不上的那些键**用兜底标签补在末尾：组范围是"这次生成到底
 * 有哪些板块"的唯一真源，目录标签只是展示用的，缺标签不该让一个真板块从清单里消失。
 */
function filterByGroup(
  options: { key: string; label: string }[],
  groupKeys: string[],
): { options: { key: string; label: string }[]; filtered: boolean } {
  if (groupKeys.length === 0) return { options, filtered: false };
  const allowed = new Set(groupKeys);
  // `filter` 已经返回新数组，下面的 push 不会改到目录本身（调用方可能复用同一份 catalog）。
  const kept = options.filter((option) => allowed.has(option.key));
  // 一个都对不上 → 认定"组范围"与"目录口径"不同源（字段名或映射表被改过）。此时补出来的
  // 兜底标签会整列变成「未命名板块」，比"多列几个真板块"糟得多，所以整体回退全量。
  if (kept.length === 0) return { options, filtered: false };
  const seen = new Set(kept.map((option) => option.key));
  for (const key of groupKeys) {
    if (seen.has(key)) continue; // 目录里已有（含重复的组键）就保留目录的标签
    seen.add(key);
    kept.push({ key, label: fallbackSectionLabel(key) });
  }
  return { options: kept, filtered: true };
}

/**
 * 读一份模板目录，产出「生成」弹窗的默认值。
 *
 * @param catalog 后端 `/resumes/templates` 的返回。
 * @returns 四份展示状态 + 一个版式重置函数。
 */
export function readTemplateCatalogDefaults(
  catalog: ResumeTemplateCatalogWithGroupScope,
): TemplateCatalogDefaults {
  const builtInSectionOrder = catalog.default_section_order ?? DEFAULT_RESUME_SECTION_ORDER;
  const groupKeys = textList(catalog.group_section_keys);
  const { options: sectionOptions, filtered } = filterByGroup(
    catalog.section_options ?? [],
    groupKeys,
  );
  // 顺序只认可见的键：4-A 要求「与资料顺序同步」只同步当前组参与的板块，不得把被隐藏的
  // 板块写回 `section_order`。顺序字段缺失时退回可见清单本身（目录顺序），同样是"只含可见键"。
  const visibleKeys = new Set(sectionOptions.map((option) => option.key));
  const groupOrder = filtered
    ? textList(catalog.group_section_order).filter((key) => visibleKeys.has(key))
    : [];
  // 裁剪生效时**绝不**回到 `profile_section_order`：那是全局顺序，含被当前组隐藏的板块，
  // 拿它做同步会把隐藏键写回 `section_order`（4-A 的验收第 3 条）。
  const profileSectionOrder = filtered
    ? groupOrder.length > 0
      ? groupOrder
      : sectionOptions.map((option) => option.key)
    : (catalog.profile_section_order ?? builtInSectionOrder);
  return {
    pdfDirectAvailable: catalog.pdf_direct_available,
    sectionOptions,
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
