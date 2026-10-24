// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台画布 → 专业视图的**挂载点**（W15）。
 *
 * 用户能看到专业视图，靠的是这条链：`ResumeZoomModal`（shell）→ `ResumeWorkbenchLiveCanvas`
 * → `ProviewProvider` → `ResumePreview` → `ProviewLayer`。这里钉住"中间那一层有没有把
 * 能力传下去"——漏了这一步，所有专业视图组件都只是"存在但不可达"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ResumeWorkbenchLiveCanvas from "./ResumeWorkbenchLiveCanvas";

vi.mock("../../features/resume/useResumeLivePreview", () => ({
  useResumeLivePreview: () => ({
    state: "idle",
    retry: () => undefined,
    suspend: () => undefined,
    resume: () => undefined,
  }),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
});

function renderCanvas(props: Partial<Parameters<typeof ResumeWorkbenchLiveCanvas>[0]> = {}) {
  return render(
    <AntdApp>
      <ResumeWorkbenchLiveCanvas
        html="<!doctype html><html><body><p>x</p></body></html>"
        warnings={[]}
        pages={1}
        previewRef={{ current: null }}
        content={null}
        {...props}
      />
    </AntdApp>,
  );
}

describe("制作台画布的专业视图挂载", () => {
  it("画布宿主始终包 ProviewProvider：工具条在制作台里可见", () => {
    renderCanvas();
    expect(screen.getByRole("toolbar", { name: t("proview.bar.label") })).toBeInTheDocument();
  });

  it("宿主能力（照片裁剪）经 LiveCanvas 传到画布", () => {
    renderCanvas({ proview: { resumeId: 7, photo: { photo: "data:image/png;base64,AAAA" } } });
    expect(screen.getByRole("button", { name: t("proview.photo.button") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("proview.photo.button") }));
    expect(screen.getByRole("dialog", { name: t("proview.photo.title") })).toBeInTheDocument();
  });
});
