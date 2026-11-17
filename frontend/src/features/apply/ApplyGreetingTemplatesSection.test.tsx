// SPDX-License-Identifier: Apache-2.0
/**
 * #14D 话术库：默认只读、行内展开、一次只开一条、保存不发送本地计数。
 *
 * 这一块最容易静默出错的不是"能不能编辑"，而是**保存把计数覆盖掉**：整表 PUT 写的是
 * 绝对值，而套用发生在队列页。所以用例把"提交载荷里没有 uses"钉死。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getGreetingTemplates: vi.fn(),
  saveGreetingTemplates: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  getGreetingTemplates: apiMocks.getGreetingTemplates,
  saveGreetingTemplates: apiMocks.saveGreetingTemplates,
}));

import { t } from "../../i18n";
import ApplyGreetingTemplatesSection from "./ApplyGreetingTemplatesSection";

const TEMPLATES = [
  { id: "tpl-1", name: "通用开场", body: "您好{name}，看到贵司的{job_title}。", tags: [], uses: 4 },
  { id: "tpl-2", name: "实习开场", body: "您好，我想应聘实习岗位。", tags: [], uses: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getGreetingTemplates.mockResolvedValue({ templates: TEMPLATES });
  apiMocks.saveGreetingTemplates.mockImplementation((templates: Record<string, unknown>[]) =>
    Promise.resolve({ templates: templates.map((item) => ({ ...item, uses: 0 })) }),
  );
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderSection() {
  return render(
    <AntdApp>
      <ApplyGreetingTemplatesSection />
    </AntdApp>,
  );
}

function editButtons() {
  return screen.getAllByRole("button", { name: t("applySettings.templates.edit") });
}

describe("ApplyGreetingTemplatesSection", () => {
  it("默认只读：显示名称、正文与用过次数，不铺开输入框", async () => {
    renderSection();

    expect(await screen.findByText(TEMPLATES[0].name)).toBeInTheDocument();
    expect(screen.getByText(TEMPLATES[0].body)).toBeInTheDocument();
    expect(screen.getByText(t("applySettings.templates.uses", { count: 4 }))).toBeInTheDocument();
    // 只读态不该出现编辑用的输入框。
    expect(screen.queryByLabelText(t("applySettings.templates.name"))).toBeNull();
    expect(screen.queryByLabelText(t("applySettings.templates.body"))).toBeNull();
  });

  it("点编辑在原位展开，且一次只展开一条", async () => {
    renderSection();
    await screen.findByText(TEMPLATES[0].name);

    fireEvent.click(editButtons()[0]);
    const nameInput = (await screen.findByLabelText(
      t("applySettings.templates.name"),
    )) as HTMLInputElement;
    expect(nameInput.value).toBe("通用开场");

    // 展开第二条：第一条的编辑器收起（不会并排出现两个长正文输入框）。
    // 展开后第一行的「编辑」按钮随摘要一起消失，列表里只剩第二行那一颗。
    fireEvent.click(editButtons()[0]);
    await waitFor(() =>
      expect(screen.getAllByLabelText(t("applySettings.templates.body"))).toHaveLength(1),
    );
    expect(
      (screen.getByLabelText(t("applySettings.templates.name")) as HTMLInputElement).value,
    ).toBe("实习开场");
  });

  it("新建模板后自动展开，直接可以开始写", async () => {
    renderSection();
    await screen.findByText(TEMPLATES[0].name);

    // 按钮带图标，可访问名里会带 "plus"，用正则匹配文字部分。
    fireEvent.click(screen.getByRole("button", { name: /新建模板/ }));

    const input = (await screen.findByLabelText(
      t("applySettings.templates.name"),
    )) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("保存时不发本地 uses：保存后计数不丢（否则整表覆盖会把队列里累计的清零）", async () => {
    renderSection();
    await screen.findByText(TEMPLATES[0].name);

    fireEvent.click(editButtons()[0]);
    const body = await screen.findByLabelText(t("applySettings.templates.body"));
    fireEvent.change(body, { target: { value: "您好{name}，改过的正文。" } });

    fireEvent.click(screen.getByRole("button", { name: t("applySettings.templates.save") }));

    await waitFor(() => expect(apiMocks.saveGreetingTemplates).toHaveBeenCalledTimes(1));
    const payload = apiMocks.saveGreetingTemplates.mock.calls[0][0] as Record<string, unknown>[];
    expect(payload).toHaveLength(2);
    expect(payload[0]).toEqual({
      id: "tpl-1",
      name: "通用开场",
      body: "您好{name}，改过的正文。",
      tags: [],
    });
    expect(payload[0]).not.toHaveProperty("uses");
    expect(payload[1]).not.toHaveProperty("uses");
  });

  it("保存回包里的计数会回填到只读行", async () => {
    apiMocks.saveGreetingTemplates.mockResolvedValue({
      templates: [{ ...TEMPLATES[0], uses: 7 }, TEMPLATES[1]],
    });
    renderSection();
    await screen.findByText(TEMPLATES[0].name);

    fireEvent.click(screen.getByRole("button", { name: t("applySettings.templates.save") }));

    expect(
      await screen.findByText(t("applySettings.templates.uses", { count: 7 })),
    ).toBeInTheDocument();
  });

  it("删除只作用于本地列表，保存前不会打接口", async () => {
    renderSection();
    await screen.findByText(TEMPLATES[0].name);

    const firstRow = document.querySelectorAll(".apply-template-row")[0];
    fireEvent.click(
      within(firstRow as HTMLElement).getByRole("button", {
        name: t("applySettings.templates.remove"),
      }),
    );

    await waitFor(() => expect(screen.queryByText(TEMPLATES[0].name)).toBeNull());
    expect(apiMocks.saveGreetingTemplates).not.toHaveBeenCalled();
  });
});
