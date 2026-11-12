// SPDX-License-Identifier: Apache-2.0
/**
 * 基本信息（页眉）面板 · 「添加页眉字段」的目录值拷贝（需求 6-A）。
 *
 * 需求 6-A 的落点是这两件事，用例一一对应：
 *
 * 1. 从目录下拉选中一个字段后，新 header item 必须**带着资料里的当前值**（`value`）——
 *    以前 `addCustom()` 建出来的是 `value: ""` 的空壳，用户加完还得再敲一遍已经填过的
 *    期望城市 / 政治面貌。值只说明「加入时拷贝」，不承诺此后跟随资料变化（不是活链接）。
 * 2. 目录里**已经在页眉里的 key 不再出现在可加列表**里（否则同一份资料能被加成两个 chip，
 *    纸面上重复出现同一项）。
 *
 * 断言一律走 `t()` 与 ASCII 文案：中文 `*ByText` 会撞 cjkRatchet 的存量口径。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeDocument } from "../document/documentFixtures";
import { t } from "../../../i18n";
import type { DocumentFieldCatalog, ResumeDocument } from "../../../types/resumeDocument";
import DocumentHeaderPanel from "./DocumentHeaderPanel";

/** 目录里「期望城市」的标签与值：标签用 ASCII，避免测试文件里出现中文断言。 */
const TARGET_CITY_LABEL = "Target city";
const TARGET_CITY_VALUE = "Hangzhou";
/** 已经在页眉里的两个 key（与 `makeDocument()` 的夹具一致）。 */
const USED_LABELS = ["Name", "Phone"];
/** 一直可加的第四条：下拉不可为空，否则"没出现"和"下拉根本没内容"分不开。 */
const FREE_LABEL = "Political status";

/** 一份最小目录：两条已用字段 + 一条可加的 6-A 字段（带值）。 */
function catalogFixture(): DocumentFieldCatalog {
  return {
    sections: [],
    header_fields: [
      {
        key: "name",
        label: USED_LABELS[0],
        placement: "name",
        format: "text",
        source_field_id: "basic_info.name",
        value: "Li Si",
      },
      {
        key: "phone",
        label: USED_LABELS[1],
        placement: "contact",
        format: "text",
        source_field_id: "basic_info.phone",
        value: "13800000000",
      },
      {
        key: "target_city",
        label: TARGET_CITY_LABEL,
        placement: "contact",
        format: "text",
        source_field_id: "basic_info.target_city",
        value: TARGET_CITY_VALUE,
      },
      {
        key: "political_status",
        label: FREE_LABEL,
        placement: "contact",
        format: "text",
        source_field_id: "basic_info.political_status",
        value: "Member",
      },
    ],
  };
}

function renderPanel() {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  const onNotice = vi.fn();
  const utils = render(
    <DocumentHeaderPanel
      document={makeDocument()}
      catalog={catalogFixture()}
      selectedPath={null}
      onSelectPath={onSelectPath}
      onChange={onChange}
      onNotice={onNotice}
    />,
  );
  return { ...utils, onChange, onSelectPath, onNotice };
}

/** 最近一次 `onChange` 收到的文档（面板是受控的，宿主负责写回）。 */
function lastDocument(onChange: ReturnType<typeof vi.fn>): ResumeDocument {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeDocument;
}

/**
 * 打开「添加页眉字段」下拉并返回全部选项。
 *
 * 不用 `*ByRole("option")`：antd 的下拉项是 `div.ant-select-item-option`，
 * `role="option"` 只挂在"当前值"的无障碍节点上（同 SetupTab.test.tsx 的说明）。
 */
async function openAddMenu(): Promise<HTMLElement[]> {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: t("document.basic.add") }));
  await waitFor(() =>
    expect(document.querySelectorAll(".ant-select-item-option").length).toBeGreaterThan(0),
  );
  return Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option"));
}

/** 选项文案的纯文本（有的实现会在 label 外再包一层 span，统一取 textContent 去空白）。 */
function optionTexts(options: HTMLElement[]): string[] {
  return options.map((option) => (option.textContent ?? "").trim());
}

