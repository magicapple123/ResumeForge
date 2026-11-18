// SPDX-License-Identifier: Apache-2.0
/**
 * `ObjectStylePanel` 两个测试文件共用的 setup。
 *
 * 为什么单独一个文件：`ObjectStylePanel.test.tsx` 有 8 个 describe、561 行，超过
 * `test_file_size_budget.py` 的 500 行硬闸门。按 describe 拆成"面板主体"与"探针/对象层/手风琴"
 * 两个文件后，两边都要同一份 LAYOUT / 渲染入口 / 断言助手——复制一份会让"改 fixture 要改两处"。
 *
 * `afterEach` 故意留各自文件里：它注册到"导入它的那个测试文件"，放进这里会被两个文件各收一次。
 */
import { App as AntdApp } from "antd";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeLayout } from "../../../types";
import type { ResumeEntry } from "../../../types/resumeDocument";
import { entry, fieldItem, listItem } from "../document/documentFixtures";
import ObjectStylePanel from "./ObjectStylePanel";

export const OBJECT_ID = "exp_12345678";
export const OTHER_ID = "prj_87654321";

export const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {
    accent: "#123456",
    roles: { version: 1, body: { line_height: 1.55 } },
    objects: { version: 1, [OTHER_ID]: { bullet: "none" } },
  } as never,
};

export function editableEntry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return entry({
    id: OBJECT_ID,
    items: [
      fieldItem({ id: "ob_item0001", placement: "title", value: "Star River" }),
      fieldItem({ id: "ob_item0002", placement: "meta", value: "2020" }),
      listItem({ id: "ob_item0003", placement: "body" }),
    ],
    ...overrides,
  });
}

export function renderPanel(
  props: Partial<ComponentProps<typeof ObjectStylePanel>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <ObjectStylePanel
        layout={LAYOUT}
        catalog={TEMPLATE_CATALOG}
        objectId={OBJECT_ID}
        objectLabel="Star River"
        entry={editableEntry()}
        onChange={onChange}
        {...props}
      />
    </AntdApp>,
  );
  return onChange;
}

export function lastLayout(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

export function rowTestId(prop: string): string {
  return `[data-testid="style-row-object-${prop}"]`;
}
