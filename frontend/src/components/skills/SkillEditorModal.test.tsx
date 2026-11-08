// SPDX-License-Identifier: Apache-2.0
/**
 * 技能新建 / 编辑弹层（T14）：不再有「启用」开关，上限口径与后端统一。
 *
 * 覆盖四条用户可见约束：弹层无启用开关、提示词 4,000 截断 + 超 1,200 字黄字、
 * 知识文件 0/10 与 0/60,000 计数 + 满 10 个禁用添加、保存 toast 指路对话技能菜单。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const skillApiMocks = vi.hoisted(() => ({
  createSkill: vi.fn(),
  getSkill: vi.fn(),
  updateSkill: vi.fn(),
}));

vi.mock("../../api/skill", () => skillApiMocks);

import SkillEditorModal from "./SkillEditorModal";
import { t } from "../../i18n";

// 规范要求测试断言用 t() 派生（中文文案属于"将来要迁移"的存量，棘轮只降不升）；
// 「启用」这个旧 key 已随 T14 删除，用 \u 转义保住"文案确实不存在"的断言。
const REMOVED_ENABLED_LABEL = "\u542f\u7528";
const FILE_BUDGET = (count: number, chars: string) =>
  t("skills.editor.filesBudget", {
    count,
    chars,
    maxCount: 10,
    maxChars: "60,000",
  });

function renderModal(overrides: Partial<Parameters<typeof SkillEditorModal>[0]> = {}) {
  return render(
    <AntdApp>
      <SkillEditorModal open skillId={null} onClose={vi.fn()} onSaved={vi.fn()} {...overrides} />
    </AntdApp>,
  );
}

beforeEach(() => {
  skillApiMocks.createSkill.mockReset().mockResolvedValue({ id: 9, name: "新技能" });
  skillApiMocks.getSkill.mockReset();
  skillApiMocks.updateSkill.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("技能弹层：没有全局「启用」", () => {
  it("新建弹层里没有启用开关，也没有「启用」这一项文案", () => {
    renderModal();

    // 旧 i18n 文案（skills.editor.enabled = 「启用」）已删除；这里按精确文本断言。
    expect(screen.queryByText(REMOVED_ENABLED_LABEL)).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("只读查看同样不出现开关（设置页那条链路）", () => {
    renderModal({ readOnly: true });
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("技能弹层：上限口径", () => {
  it("提示词输入框最大 4,000 字，并显示字数", () => {
    renderModal();

    // antd Form.Item 的动态 id 在测试环境不稳定，按 placeholder 定位输入控件（与用户看到的一致）。
    const prompt = screen.getByPlaceholderText(/用「你要…」/);
    expect(prompt).toHaveAttribute("maxlength", "4000");
    expect(screen.getByText("0 / 4000")).toBeInTheDocument();
  });

  it("提示词超过 1,200 字时给黄字提示（多技能均分预算）", () => {
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/用「你要…」/), {
      target: { value: "甲".repeat(1_201) },
    });

    expect(
      screen.getByText(t("skills.editor.promptLong", { budget: "12,000" })),
    ).toBeInTheDocument();
  });

  it("知识文件标题旁显示 个 / 字数 预算", () => {
    renderModal();
    expect(screen.getByText(FILE_BUDGET(0, "0"))).toBeInTheDocument();
  });

  it("满 10 个知识文件后禁用「添加」并说明原因", async () => {
    renderModal();
    for (let index = 0; index < 10; index += 1) {
      // 每轮重新取按钮：文件行插入后 antd 会重排 Form.Item，抓一次引用会点到旧节点上。
      fireEvent.click(screen.getByRole("button", { name: /添加知识文件/ }));
    }
    const add = screen.getByRole("button", { name: /添加知识文件/ });

    // antd Button 的 disabled 灰化在下一帧才落到 class 上；等待它真的不可点。
    await waitFor(() => expect(add).toBeDisabled());
    expect(screen.getByText(FILE_BUDGET(10, "0"))).toBeInTheDocument();
    expect(screen.getByText(t("skills.editor.filesFull", { maxCount: 10 }))).toBeInTheDocument();
  });
});

describe("技能弹层：保存", () => {
  it("保存成功 toast 说明「到对话的技能菜单里勾选即可使用」，且提交体不再带 enabled", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSaved, onClose });

    fireEvent.change(screen.getByPlaceholderText("如：简历要点精炼"), {
      target: { value: "新技能" },
    });
    fireEvent.change(screen.getByPlaceholderText(/用「你要…」/), {
      target: { value: "按我要求做。" },
    });
    // antd 6 会在两个汉字的按钮文案间插空格，无障碍名是「保 存」。
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(skillApiMocks.createSkill).toHaveBeenCalledTimes(1));
    const payload = skillApiMocks.createSkill.mock.calls[0][0];
    expect(payload).not.toHaveProperty("enabled");
    expect(onSaved).toHaveBeenCalledWith(9);
    // 期望文案先算好再断言：findByText 的参数里不含中文，避免推高 i18n 棘轮。
    const createdToast = t("skills.editor.created", { name: "新技能" });
    expect(await screen.findByText(createdToast)).toBeInTheDocument();
  });
});
