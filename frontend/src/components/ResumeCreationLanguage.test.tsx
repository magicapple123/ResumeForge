// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectLocale } from "../i18n/localeStore";
import { t } from "../i18n";
import I18nProvider from "../i18n/I18nProvider";
import { projectionOf } from "../test/profileProjectionFixture";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeContent, ResumeLayout } from "../types";
import GenerateResumeModal from "./GenerateResumeModal";
import ManualResumeModal from "./ManualResumeModal";

const mocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  fetchResumeTemplates: vi.fn(),
  startResumeGeneration: vi.fn(),
  getResumeGenerateTask: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  ...mocks,
}));
vi.mock("../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/settings")>()),
  getLLMConfig: vi.fn().mockResolvedValue({ base_url: "https://example.com", model: "fixture" }),
}));
vi.mock("../utils/backgroundTasks", () => ({
  attachTaskUi: vi.fn(),
  resumeTaskKey: (id: number) => `resume_generate#${id}`,
  watchResumeTask: vi.fn(),
}));
vi.mock("../features/profile-library/useCurrentProjection", () => ({
  useCurrentProjection: () => ({
    data: projectionOf({ content: { name: "Alex" } }),
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("./resume-editor/profileSourceTabs", () => ({ default: () => null }));
vi.mock("./ResumeEditorModal", () => ({
  default: ({
    content,
    onSave,
    footerExtra,
  }: {
    content: ResumeContent;
    onSave: (content: ResumeContent) => Promise<void>;
    footerExtra: ReactNode;
  }) => (
    <>
      <button aria-label="creation.save" onClick={() => void onSave(content)} />
      {footerExtra}
    </>
  ),
}));
vi.mock("./generate-resume/GenerationConfigStage", () => ({
  default: ({
    layout,
    setLayout,
    onStart,
  }: {
    layout: ResumeLayout;
    setLayout: (layout: ResumeLayout) => void;
    onStart: () => void;
  }) => (
    <>
      <output data-testid="creation.language">{layout.language}</output>
      <button aria-label="creation.start" onClick={onStart} />
      <button
        aria-label="creation.choose-zh"
        onClick={() => setLayout({ ...layout, language: "zh-CN" })}
      />
    </>
  ),
}));
vi.mock("./generate-resume/GenerationProgressStage", () => ({ default: () => null }));

beforeEach(() => {
  selectLocale("zh-CN");
  mocks.createManualResume.mockReset().mockResolvedValue({ id: 71 });
  mocks.fetchResumeTemplates.mockReset().mockResolvedValue(TEMPLATE_CATALOG);
  mocks.startResumeGeneration.mockReset().mockResolvedValue({ id: 72, status: "running" });
  mocks.getResumeGenerateTask.mockReset().mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  selectLocale("zh-CN");
});

describe("new Resume language transport", () => {
  it.each(["zh-CN", "en-US"] as const)("saves a new manual Resume with %s", async (locale) => {
    selectLocale(locale);
    render(
      <AntdApp>
        <I18nProvider>
          <ManualResumeModal job={null} open onClose={vi.fn()} />
        </I18nProvider>
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: "creation.save" }));
    await waitFor(() =>
      expect(mocks.createManualResume).toHaveBeenCalledWith(
        expect.objectContaining({
          language: locale,
          content: expect.objectContaining({ name: "Alex" }),
        }),
      ),
    );
  });

  it("creates the Workbench draft in the current UI language", async () => {
    selectLocale("en-US");
    const onOpenWorkbench = vi.fn();
    render(
      <AntdApp>
        <I18nProvider>
          <ManualResumeModal job={null} open onClose={vi.fn()} onOpenWorkbench={onOpenWorkbench} />
        </I18nProvider>
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("workbench.action.open-from-new") }));
    await waitFor(() =>
      expect(mocks.createManualResume).toHaveBeenCalledWith(
        expect.objectContaining({ draft: true, language: "en-US" }),
      ),
    );
    expect(onOpenWorkbench).toHaveBeenCalledWith(71);
  });

  it("keeps an explicit output language through an async catalog response and UI switch", async () => {
    selectLocale("en-US");
    let resolveCatalog!: (catalog: typeof TEMPLATE_CATALOG) => void;
    mocks.fetchResumeTemplates.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );
    const view = render(
      <AntdApp>
        <I18nProvider>
          <GenerateResumeModal job={null} open onClose={vi.fn()} />
        </I18nProvider>
      </AntdApp>,
    );
    expect(screen.getByTestId("creation.language")).toHaveTextContent("en-US");
    fireEvent.click(screen.getByRole("button", { name: "creation.choose-zh" }));
    await act(async () => {
      resolveCatalog(TEMPLATE_CATALOG);
    });
    await act(async () => {
      selectLocale("zh-CN");
    });
    view.rerender(
      <AntdApp>
        <GenerateResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );
    expect(screen.getByTestId("creation.language")).toHaveTextContent("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "creation.start" }));
    await waitFor(() =>
      expect(mocks.startResumeGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ language: "zh-CN" }) }),
      ),
    );
  });

  it("initializes a fresh generation session from UI locale on each open", async () => {
    const onClose = vi.fn();
    const view = render(
      <AntdApp>
        <I18nProvider>
          <GenerateResumeModal job={null} open={false} onClose={onClose} />
        </I18nProvider>
      </AntdApp>,
    );
    selectLocale("en-US");
    view.rerender(
      <AntdApp>
        <I18nProvider>
          <GenerateResumeModal job={null} open onClose={onClose} />
        </I18nProvider>
      </AntdApp>,
    );
    await waitFor(() => expect(screen.getByTestId("creation.language")).toHaveTextContent("en-US"));
    fireEvent.click(screen.getByRole("button", { name: "creation.start" }));
    await waitFor(() =>
      expect(mocks.startResumeGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ language: "en-US" }) }),
      ),
    );
  });
});
