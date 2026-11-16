// SPDX-License-Identifier: Apache-2.0
/**
 * 版式编辑器（I-19）：分区、两列栅格、说明收进 `ⓘ`、颜色「跟随模板」、`requires` 置灰。
 *
 * 道具是**后端真实形状**的 `format_fields`（`group` / `group_en` / `requires` 都在），
 * 断言一律走可见文案与 `t(...)`，不读实现细节；只有"分区顺序"与"两列栅格"这两条需要
 * 落到结构上——它们的判据本来就不是文字。
 *
 * 关于两列：`getBoundingClientRect().top` 相等得靠真实排版引擎，jsdom 一律返回 0，
 * 所以这里钉的是**导致** top 相等的那件事：同一组的字段是同一个
 * `display: grid; grid-template-columns: 1fr 1fr` 容器的直接子元素（一张网格一次排版，
 * 同一行的两项必然同 top）。像素级验收留给有真实渲染器的门禁。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeFormatField } from "../../types";
import FormatTemplateEditorModal, { groupFormatFields } from "./FormatTemplateEditorModal";

vi.mock("../../api/resumeTemplates", () => ({
  createResumeTemplate: vi.fn(),
  updateResumeTemplate: vi.fn(),
}));

/**
 * 与 `resume_template_format.format_field_options()` 同形同序的一份（15 项）。
 *
 * 顺序刻意保留后端的"交错"顺序：照片组被 `header_rule_gap` 切开、`间距` 组排在
 * `字号与行距` 之后——正是这份顺序决定了分区被首次看到时的先后。
 */
const FIELDS: ResumeFormatField[] = [
  {
    key: "accent",
    label: "强调色",
    label_en: "Accent",
    type: "color",
    group: "颜色",
    group_en: "Colors",
    description: "整份简历的点缀色",
    description_en: "Accent color for the resume",
  },
  {
    key: "text_color",
    label: "正文",
    label_en: "Body text",
    type: "color",
    group: "颜色",
    group_en: "Colors",
    description: "正文与条目标题的文字颜色",
    description_en: "Body text color",
  },
  {
    key: "muted_color",
    label: "次要文字",
    label_en: "Secondary text",
    type: "color",
    group: "颜色",
    group_en: "Colors",
    description: "时间、地点这类辅助信息的颜色",
    description_en: "Muted text color",
  },
  {
    key: "line_color",
    label: "分隔线",
    label_en: "Dividers",
    type: "color",
    group: "颜色",
    group_en: "Colors",
    description: "区块之间分隔线的颜色",
    description_en: "Divider color",
  },
  {
    key: "font_scale_adjust",
    label: "字号系数",
    label_en: "Font scale",
    type: "number",
    min: 0.35,
    max: 2.4,
    step: 0.02,
    group: "字号与行距",
    group_en: "Type and line spacing",
    description: "在所选字号档位上再乘一个系数",
    description_en: "Multiplies the selected font size",
  },
  {
    key: "photo_border_width",
    label: "照片边框粗细",
    label_en: "Photo border width",
    type: "number",
    min: 0,
    max: 16,
    step: 1,
    group: "照片",
    group_en: "Photo",
    description: "照片边框的粗细（像素），0 为无边框",
    description_en: "Photo border width in px; 0 removes it",
  },
  {
    key: "photo_border_color",
    label: "照片边框颜色",
    label_en: "Photo border color",
    type: "color",
    group: "照片",
    group_en: "Photo",
    description: "照片边框颜色，默认跟随分隔线色",
    description_en: "Photo border color; defaults to the divider color",
  },
  {
    key: "photo_radius",
    label: "照片圆角",
    label_en: "Photo corner radius",
    type: "number",
    min: 0,
    max: 48,
    step: 1,
    group: "照片",
    group_en: "Photo",
    description: "照片框圆角（像素），模板默认 4",
    description_en: "Photo corner radius in px",
  },
  {
    key: "header_rule_gap",
    label: "页眉线位置",
    label_en: "Header rule offset",
    type: "number",
    min: 0,
    max: 12,
    step: 0.5,
    group: "页眉",
    group_en: "Header",
    description: "线相对文字底边的下移量（mm）；模板没有页眉线时不起作用",
    description_en: "Millimetres below the text",
    requires: "header_border",
  },
  {
    key: "photo_offset_x",
    label: "照片左右偏移",
    label_en: "Photo offset X",
    type: "number",
    min: -40,
    max: 40,
    step: 0.5,
    group: "照片",
    group_en: "Photo",
    description: "照片相对模板位置的左右偏移（毫米）",
    description_en: "Horizontal photo offset in mm",
  },
  {
    key: "photo_offset_y",
    label: "照片上下偏移",
    label_en: "Photo offset Y",
    type: "number",
    min: -40,
    max: 40,
    step: 0.5,
    group: "照片",
    group_en: "Photo",
    description: "照片相对模板位置的上下偏移（毫米）",
    description_en: "Vertical photo offset in mm",
  },
  {
    key: "skill_columns",
    label: "技能每行个数",
    label_en: "Skills per row",
    type: "number",
    min: 1,
    max: 4,
    step: 1,
    group: "间距",
    group_en: "Spacing",
    description: "技能标签一行最多排几个",
    description_en: "Maximum skill tags per row",
  },
  {
    key: "line_height",
    label: "行高",
    label_en: "Line height",
    type: "number",
    min: 0.9,
    max: 3,
    step: 0.01,
    group: "字号与行距",
    group_en: "Type and line spacing",
    description: "正文行与行之间的距离",
    description_en: "Distance between lines",
  },
  {
    key: "page_padding",
    label: "页边距（mm）",
    label_en: "Page margin (mm)",
    type: "number",
    min: 0,
    max: 26,
    step: 0.1,
    group: "间距",
    group_en: "Spacing",
    description: "纸张四边留白",
    description_en: "Margin around the page",
  },
  {
    key: "section_gap",
    label: "区块间距",
    label_en: "Section spacing",
    type: "number",
    min: 0.3,
    max: 3,
    step: 0.1,
    group: "间距",
    group_en: "Spacing",
    description: "两个区块之间的距离",
    description_en: "Gap between sections",
  },
];

