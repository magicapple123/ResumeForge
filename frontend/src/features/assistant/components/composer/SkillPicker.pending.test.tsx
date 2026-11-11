// SPDX-License-Identifier: Apache-2.0
/**
 * #31D/#31F：待验证的自动生成技能在对话技能菜单里禁用并给出说明。
 *
 * 断言走 role / DOM 文本 + t() 取文案（不在测试里写中文 ByText 字面量），
 * 与 cjkRatchet 的 tests 口径一致。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../../i18n";
import type { AssistantSkill } from "../../../../types";
import { SkillPicker } from "./SkillChips";

function skill(overrides: Partial<AssistantSkill> & { id: number; name: string }): AssistantSkill {
  return {
    description: "",
    enabled: true,
    source_name: "",
    prompt_chars: 10,
    files: [],
    updated_at: "",
    ...overrides,
  };
}

function renderPicker(catalog: AssistantSkill[], onToggle = vi.fn()) {
  render(
    <AntdApp>
      <SkillPicker
        catalog={catalog}
        selected={[]}
        budget={null}
        loaded
        togglingId={null}
        disabled={false}
        onToggle={onToggle}
        onManage={vi.fn()}
      />
    </AntdApp>,
  );
  return onToggle;
}

afterEach(cleanup);

describe("SkillPicker 的待验证技能", () => {
  it("pending 技能禁用勾选并显示说明；validated / 手工技能照常可选", () => {
    const onToggle = renderPicker([
      skill({ id: 1, name: "pending-skill", generated: true, validation_status: "pending" }),
      skill({ id: 2, name: "validated-skill", generated: true, validation_status: "validated" }),
      skill({ id: 3, name: "manual-skill", generated: false, validation_status: "" }),
    ]);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toBeDisabled();
    expect(boxes[1]).toBeEnabled();
    expect(boxes[2]).toBeEnabled();

    // 说明必须点名「待验证」与「先到技能页确认」，否则用户不知道为什么点不动。
    const text = document.body.textContent ?? "";
    expect(text).toContain(t("conversationSkills.menu.pendingBadge"));
    expect(text).toContain(t("conversationSkills.menu.pendingHint"));

    fireEvent.click(boxes[0]);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("已在会话里的待验证技能仍允许取消（避免历史关联卡死）", () => {
    render(
      <AntdApp>
        <SkillPicker
          catalog={[
            skill({ id: 1, name: "pending-skill", generated: true, validation_status: "pending" }),
          ]}
          selected={[{ id: 1, name: "pending-skill", description: "" }]}
          budget={null}
          loaded
          togglingId={null}
          disabled={false}
          onToggle={vi.fn()}
          onManage={vi.fn()}
        />
      </AntdApp>,
    );

    expect(screen.getByRole("checkbox")).toBeEnabled();
  });
});
