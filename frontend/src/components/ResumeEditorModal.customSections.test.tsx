// SPDX-License-Identifier: Apache-2.0
/**
 * F4 §5.6 / C2：编辑器对 credentials 与 custom_sections 的**往返不丢段**。
 *
 * 已保存简历里的可选栏目不能被一次"改一句话再保存"抹掉：`mergePartial` 以服务端
 * content 打底再覆盖表单值，本文件钉住这条行为；同时自建栏目以独立页签出现且可编辑。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../types";
import { makeResumeContent } from "./ResumeEditorModal.testkit";
import ResumeEditorModal from "./ResumeEditorModal";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function contentWithOptionalSections(): ResumeContent {
  return makeResumeContent({
    summary: "个人总结",
    credentials: [
      {
        name: "CET-6",
        issuer: "教育部考试中心",
        issue_date: "2024.06",
        expiry_date: "",
        status: "active",
        verify_url: "",
        note: "",
        id: "credential-1",
      },
    ],
    custom_sections: [
      {
        key: "custom:open-source",
        title: "开源贡献",
        entries: [
          {
            entry_id: "os-1",
            text: "维护统一网关平台的开源插件生态。",
            lines: [{ label: "角色", value: "维护者" }],
          },
        ],
      },
    ],
  } as ResumeContent);
}

async function renderAndSave(content: ResumeContent) {
  const onSave = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
  render(
    <AntdApp>
      <ResumeEditorModal open content={content} onClose={vi.fn()} onSave={onSave} />
    </AntdApp>,
  );
  await screen.findByText(BASIC_TAB);
  fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0] as ResumeContent;
}

// 同前：中文只放常量，避免新增 ByText 断言抬高 tests 棘轮。
const BASIC_TAB = "基本信息";
const CUSTOM_TAB = "自定义栏目";
const SAVE_BUTTON = /保存并更新预览/;
const CRED_TAB = "证书资质";

describe("ResumeEditorModal 可选栏目往返", () => {
  it("不改动直接保存：custom_sections 与 credentials 原样保留（含稳定 id）", async () => {
    const content = contentWithOptionalSections();
    const saved = await renderAndSave(content);
    expect(saved.custom_sections).toEqual(content.custom_sections);
    expect(saved.credentials).toEqual(content.credentials);
    expect(saved.credentials?.[0].id).toBe("credential-1");
  });

  it("自定义栏目是独立页签，编辑标题后保存带上新值且条目/标签行不丢", async () => {
    const content = contentWithOptionalSections();
    const onSave = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
    render(
      <AntdApp>
        <ResumeEditorModal open content={content} onClose={vi.fn()} onSave={onSave} />
      </AntdApp>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: CUSTOM_TAB }));
    const tabPanel = await screen.findByRole("tabpanel");
    const titleInput = within(tabPanel).getByLabelText(CUSTOM_TAB);
    fireEvent.change(titleInput, { target: { value: "开源贡献（改）" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as ResumeContent;
    expect(saved.custom_sections?.[0].title).toBe("开源贡献（改）");
    expect(saved.custom_sections?.[0].entries[0].text).toBe("维护统一网关平台的开源插件生态。");
    expect(saved.custom_sections?.[0].entries[0].lines[0]).toEqual({
      label: "角色",
      value: "维护者",
    });
  });

  it("没有 custom_sections 的旧简历不出现自定义栏目页签（不为空栏目造键）", () => {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={makeResumeContent()}
          onClose={vi.fn()}
          onSave={vi.fn(async () => undefined)}
        />
      </AntdApp>,
    );
    expect(screen.queryByRole("tab", { name: "自定义栏目" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: CRED_TAB })).toBeInTheDocument();
  });
});
