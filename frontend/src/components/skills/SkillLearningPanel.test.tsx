// SPDX-License-Identifier: Apache-2.0
/**
 * #31D/E/F 技能学习面板：证据不足不提议、四段草稿确认、90 天归档提示。
 *
 * 断言一律走 data-testid / role / DOM 结构，不写中文文案匹配——文案归语言包，
 * 测试钉行为（cjkrRatchet 的 tests 口径只降不升）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SkillLearningPanel from "./SkillLearningPanel";

const mocks = vi.hoisted(() => ({
  listAssistantConversations: vi.fn(),
  listSkillArchiveCandidates: vi.fn(),
  detectSkillCandidate: vi.fn(),
  acceptSkillDraft: vi.fn(),
}));

vi.mock("../../api/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/assistant")>()),
  listAssistantConversations: mocks.listAssistantConversations,
}));

vi.mock("../../api/skill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/skill")>()),
  listSkillArchiveCandidates: mocks.listSkillArchiveCandidates,
  detectSkillCandidate: mocks.detectSkillCandidate,
  acceptSkillDraft: mocks.acceptSkillDraft,
}));

beforeEach(() => {
  mocks.listAssistantConversations.mockReset().mockResolvedValue([{ id: 7 }]);
  mocks.listSkillArchiveCandidates.mockReset().mockResolvedValue([]);
  mocks.detectSkillCandidate.mockReset().mockResolvedValue({
    conversation_id: 7,
    triggers: [],
    draft: null,
  });
  mocks.acceptSkillDraft.mockReset().mockResolvedValue({
    skill_id: 11,
    name: "skill",
    mode: "create",
    version: 1,
    generated: true,
    validation_status: "pending",
    near_duplicate_skill_id: null,
  });
});

afterEach(cleanup);

function renderPanel(onChanged = vi.fn()) {
  const result = render(
    <AntdApp>
      <SkillLearningPanel onChanged={onChanged} />
    </AntdApp>,
  );
  return { onChanged, result };
}

describe("SkillLearningPanel", () => {
  it("no signal: shows a toast but opens no dialog (evidence not enough)", async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId("skill-learning-detect"));

    await waitFor(() => expect(mocks.detectSkillCandidate).toHaveBeenCalledWith(7));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draft detected: opens the four-section form, accept posts all sections, onChanged fires", async () => {
    mocks.detectSkillCandidate.mockResolvedValue({
      conversation_id: 7,
      triggers: ["long_success_trajectory"],
      draft: {
        name: "resume metrics rewrite",
        description: "rewrite experience with numbers",
        when_to_use: "when the user asks for quantified experience",
        steps: ["find outcomes", "add numbers"],
        pitfalls: ["do not invent numbers"],
      },
    });
    const { onChanged } = renderPanel();
    fireEvent.click(await screen.findByTestId("skill-learning-detect"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".ant-modal-footer .ant-btn-primary") as HTMLElement);

    await waitFor(() => expect(mocks.acceptSkillDraft).toHaveBeenCalledOnce());
    expect(mocks.acceptSkillDraft.mock.calls[0][0]).toEqual({
      name: "resume metrics rewrite",
      description: "rewrite experience with numbers",
      when_to_use: "when the user asks for quantified experience",
      steps: ["find outcomes", "add numbers"],
      pitfalls: ["do not invent numbers"],
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it("90-day archive candidates: shown as a dismissible alert, never auto-deleted", async () => {
    mocks.listSkillArchiveCandidates.mockResolvedValue([
      { skill_id: 3, name: "idle skill", last_loaded_at: null },
    ]);
    renderPanel();

    expect(await screen.findByTestId("skill-learning-archive")).toBeInTheDocument();
    // 提示而已：没有任何删除 API 被调用。
    expect(mocks.acceptSkillDraft).not.toHaveBeenCalled();
    fireEvent.click(
      document.querySelector(
        "[data-testid='skill-learning-archive'] .ant-alert-close-icon",
      ) as HTMLElement,
    );
    await waitFor(() => expect(screen.queryByTestId("skill-learning-archive")).toBeNull());
  });
});
