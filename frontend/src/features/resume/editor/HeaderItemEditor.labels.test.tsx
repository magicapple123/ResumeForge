// SPDX-License-Identifier: Apache-2.0
/**
 * 页眉字段名的三态（F20）：`auto` / `show` / `hide`。
 *
 * 守两件事：
 * 1. 只改「字段名怎么印」，**值一个字节都不动**（一起清掉会让用户以为内容丢了）；
 * 2. 入口只有一处且只对适用位置出现：姓名行与照片不提供（它们没有「字段名」这回事）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { HeaderItem, ResumeDocument } from "../../../types/resumeDocument";
import HeaderItemEditor from "./HeaderItemEditor";

afterEach(cleanup);

function item(overrides: Partial<HeaderItem> = {}): HeaderItem {
  return {
    kind: "field",
    id: "ob_intent001",
    key: "job_intent",
    label: "",
    value: "IntentValue",
    placement: "subtitle",
    format: "text",
    ...overrides,
  };
}

function renderEditor(target: HeaderItem) {
  const doc: ResumeDocument = {
    version: 2,
    language: "zh-CN",
    header: { items: [target], contact_breaks: [] },
    sections: [],
  };
  const change = vi.fn();
  render(
    <AntdApp>
      <HeaderItemEditor
        document={doc}
        path={`header.${target.id}`}
        item={target}
        label="Intent"
        onChange={change}
        onNotice={vi.fn()}
      />
    </AntdApp>,
  );
  return { change, doc };
}

it("默认是「自动」，改成「隐藏字段名」只写 label_mode 并保留值", () => {
  const { change, doc } = renderEditor(item());

  const select = screen.getByRole("combobox", { name: t("structure.layout.labelMode.aria") });
  expect(select.closest(".ant-select")).toHaveTextContent(t("structure.layout.labelMode.auto"));

  fireEvent.mouseDown(select);
  fireEvent.click(screen.getByText(t("structure.layout.labelMode.hide")));

  const next = change.mock.calls[0][0] as ResumeDocument;
  expect(next.header.items[0]).toEqual({ ...item(), label_mode: "hide" });
  expect(doc.header.items[0].value).toBe("IntentValue");
});

it("联系方式与性别行也提供三态；姓名行不提供", () => {
  renderEditor(item({ id: "ob_phone0001", key: "phone", value: "13800000000" }));
  expect(
    screen.getByRole("combobox", { name: t("structure.layout.labelMode.aria") }),
  ).toBeInTheDocument();
  cleanup();

  renderEditor(item({ id: "ob_gender0001", key: "gender", placement: "name_meta", value: "男" }));
  expect(
    screen.getByRole("combobox", { name: t("structure.layout.labelMode.aria") }),
  ).toBeInTheDocument();
  cleanup();

  renderEditor(item({ id: "ob_name000001", key: "name", placement: "name", value: "张三" }));
  expect(
    screen.queryByRole("combobox", { name: t("structure.layout.labelMode.aria") }),
  ).toBeNull();
});
