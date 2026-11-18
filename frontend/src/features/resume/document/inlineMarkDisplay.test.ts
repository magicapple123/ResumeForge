// SPDX-License-Identifier: Apache-2.0
/**
 * DF-6 / DF-10：只读展示的**唯一出口**必须剥掉行内标记、且永不露出 `custom:` 内部键。
 *
 * 这里守的是"展示层接线"，不是解析规则（解析由 `inlineMarkRuns.test.ts` 的共享用例钉住）：
 * 结构树、变更摘要、取数三个出口各自漏一条，用户就会在界面上看到源串。
 */
import { describe, expect, it } from "vitest";
import { describeChange, summarizeChange } from "./changeSummary";
import { entry, fieldItem, makeDocument, section, textItem } from "./documentFixtures";
import { fieldDisplayName, summarize } from "./summarize";
import { itemValue } from "./view";
import type { StructureNode } from "./summarize";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

function snap(document: ResumeDocument) {
  return { document, layout: LAYOUT };
}

/** 深度优先收集树里所有 item 节点的 label。 */
function itemLabels(nodes: readonly StructureNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "item" ? [node.label] : itemLabels(node.children ?? []),
  );
}

function treeLabels(document: ResumeDocument): string[] {
  const tree = summarize(document);
  return [...itemLabels(tree.header), ...tree.sections.flatMap((node) => itemLabels([node]))];
}

describe("DF-6 · 只读展示剥离行内标记", () => {
  it("结构树的值显示可见文字，不露 {@…} 源串", () => {
    const document = makeDocument({
      sections: [
        section({
          entries: [
            entry({
              id: "ob_entry001",
              items: [
                fieldItem({
                  id: "ob_item0001",
                  key: "school",
                  placement: "title",
                  value: "{@color=#c0392b}个人项目{@}",
                }),
                textItem({ id: "ob_item0002", text: "带 {@size=0.9}8 人{@}团队" }),
              ],
            }),
          ],
        }),
      ],
    });
    const labels = treeLabels(document);
    expect(labels).toContain("个人项目");
    expect(labels).toContain("带 8 人团队");
    expect(labels.some((label) => label.includes("{@"))).toBe(false);
  });

  it("变更摘要里的条目名与字段名剥离标记，但判定仍看源串", () => {
    const before = makeDocument({
      sections: [
        section({
          entries: [
            entry({
              items: [
                fieldItem({
                  id: "ob_item0001",
                  key: "school",
                  placement: "title",
                  value: "{@color=#c0392b}个人项目{@}",
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const base = before.sections[0].entries[0];
    const after = makeDocument({
      sections: [
        section({
          entries: [
            entry({
              id: base.id,
              items: [
                fieldItem({
                  id: "ob_item0001",
                  key: "school",
                  placement: "title",
                  value: "{@color=#2f6fd0}个人项目{@}",
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const report = summarizeChange(snap(before), snap(after));
    // 只改颜色也必须算改动：相等判定若用剥离后的文字会误报"没有变化"。
    expect(report?.main).toMatchObject({ kind: "value", count: 1 });
    expect(describeChange(report!)).toContain("个人项目");
    expect(describeChange(report!)).not.toContain("{@");
  });

  it("摘要里的条目标题也剥掉行内标记（I-17 附带发现）", () => {
    const build = (value: string) =>
      makeDocument({
        sections: [
          section({
            entries: [
              entry({
                id: "ob_entry010",
                items: [
                  fieldItem({
                    id: "ob_item0101",
                    key: "name",
                    placement: "title",
                    value: "{@color=#2f855a}校园二手交易平台{@}",
                  }),
                  fieldItem({
                    id: "ob_item0102",
                    key: "note",
                    placement: "body",
                    value,
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    const report = summarizeChange(snap(build("V1.0")), snap(build("V1.1")));
    expect(report).not.toBeNull();
    const text = describeChange(report!);
    // 标题来自 document 里的源串，摘要出口必须与其它只读出口同一口径。
    expect(text).toContain("校园二手交易平台");
    expect(text).not.toMatch(/\{@|\*\*/);
  });

  it("view 的取数返回可见文字（字段 / 正文 / 列表 / 作者）", () => {
    expect(itemValue(fieldItem({ value: "{@size=0.9}清华{@}" }))).toBe("清华");
    expect(itemValue(textItem({ text: "**重点**" }))).toBe("重点");
    expect(
      itemValue({
        kind: "list",
        id: "ob_list0001",
        key: "courses",
        label: "",
        values: ["{@size=0.9}甲{@}", "乙"],
        placement: "lead",
        join: "semicolon",
        show_label: false,
        solo: false,
        body_style: "bullet",
      }),
    ).toBe("甲；乙");
    expect(
      itemValue({
        kind: "authors",
        id: "ob_auth0001",
        key: "authors",
        label: "",
        authors: [{ name: "{@size=0.9}张三{@}", is_self: true, corresponding: false }],
        placement: "trail",
        show_label: false,
        solo: false,
      }),
    ).toBe("张三");
  });
});

describe("DF-10 · 字段名兜底永不露 custom: 内部键", () => {
  it("空 label 的自定义字段显示「未命名字段」", () => {
    expect(fieldDisplayName("", "custom:ob_jhdfjembnz3u")).toBe("未命名字段");
    // 目录标签本身也是 custom: 内部键时同样过一遍判据。
    expect(fieldDisplayName("", "custom:ob_jhdfjembnz3u", "custom:ob_jhdfjembnz3u")).toBe(
      "未命名字段",
    );
  });

  it("用户命名后优先显示名字；普通 key 仍原样兜底", () => {
    expect(fieldDisplayName("证书编号", "custom:ob_jhdfjembnz3u")).toBe("证书编号");
    expect(fieldDisplayName("", "school")).toBe("school");
  });
});
