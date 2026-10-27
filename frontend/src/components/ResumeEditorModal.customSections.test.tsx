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
import type { EditorSchemaOut } from "../features/profile-library/types";
import type { ProfileFillSources } from "../features/profile/profileFillOptions";
import { t } from "../i18n";
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
const CUSTOM_TAB = "自建板块";
const SAVE_BUTTON = /保存并更新预览/;
const CRED_TAB = "证书资质";
/** 通用编辑器的正文框 label（有字段定义时不该再出现）。 */
const CUSTOM_TEXT_LABEL = t("editor.custom-sections.text");

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

/**
 * 第 8 项（2026-10-27）：自建板块**有字段定义时**按定义渲染，与系统板块同一个录入方式。
 *
 * 绑定规则必须与后端纸面投影一致：主文本字段 → `entries[i].text`，其余字段按定义顺序 →
 * `lines[j].value`（`label` 冻结成定义 label）。字段 label 用 ASCII：这些是夹具，
 * 不是产品文案，别抬高 cjk 棘轮。
 */
const OSS_KEY = "custom:open-source";

const OSS_SCHEMA: EditorSchemaOut = {
  sections: [
    {
      section_key: OSS_KEY,
      section_name: "Open source",
      form: "multi",
      resume_field: "custom_sections",
      material_only: false,
      fields: [
        {
          field_id: "f.gist",
          key: "gist",
          label: "Gist",
          field_type: "multi_line",
          resume_attr: null,
          primary: true,
        },
        {
          field_id: "f.role",
          key: "role",
          label: "Role",
          field_type: "single_line",
          resume_attr: null,
        },
      ],
    },
  ],
  workspace_revision: 1,
};

/** 一份只含"自建板块"可见性的编辑器视图（页签按它生成）。 */
const OSS_FILL_SOURCES: ProfileFillSources = {
  education: [],
  experience: [],
  campusExperience: [],
  projects: [],
  skills: [],
  awards: [],
  summary: "",
  editorView: {
    sections: [
      { key: "basic_info", name: "Basic Info" },
      { key: OSS_KEY, name: "Open source" },
    ],
    schema: OSS_SCHEMA,
  },
};

/** 视图里给了自建板块名字时，页签就用那个名字（`resumeEditorTabs` 的口径）。 */
const OSS_TAB = "Open source";

async function openOssTab() {
  fireEvent.click(await screen.findByRole("tab", { name: OSS_TAB }));
  return screen.findByRole("tabpanel");
}

async function saveAndRead(onSave: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0] as ResumeContent;
}

