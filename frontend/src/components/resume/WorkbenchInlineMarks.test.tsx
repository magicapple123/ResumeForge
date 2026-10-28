// SPDX-License-Identifier: Apache-2.0
/**
 * W07 字符级标记（fe-mount A）在中栏的**真实挂载**：
 * - 工具条靠编辑栏根节点的 onFocusCapture 记住最近聚焦的 textarea（点按钮时它已失焦）；
 * - 写回走表单同一条 onChange（脏值出现），不是只改 DOM；
 * - 应用后下一帧把选区恢复到标记内部；没聚焦过文本框时只提示、不改内容；
 * - **失焦后选区仍可用**：点图标那一拍浏览器可能把选区折叠，工具条回退到"记住的选区"
 *   （2026-10-29 用户反馈"添加链接还需要选取文字"）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent } from "../../types";
import ResumeWorkbenchEditorColumn from "./ResumeWorkbenchEditorColumn";

const CONTENT: ResumeContent = {
  photo: "",
  name: "Ada",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

function renderColumn() {
  return render(
    <AntdApp>
      <ResumeWorkbenchEditorColumn active content={CONTENT} resumeId={7} onSave={vi.fn()} />
    </AntdApp>,
  );
}

function summaryField(): HTMLTextAreaElement {
  const field = document.getElementById("summary");
  expect(field).not.toBeNull();
  return field as HTMLTextAreaElement;
}

function italicButton(): HTMLElement {
  return screen.getByRole("button", { name: t("typography.inline.italicAria") });
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("中栏 · 字符级标记工具条", () => {
  it("斜体写回与打字同一条表单链路，并在下一帧恢复选区", async () => {
    renderColumn();
    const field = summaryField();
    fireEvent.change(field, { target: { value: "Led backend services." } });
    fireEvent.focusIn(field);
    field.setSelectionRange(0, 3);

    fireEvent.click(italicButton());

    expect(field.value).toBe("*Led* backend services.");
    // 脏值 = 表单真的收到了这次写回；只改 DOM 不会点亮它。
    expect(await screen.findByText(t("workbench.status.unsaved"))).toBeInTheDocument();
    await waitFor(() => {
      expect(field.selectionStart).toBe(1);
      expect(field.selectionEnd).toBe(4);
    });
  });

  it("没有聚焦过文本域时不改内容，只说明先点中文本框", async () => {
    renderColumn();
    fireEvent.click(italicButton());
    expect(await screen.findByText(t("typography.inline.noTarget"))).toBeInTheDocument();
  });

  it("文本框失焦、选区被折叠之后，链接仍按记住的选区插入", async () => {
    renderColumn();
    const field = summaryField();
    fireEvent.change(field, { target: { value: "Led backend services." } });
    fireEvent.focusIn(field);
    field.setSelectionRange(0, 3);
    // 选好文字后点工具条：失焦那一拍把选区记下来。
    fireEvent.select(field);
    fireEvent.blur(field);
    // 模拟浏览器在点按钮时把选区收成光标（用户明明选过，实时选区却是空的）。
    field.setSelectionRange(8, 8);

    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkAria") }));
    fireEvent.change(
      screen.getByRole("textbox", { name: t("typography.inline.linkPlaceholder") }),
      {
        target: { value: "https://x.dev" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.inline.linkApply") }));

    expect(field.value).toBe("[Led](https://x.dev) backend services.");
  });
});
