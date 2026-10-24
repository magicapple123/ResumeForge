// SPDX-License-Identifier: Apache-2.0
/**
 * W15 照片裁剪端到端（shell 真实链路）：裁剪参数 → 版式落库 → 历史一步 → 移除/换图清理。
 *
 * 关键契约（与后端冻结形状一致）：`format_config.photo_crop = {version:1, source:{sha256,
 * width, height}, rect:{x,y,w,h}, aspect:"free"|"1:1"|"4:5"|"3:4"}`。来源哈希是
 * **照片 data URL 字符串的 sha256**（后端 `photo_sha256` 同口径），不是自造指纹。
 *
 * 产物侧（HTML/PDF/Word 按裁剪渲染）由 `backend/tests/test_proview_export_isolation.py`
 * 用真实导出管线验证，这里只证明前端把参数正确交给了既有版式保存/历史链路。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeContent, ResumeLayout } from "../../types";
import { photoSha256 } from "../../features/resume-proview/photoCrop";
import { runShortcut } from "../../features/shortcuts/useShortcutKeymap";
import ResumeZoomModal from "./ResumeZoomModal";
import { CONTENT, LAYOUT } from "./ResumeZoomModal.testkit";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../../api/resumes", () => ({
  fetchResumePreviewPdf: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("../../api/resumeLayout", () => ({
  renderResume: vi.fn(async () => "<!doctype html><html><body></body></html>"),
}));
vi.mock("../../features/resume-proview/usePhotoDimensions", () => ({
  usePhotoDimensions: () => ({ width: 1200, height: 1600 }),
}));

const PHOTO = "data:image/png;base64,PHOTO-ONE";
const PHOTO_TWO = "data:image/png;base64,PHOTO-TWO";

interface HarnessProps {
  content: ResumeContent;
  layout: ResumeLayout;
  onApplied: (layout: ResumeLayout) => void;
  onCommitLayout: () => Promise<boolean>;
  onSaveContent: (content: ResumeContent) => Promise<void>;
}

/** 最小"宿主"：按真实宿主的方式持有 layout state，并把保存链路口子挂出来。 */
function Host({
  content,
  layout: initial,
  onApplied,
  onCommitLayout,
  onSaveContent,
}: HarnessProps) {
  const [layout, setLayout] = useState(initial);
  return (
    <AntdApp>
      <ResumeZoomModal
        open
        html="<html></html>"
        warnings={[]}
        pages={1}
        onClose={vi.fn()}
        layout={layout}
        resumeId={42}
        content={content}
        onApplyLayout={(next) => {
          onApplied(next);
          setLayout(next);
        }}
        onCommitLayout={onCommitLayout}
        onSaveContent={onSaveContent}
      />
    </AntdApp>
  );
}

function renderHost(overrides: Partial<HarnessProps> = {}) {
  const applied: ResumeLayout[] = [];
  const commit = vi.fn(async () => true);
  const saveContent = vi.fn(async () => undefined);
  const content = overrides.content ?? { ...CONTENT, photo: PHOTO };
  const view = render(
    <Host
      content={content}
      layout={overrides.layout ?? { ...LAYOUT, format_config: {} }}
      onApplied={(next) => {
        applied.push(next);
        overrides.onApplied?.(next);
      }}
      onCommitLayout={overrides.onCommitLayout ?? commit}
      onSaveContent={overrides.onSaveContent ?? saveContent}
    />,
  );
  return { ...view, applied, commit, saveContent, content };
}

function cropDialog(): Promise<HTMLElement> {
  return screen.findAllByRole("dialog").then((dialogs) => {
    const found = dialogs.find((dialog) => within(dialog).queryByText(t("proview.photo.hint")));
    if (!found) throw new Error("crop dialog not found");
    return found;
  });
}

async function openCrop(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: t("proview.photo.button") }));
  return cropDialog();
}

async function applyCrop(): Promise<void> {
  const dialog = await openCrop();
  fireEvent.click(within(dialog).getByRole("button", { name: t("proview.photo.apply") }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("W15 照片裁剪端到端（真实 shell 链路）", () => {
  it("应用裁剪 → format_config.photo_crop 交到宿主（后端冻结形状）→ 历史一步可撤销", async () => {
    const { applied } = renderHost();
    await applyCrop();
    await waitFor(() => expect(applied.length).toBeGreaterThan(0));
    const withCrop = applied[applied.length - 1];
    const domain = withCrop.format_config?.photo_crop as unknown as Record<string, unknown>;
    expect(domain).toBeTruthy();
    expect(domain.version).toBe(1);
    expect(domain.source).toMatchObject({ width: 1200, height: 1600 });
    expect((domain.source as { sha256: string }).sha256).toBe(photoSha256(PHOTO));
    expect(domain.rect).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    expect(domain.aspect).toBe("free");

    // 历史一步：撤销后宿主收到的 layout 里不再有 photo_crop（回到打开时的版式）。
    const beforeUndo = applied.length;
    act(() => {
      runShortcut("undo", new KeyboardEvent("keydown", { key: "z" }));
    });
    await waitFor(() => expect(applied.length).toBeGreaterThan(beforeUndo));
    const restored = applied[applied.length - 1];
    expect(restored.format_config?.photo_crop).toBeUndefined();
  });

  it("裁剪后布局变脏 → 保存修改走宿主 onCommitLayout（既有版式落库链路）", async () => {
    const { commit } = renderHost();
    await applyCrop();
    // 按钮带图标：可访问名是"save 保存修改"，按既有制作台用例的口径用前缀正则。
    const saveButton = await screen.findByRole("button", {
      name: new RegExp(t("workbench.action.save-changes")),
    });
    fireEvent.click(saveButton);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  });

  it("移除照片：清掉会话桥 + 调宿主 onSaveContent({photo:''})", async () => {
    const { saveContent } = renderHost();
    await applyCrop();
    await waitFor(() =>
      expect(sessionStorage.getItem("resumeforge.proview.photo-crop.v1:42")).not.toBeNull(),
    );
    const dialog = await openCrop();
    fireEvent.click(within(dialog).getByRole("button", { name: t("proview.photo.remove") }));
    const confirms = await screen.findAllByRole("button", {
      name: t("proview.photo.removeConfirm"),
    });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(saveContent).toHaveBeenCalled());
    const calls = saveContent.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toBeDefined();
    if (!lastCall) throw new Error("save callback missing");
    const callArgs = lastCall as unknown as [ResumeContent];
    expect(callArgs[0].photo).toBe("");
    await waitFor(() =>
      expect(sessionStorage.getItem("resumeforge.proview.photo-crop.v1:42")).toBeNull(),
    );
  });

  it("换照片：旧裁剪按哈希失效（弹窗里「恢复原图」不可用），不会把旧参数套到新照片", async () => {
    const { rerender } = renderHost();
    await applyCrop();
    await waitFor(() =>
      expect(sessionStorage.getItem("resumeforge.proview.photo-crop.v1:42")).not.toBeNull(),
    );
    // 宿主换了照片（内容保存链路 → 新 content 传回）：复用同一个树渲染即可。
    rerender(
      <Host
        content={{ ...CONTENT, photo: PHOTO_TWO }}
        layout={{ ...LAYOUT, format_config: {} }}
        onApplied={vi.fn()}
        onCommitLayout={vi.fn(async () => true)}
        onSaveContent={vi.fn(async () => undefined)}
      />,
    );
    const dialog = await openCrop();
    expect(within(dialog).getByRole("button", { name: t("proview.photo.reset") })).toBeDisabled();
  });
});
