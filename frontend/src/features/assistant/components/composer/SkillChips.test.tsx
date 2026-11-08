// SPDX-License-Identifier: Apache-2.0
/**
 * 技能 chip（T14 / R05）：截断态与跳过态要说清"到底加载了多少"。
 *
 * R06-A：空态入口（「+ 技能」虚线按钮）收进了工具栏的 `+` 面板，所以这里的组件只负责
 * 已选 chip 行；勾选列表与预算行由 `SkillPicker` 渲染（在 `AddMenu.test.tsx` 里覆盖）。
 *
 * 数字全部来自后端下发的 `budget.per_skill`——本组件不重算预算。所以这里的断言是
 * 「后端给什么，tooltip 就说什么」：
 *
 * - 未截断：不出现 tooltip（完整生效的技能没有可解释的事）；
 * - 被截断：`只加载了前 {loaded} 字（共 {requested} 字）`，两个数都来自明细；
 * - 整块跳过（loaded 0）：换成"整块未加载"，不给用户看"前 0 字"；
 * - 缺明细（草稿态 / 升级前的后端响应）：退回不带数字的通用说明。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SkillChips from "./SkillChips";
import { t } from "../../../../i18n";
import type { ConversationSkillsPayload } from "../../../../api/conversationSkills";

/** 技能名用 ASCII：只为避免测试夹具里的中文进 ByText 断言（与文案口径无关）。 */
const SKILL_NAME = "interview-skill";

type Budget = ConversationSkillsPayload["budget"];

function renderChips(budget: Budget | null) {
  return render(
    <AntdApp>
      <SkillChips
        catalog={[
          {
            id: 1,
            name: SKILL_NAME,
            description: "",
            enabled: true,
            source_name: "",
            prompt_chars: 4_000,
            files: [],
            updated_at: "",
          },
        ]}
        selected={[{ id: 1, name: SKILL_NAME, description: "" }]}
        budget={budget}
        togglingId={null}
        disabled={false}
        onToggle={vi.fn()}
      />
    </AntdApp>,
  );
}

/** 悬停到 chip 上并取回 tooltip 文案；没有 tooltip 时返回 null。 */
async function hoverTooltipText(): Promise<string | null> {
  fireEvent.mouseEnter(screen.getByText(SKILL_NAME));
  // antd Tooltip 有 0.1s 的 mouseEnterDelay：必须等，"没出现"这个结论也得等过延迟才成立。
  // 窗口给 500ms（延迟的 5 倍）：够宽松，又不会让"不该出现"的那条用例白等默认超时。
  const tooltip = await screen.findByRole("tooltip", {}, { timeout: 500 }).catch(() => null);
  return tooltip ? tooltip.textContent : null;
}

afterEach(cleanup);

describe("技能 chip 的截断说明（R05）", () => {
  it("被截断时说明「只加载了前 N 字（共 M 字）」，数字来自 per_skill", async () => {
    renderChips({
      used_chars: 16_229,
      loaded_chars: 11_490,
      limit_chars: 12_000,
      truncated_skill_ids: [1],
      per_skill: [{ skill_id: 1, requested_chars: 4_028, loaded_chars: 1_029 }],
    });

    expect(await hoverTooltipText()).toBe(
      t("conversationSkills.chip.truncatedCount", { loaded: "1,029", requested: "4,028" }),
    );
  });

  it("整块跳过（loaded_chars 为 0）时换成「整块未加载」，不显示「前 0 字」", async () => {
    renderChips({
      used_chars: 16_229,
      loaded_chars: 11_490,
      limit_chars: 12_000,
      truncated_skill_ids: [1],
      per_skill: [{ skill_id: 1, requested_chars: 4_028, loaded_chars: 0 }],
    });

    const text = await hoverTooltipText();

    expect(text).toBe(t("conversationSkills.chip.skippedHint"));
    expect(text).not.toContain("0");
  });

  it("完整加载的技能不显示 tooltip", async () => {
    renderChips({
      used_chars: 145,
      loaded_chars: 145,
      limit_chars: 12_000,
      truncated_skill_ids: [],
      per_skill: [{ skill_id: 1, requested_chars: 34, loaded_chars: 34 }],
    });

    expect(await hoverTooltipText()).toBeNull();
  });

  it("后端没给 per_skill（草稿态 / 旧响应）时退回不带数字的通用说明", async () => {
    renderChips({
      used_chars: 13_000,
      loaded_chars: 12_000,
      limit_chars: 12_000,
      truncated_skill_ids: [1],
    });

    expect(await hoverTooltipText()).toBe(t("conversationSkills.chip.truncatedHint"));
  });
});