/** 目录里的模板版式默认值：只有把 `header_border_width` 调成 0，页眉线那一项才该置灰。 */
const LAYOUTS_WITH_RULE = {
  classic: { header_border_width: 2 },
  minimal: { header_border_width: 0 },
};
const LAYOUTS_WITHOUT_RULE = {
  minimal: { header_border_width: 0 },
  modern: { header_border_width: 0 },
};

function renderEditor(
  options: {
    fields?: ResumeFormatField[];
    templateLayouts?: Record<string, { header_border_width?: number }>;
    config?: Record<string, unknown>;
  } = {},
) {
  render(
    <AntdApp>
      <FormatTemplateEditorModal
        open
        fields={options.fields ?? FIELDS}
        template={{
          id: 7,
          name: "我的紧凑版式",
          kind: "format",
          description: "",
          enabled: true,
          source_name: "",
          created_at: "2026-01-01T00:00:00",
          updated_at: "2026-01-01T00:00:00",
          html: "",
          config: options.config ?? {},
        }}
        templateLayouts={options.templateLayouts ?? LAYOUTS_WITH_RULE}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </AntdApp>,
  );
  return document.querySelector(".rf-format-grid") as HTMLElement;
}

afterEach(() => cleanup());

describe("groupFormatFields", () => {
  it("分区顺序 = 字段首次出现的顺序，未登记分组收到最后且不带组头", () => {
    const groups = groupFormatFields([
      ...FIELDS,
      // 旧后端 / 漏登记的字段：`group` 缺失，必须照常出现而不是被丢掉。
      { key: "custom_thing", label: "漏登记的项", type: "number" },
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "颜色",
      "字号与行距",
      "照片",
      "页眉",
      "间距",
      "",
    ]);
    expect(groups[groups.length - 1].fields.map((field) => field.key)).toEqual(["custom_thing"]);
    // 一个字段都没少：分区只会重排，不会过滤。
    expect(groups.flatMap((group) => group.fields)).toHaveLength(FIELDS.length + 1);
  });

  it("把同一组的字段收在一起（照片组被页眉那一项切开也会重新合并）", () => {
    const groups = groupFormatFields(FIELDS);
    const photo = groups.find((group) => group.key === "照片");
    expect(photo?.fields.map((field) => field.key)).toEqual([
      "photo_border_width",
      "photo_border_color",
      "photo_radius",
      "photo_offset_x",
      "photo_offset_y",
    ]);
  });
});