describe("DocumentHeaderPanel · 添加页眉字段（6-A）", () => {
  it("从目录加入 target_city 时把资料里的当前值写进 header item", async () => {
    const { onChange, onSelectPath } = renderPanel();
    const options = await openAddMenu();
    const target = options.find((option) => optionTexts([option])[0] === TARGET_CITY_LABEL);
    expect(target).toBeDefined();

    fireEvent.click(target as HTMLElement);

    const items = lastDocument(onChange).header.items;
    const added = items[items.length - 1];
    expect(added.key).toBe("target_city");
    // 值来自目录（资料里的当前值），不是空壳。
    expect(added.value).toBe(TARGET_CITY_VALUE);
    expect(added.label).toBe(TARGET_CITY_LABEL);
    expect(added.placement).toBe("contact");
    // 新字段自动选中：宿主据此把纸面/编辑器定位到它。
    expect(onSelectPath).toHaveBeenCalledWith(`header.${added.id}`);
  });

  it("目录项没有 value（旧后端）时写入空串，不报错", async () => {
    // 6-A 的兼容口径：value 是可选项。旧后端 / 兜底目录不带它时，加入动作必须照旧可用，
    // 只是新条目拿到空值（用户可以就地编辑），绝不能因此抛错或写出 undefined。
    const onChange = vi.fn();
    const legacyCatalog: DocumentFieldCatalog = {
      sections: [],
      header_fields: catalogFixture().header_fields.map((field) => ({
        key: field.key,
        label: field.label,
        placement: field.placement,
        format: field.format,
        source_field_id: field.source_field_id,
      })),
    };
    render(
      <DocumentHeaderPanel
        document={makeDocument()}
        catalog={legacyCatalog}
        selectedPath={null}
        onSelectPath={vi.fn()}
        onChange={onChange}
        onNotice={vi.fn()}
      />,
    );

    const options = await openAddMenu();
    const target = options.find((option) => optionTexts([option])[0] === TARGET_CITY_LABEL);
    fireEvent.click(target as HTMLElement);

    const items = lastDocument(onChange).header.items;
    const added = items[items.length - 1];
    expect(added.key).toBe("target_city");
    expect(added.value).toBe("");
  });

  it("已经在页眉里的字段不再出现在可加列表里（刚加过的 target_city 同样剔除）", async () => {
    const base = makeDocument();
    const alreadyAdded: ResumeDocument = {
      ...base,
      header: {
        ...base.header,
        items: [
          ...base.header.items,
          {
            kind: "field",
            id: "ob_head0009",
            key: "target_city",
            label: TARGET_CITY_LABEL,
            value: TARGET_CITY_VALUE,
            placement: "contact",
            format: "text",
          },
        ],
      },
    };
    render(
      <DocumentHeaderPanel
        document={alreadyAdded}
        catalog={catalogFixture()}
        selectedPath={null}
        onSelectPath={vi.fn()}
        onChange={vi.fn()}
        onNotice={vi.fn()}
      />,
    );

    const texts = optionTexts(await openAddMenu());
    // 下拉确实是打开的、且有内容：只是把三条已用的 key 都剔掉了。
    expect(texts).toContain(FREE_LABEL);
    expect(texts).not.toContain(TARGET_CITY_LABEL);
    for (const used of USED_LABELS) {
      expect(texts).not.toContain(used);
    }
  });

  it("自定义字段仍是空值条目：名字落 label，value 留空", () => {
    const { onChange } = renderPanel();
    const customName = "Volunteer work";
    fireEvent.change(screen.getByLabelText(t("document.basic.customField")), {
      target: { value: customName },
    });
    fireEvent.click(screen.getByRole("button", { name: t("document.basic.customAdd") }));

    const items = lastDocument(onChange).header.items;
    const added = items[items.length - 1];
    expect(added.label).toBe(customName);
    expect(added.value).toBe("");
    expect(added.key.startsWith("custom_")).toBe(true);
  });

  it("面板如实说明「值不会随资料同步」", () => {
    renderPanel();
    expect(screen.getByText(t("document.basic.addedValueHint"))).toBeInTheDocument();
  });
});