describe("ResumeEditorModal · 自建板块按字段定义编辑", () => {
  it("有定义时渲染固定字段表单（不是「一段正文 + 自由标签行」）", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={contentWithOptionalSections()}
          onClose={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          fillSources={OSS_FILL_SOURCES}
        />
      </AntdApp>,
    );
    const panel = await openOssTab();
    // 主文本字段是多行 → textarea；其余字段各自一个单行输入框，label 就是定义 label。
    expect(within(panel).getByLabelText("Gist").tagName).toBe("TEXTAREA");
    expect(within(panel).getByLabelText("Role").tagName).toBe("INPUT");
    // 通用编辑器的「正文」框不再出现（同一份内容不能有两个入口）。
    expect(within(panel).queryByLabelText(CUSTOM_TEXT_LABEL)).not.toBeInTheDocument();
  });

  it("改主文本字段写 text，改其它字段写 lines[j].value 且 label 由定义钉住", async () => {
    const content = contentWithOptionalSections();
    // 已有历史行 label（角色）不在定义里 → 必须原样保留，见下一条用例。
    const onSave = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={content}
          onClose={vi.fn()}
          onSave={onSave}
          fillSources={OSS_FILL_SOURCES}
        />
      </AntdApp>,
    );
    const panel = await openOssTab();
    fireEvent.change(within(panel).getByLabelText("Gist"), { target: { value: "typed gist" } });
    fireEvent.change(within(panel).getByLabelText("Role"), { target: { value: "maintainer" } });

    const saved = await saveAndRead(onSave);
    const entry = saved.custom_sections?.[0].entries[0];
    expect(entry?.text).toBe("typed gist");
    expect(entry?.lines[0]).toEqual({ label: "Role", value: "maintainer" });
  });

  it("定义之外的历史行原样保留（字段被删 / 手加的行不丢数据）", async () => {
    const onSave = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={contentWithOptionalSections()}
          onClose={vi.fn()}
          onSave={onSave}
          fillSources={OSS_FILL_SOURCES}
        />
      </AntdApp>,
    );
    const panel = await openOssTab();
    // 历史行排在定义字段之后，仍以「标签 + 值」可编辑行出现。
    const legacyLabels = within(panel).getAllByLabelText(t("editor.custom-sections.label"));
    expect(legacyLabels).toHaveLength(1);
    expect((legacyLabels[0] as HTMLInputElement).value).toBe("角色");

    const saved = await saveAndRead(onSave);
    const lines = saved.custom_sections?.[0].entries[0].lines ?? [];
    expect(lines).toContainEqual({ label: "角色", value: "维护者" });
  });

  /**
   * QA 补充（2026-10-27）：控件数量必须与「定义字段数 + 历史行数」对得上——
   * 少一个说明有字段没渲染出来（用户填不了），多一个说明对齐补了幽灵行
   * （`Form.Item` 绑到不存在的下标会凭空多出 `{}`，见 customSectionAlignment.ts）。
   *
   * 历史行每行有两个控件（标签 + 值），所以总数 = 定义字段数 + 历史行数 × 2；
   * 板块标题输入框与 `Form.Item hidden` 的隐藏输入不计入。
   */
  it("输入控件数量 == 定义字段数 + 历史行数 × 2（不渲染幽灵行、不漏字段）", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={contentWithOptionalSections()}
          onClose={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          fillSources={OSS_FILL_SOURCES}
        />
      </AntdApp>,
    );
    const panel = await openOssTab();
    const titleInput = within(panel).getByLabelText(CUSTOM_TAB);
    const fields = OSS_SCHEMA.sections[0].fields;
    const historyRows = within(panel).getAllByLabelText(t("editor.custom-sections.label")).length;

    const textboxes = within(panel)
      .getAllByRole("textbox")
      .filter((el) => !el.closest(".ant-form-item-hidden") && el !== titleInput);

    // 每个定义字段恰好一个控件（主文本字段的多行控件也算一个）。
    for (const field of fields) {
      expect(within(panel).getAllByLabelText(field.label)).toHaveLength(1);
    }
    expect(textboxes).toHaveLength(fields.length + historyRows * 2);
    // 交叉校验：夹具里当前只有一条历史行，因此总数必须是 4。
    expect(historyRows).toBe(1);
    expect(textboxes).toHaveLength(4);
  });

  /** QA 补充（2026-10-27）：历史行不只是"显示得出来"，改值后要能真的存回 `lines`。 */
  it("历史行改值后仍能保存回 lines（不是只读占位）", async () => {
    const onSave = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={contentWithOptionalSections()}
          onClose={vi.fn()}
          onSave={onSave}
          fillSources={OSS_FILL_SOURCES}
        />
      </AntdApp>,
    );
    const panel = await openOssTab();
    const legacyValues = within(panel).getAllByLabelText(t("editor.custom-sections.value"));
    expect(legacyValues).toHaveLength(1);
    fireEvent.change(legacyValues[0], { target: { value: "typed by qa" } });

    const saved = await saveAndRead(onSave);
    const lines = saved.custom_sections?.[0].entries[0].lines ?? [];
    expect(lines).toContainEqual({ label: "角色", value: "typed by qa" });
    // 定义字段那一行不受影响（label 由定义钉住）。
    expect(lines).toContainEqual({ label: "Role", value: "" });
  });
});