describe("FormatTemplateEditorModal 分区与栅格", () => {
  it("四个以上组头按首次出现顺序渲染，且照片组带一句组级说明", () => {
    const grid = renderEditor();
    const heads = Array.from(grid.querySelectorAll(".rf-format-group-name")).map(
      (node) => node.textContent,
    );
    expect(heads).toEqual(["颜色", "字号与行距", "照片", "页眉", "间距"]);
    expect(screen.getByText(t("templatesUi.formatEditor.groupNote.photo"))).toBeInTheDocument();
  });

  it("同一组的字段是同一个两列栅格的直接子元素（同一行必然顶边对齐）", () => {
    const grid = renderEditor();
    const cell = (key: string) => screen.getByLabelText(labelOf(key));
    // 颜色组四个字段：都是网格的直接子元素 → 落在同一张 1fr/1fr 网格里。
    for (const key of ["accent", "text_color", "muted_color", "line_color"]) {
      expect(cell(key).closest(".rf-format-grid")).toBe(grid);
      expect(cell(key).parentElement?.className).not.toContain("rf-format-grid-");
    }
    // 15 个参数全部进网格：没有一项被分区逻辑吞掉。
    expect(grid.querySelectorAll(".rf-format-field")).toHaveLength(FIELDS.length);
  });

  it("每条说明都收进 ⓘ，点开后与后端 description 逐字一致", async () => {
    renderEditor();
    const first = FIELDS[0];
    fireEvent.click(
      screen.getByRole("button", {
        name: t("templatesUi.formatEditor.hint.fieldDetail", { name: first.label }),
      }),
    );
    expect(await screen.findByText(first.description as string)).toBeInTheDocument();
    // 说明不再铺在控件下方：表单里没有第二份同样的长文案。
    expect(screen.getAllByText(first.description as string)).toHaveLength(1);
  });
});

describe("FormatTemplateEditorModal 颜色与「跟随模板」", () => {
  /** 15 项里有 5 个颜色：4 个配色 + 照片边框颜色。 */
  const COLOR_COUNT = FIELDS.filter((field) => field.type === "color").length;

  it("没设过的颜色显示「跟随模板」+ 斜纹色块", () => {
    renderEditor();
    expect(screen.getAllByText(t("templatesUi.formatEditor.value.unset"))).toHaveLength(
      COLOR_COUNT,
    );
    const swatches = document.querySelectorAll(".rf-format-swatch");
    expect(swatches).toHaveLength(COLOR_COUNT);
    swatches.forEach((node) => expect(node.className).toContain("is-unset"));
  });

  it("设过的颜色显示 hex 与 ↺，点 ↺ 回到「跟随模板」", async () => {
    renderEditor({ config: { accent: "#2f6fd0" } });
    expect(screen.getByText("#2f6fd0")).toBeInTheDocument();
    expect(screen.getAllByText(t("templatesUi.formatEditor.value.unset"))).toHaveLength(
      COLOR_COUNT - 1,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("templatesUi.formatEditor.action.followTemplate", { name: "强调色" }),
      }),
    );
    await waitFor(() => expect(screen.queryByText("#2f6fd0")).toBeNull());
    expect(screen.getAllByText(t("templatesUi.formatEditor.value.unset"))).toHaveLength(
      COLOR_COUNT,
    );
  });
});

describe("FormatTemplateEditorModal requires 置灰", () => {
  it("目录里有模板带页眉线时，页眉线位置可编辑", () => {
    renderEditor({ templateLayouts: LAYOUTS_WITH_RULE });
    expect(screen.getByLabelText("页眉线位置")).not.toBeDisabled();
    expect(screen.queryByText(t("templatesUi.formatEditor.hint.noHeaderRule"))).toBeNull();
  });

  it("所有模板都没有页眉线时置灰，并写明原因", () => {
    renderEditor({ templateLayouts: LAYOUTS_WITHOUT_RULE });
    expect(screen.getByLabelText("页眉线位置")).toBeDisabled();
    expect(screen.getByText(t("templatesUi.formatEditor.hint.noHeaderRule"))).toBeInTheDocument();
  });

  it("目录不下发 template_layouts（旧后端）时不禁用", () => {
    render(
      <AntdApp>
        <FormatTemplateEditorModal
          open
          fields={FIELDS}
          template={null}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </AntdApp>,
    );
    expect(screen.getByLabelText("页眉线位置")).not.toBeDisabled();
  });
});

/** 取某个 key 对应的控件无障碍名（断言只用得到这几个）。 */
function labelOf(key: string): string {
  return FIELDS.find((field) => field.key === key)?.label ?? key;
}
