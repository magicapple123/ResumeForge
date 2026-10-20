// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」页的快捷键落点（R5）：撤回/恢复作用于整页表单（跨字段），保存走页面
 * 既有的「保存全部资料」入口；输入框里的 `Ctrl+Z` 仍然交给浏览器原生撤销。
 *
 * 单独一个文件而不是塞进 ProfilePage.test.tsx（491 行，预算 500）：那里只差 9 行余量，
 * 这里又要额外挂一层 `ShortcutProvider`（页面级测试不需要它）。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShortcutProvider from "../features/shortcuts/ShortcutProvider";
import ProfilePage from "./ProfilePage";
import { cleanupProfilePage, resetProfileApiMocks } from "../test/profilePageHarness";

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  listResumes: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));

vi.mock("../api/profile", () => ({
  getProfile: apiMocks.getProfile,
  saveProfile: apiMocks.saveProfile,
}));
vi.mock("../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/webform")>()),
  getWebFormExtraProfile: apiMocks.getWebFormExtraProfile,
  updateWebFormExtraProfile: apiMocks.updateWebFormExtraProfile,
}));
vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  listResumes: apiMocks.listResumes,
  deleteResume: vi.fn(),
  renameResume: vi.fn(),
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  generateResume: vi.fn(),
  createManualResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue({ templates: [] }),
}));
vi.mock("../api/settings", () => ({ getLLMConfig: vi.fn().mockResolvedValue({}) }));

/** 页面 + 唯一的全局 keydown 监听宿主（页面级测试默认没有 Provider）。 */
function renderWithShortcuts() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ShortcutProvider>
          <ProfilePage />
        </ShortcutProvider>
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetProfileApiMocks(apiMocks);
});

afterEach(() => {
  cleanupProfilePage();
});

describe("ProfilePage 快捷键", () => {
  it("输入框外的 Ctrl+Z 撤回整页表单的改动，输入框内不劫持", async () => {
    renderWithShortcuts();
    fireEvent.click(await screen.findByRole("button", { name: /编辑资料/ }));

    const nameInput = await screen.findByLabelText("姓名");
    await waitFor(() => expect(nameInput).toBeEnabled());
    expect(nameInput).toHaveValue("张三");
    fireEvent.change(nameInput, { target: { value: "李四" } });
    expect(nameInput).toHaveValue("李四");

    // 输入框里：交给原生撤销，页面级历史不动。
    fireEvent.keyDown(nameInput, { key: "z", ctrlKey: true });
    expect(nameInput).toHaveValue("李四");

    // 输入框外：表单级撤回，回到改动前的值。
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("张三"));

    // 恢复（redo）把改动拿回来。
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("李四"));
  });

  it("Ctrl+S 触发页面既有的保存入口", async () => {
    renderWithShortcuts();
    fireEvent.click(await screen.findByRole("button", { name: /编辑资料/ }));

    const nameInput = await screen.findByLabelText("姓名");
    await waitFor(() => expect(nameInput).toBeEnabled());
    fireEvent.change(nameInput, { target: { value: "王五" } });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(apiMocks.saveProfile).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "王五" }));
  });
});
