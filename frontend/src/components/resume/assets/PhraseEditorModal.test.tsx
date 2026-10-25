// SPDX-License-Identifier: Apache-2.0
/** W17 资产编辑：正文改动必须先看 diff 确认；非正文改动直接保存。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { at } from "../../../features/resume-assets/i18n";
import type { ResumePhrase } from "../../../features/resume-assets/types";
import PhraseEditorModal from "./PhraseEditorModal";

const PHRASE: ResumePhrase = {
  id: 7,
  text: "Cut p95 latency from 800ms to 210ms.",
  kind: "achievement",
  language: "en-US",
  job_tags: ["backend", "performance"],
  source_claim_id: null,
  source_resume_id: 3,
  source_object_id: "exp_1",
  quality_note: "",
  usage_count: 2,
  last_used_at: null,
  created_at: "2026-10-01T00:00:00Z",
};

function renderEditor(overrides: Partial<React.ComponentProps<typeof PhraseEditorModal>> = {}) {
  const onSave = vi.fn();
  render(
    <AntdApp>
      <PhraseEditorModal open phrase={PHRASE} onCancel={vi.fn()} onSave={onSave} {...overrides} />
    </AntdApp>,
  );
  return { onSave };
}

afterEach(() => {
  cleanup();
});

describe("PhraseEditorModal", () => {
  it("正文没改时直接保存（不进 diff），标签随 payload 提交", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: at("assets.editor.save") }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0] as { text: string; job_tags: string[] };
    expect(payload.text).toBe(PHRASE.text);
    expect(payload.job_tags).toEqual(["backend", "performance"]);
  });

  it("正文改动先显示修改前/后，确认后才提交新文本", () => {
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText(at("assets.editor.text")), {
      target: { value: "Cut p95 latency from 800ms to 150ms." },
    });
    fireEvent.click(screen.getByRole("button", { name: at("assets.editor.save") }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(at("assets.diff.before"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: at("assets.editor.confirm") }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as { text: string }).text).toBe(
      "Cut p95 latency from 800ms to 150ms.",
    );
  });

  it("返回修改可回到表单，改动仍保留", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText(at("assets.editor.text")), {
      target: { value: "New wording." },
    });
    fireEvent.click(screen.getByRole("button", { name: at("assets.editor.save") }));
    fireEvent.click(screen.getByRole("button", { name: at("assets.editor.back") }));
    const textarea = screen.getByLabelText(at("assets.editor.text")) as HTMLTextAreaElement;
    expect(textarea.value).toBe("New wording.");
  });
});
