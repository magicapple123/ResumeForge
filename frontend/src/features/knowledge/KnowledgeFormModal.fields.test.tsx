// SPDX-License-Identifier: Apache-2.0
/** 知识库表单 #29C/#29D/#29E/29G：reason、公司、摘要、要点与「分类可留空」。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { Knowledge } from "../../types";
import KnowledgeFormModal from "./KnowledgeFormModal";

vi.mock("../../api/jobs", () => ({
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

function renderForm(onSubmit = vi.fn(), entry: Knowledge | null = null) {
  render(
    <AntdApp>
      <KnowledgeFormModal
        open
        entry={entry}
        categories={[]}
        submitting={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    </AntdApp>,
  );
  return onSubmit;
}

afterEach(cleanup);

describe("KnowledgeFormModal #29 fields", () => {
  it("新建时分类不选 = 未分类（不再兜成「其他」）", async () => {
    const submit = renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: t("knowledgeForm.label.title") }), {
      target: { value: "新条目" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const payload = submit.mock.calls[0][0];
    expect(payload.category).toBe("");
    expect(payload.reason).toBe("");
    expect(payload.key_points).toEqual([]);
  });

  it("保存 reason / 公司 / 摘要 / 要点与正文", async () => {
    const submit = renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: t("knowledgeForm.label.title") }), {
      target: { value: "限流设计" },
    });
    fireEvent.change(screen.getByPlaceholderText(t("knowledgeForm.placeholder.reason")), {
      target: { value: "二面被问到限流" },
    });
    fireEvent.change(screen.getByPlaceholderText(t("knowledgeForm.placeholder.company")), {
      target: { value: "字节跳动" },
    });
    fireEvent.change(screen.getByPlaceholderText(t("knowledgeForm.placeholder.summary")), {
      target: { value: "令牌桶与漏桶的取舍" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: t("knowledgeForm.label.content") }), {
      target: { value: "## 正文" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("knowledgeForm.action.addKeyPoint")) }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: `${t("knowledgeForm.label.keyPoints")} 1` }),
      {
        target: { value: "令牌桶允许突发" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const payload = submit.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: "限流设计",
      reason: "二面被问到限流",
      company: "字节跳动",
      summary: "令牌桶与漏桶的取舍",
      content: "## 正文",
      key_points: ["令牌桶允许突发"],
    });
  });

  it("编辑时回填 #29 字段", () => {
    renderForm(vi.fn(), {
      id: 3,
      title: "旧条目",
      category: "",
      tags: [],
      content: "",
      source: "手动录入",
      created_at: "2026-01-01T00:00:00",
      updated_at: "2026-01-01T00:00:00",
      reason: "为什么记",
      company: "示例科技",
      job_id: 9,
      summary: "摘要",
      key_points: ["要点甲"],
    });
    expect(screen.getByDisplayValue("为什么记")).toBeInTheDocument();
    expect(screen.getByDisplayValue("示例科技")).toBeInTheDocument();
    expect(screen.getByDisplayValue("摘要")).toBeInTheDocument();
    expect(screen.getByDisplayValue("要点甲")).toBeInTheDocument();
  });
});
