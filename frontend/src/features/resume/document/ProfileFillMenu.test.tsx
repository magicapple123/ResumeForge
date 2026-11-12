// SPDX-License-Identifier: Apache-2.0
/** 「从资料填入」菜单（v2）：候选 → 单一 helper 合并、source 去重、selectedPath 失配禁用。 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { makeEntry, makeResumeDocument } from "../../../test/documentHarness";
import type { PaperProjectionOut } from "../../profile/library/types";
import type { ResumeDocument, ResumeEntry, ResumeItem } from "../../../types/resumeDocument";
import ProfileFillMenu from "./ProfileFillMenu";

const api = vi.hoisted(() => ({ getCurrentProjection: vi.fn() }));
vi.mock("../../profile/library/api", () => api);

declare const process: { cwd(): string };

const SOURCE = { section_key: "educations", field_id: "educations.school" };
const SCHOOL: ResumeItem = {
  kind: "field",
  id: "it_school00001",
  key: "school",
  label: "",
  value: "示例大学",
  placement: "title",
  format: "text",
  wrap: "none",
  show_label: false,
  solo: false,
  source: SOURCE,
  body_style: "bullet",
};
const MAJOR: ResumeItem = {
  ...SCHOOL,
  id: "it_major00001",
  key: "major",
  value: "软件工程",
  source: { ...SOURCE, field_id: "educations.major" },
};
const EDU_ENTRY: ResumeEntry = makeEntry([SCHOOL, MAJOR], { id: "ob_edu000001" });
const PRJ_ENTRY: ResumeEntry = makeEntry(
  [
    {
      ...SCHOOL,
      id: "it_prjname0001",
      key: "name",
      value: "别的项目",
      source: { section_key: "projects", field_id: "projects.name" },
    },
  ],
  { id: "ob_prj000001" },
);

const WORKING: ResumeDocument = makeResumeDocument({
  sections: [
    {
      key: "education",
      title: "",
      kind: "entries",
      layout: {} as never,
      entries: [makeEntry([], { id: "ob_edu000001" })],
    },
  ],
});

function projection(): PaperProjectionOut {
  return {
    scope: {
      group_id: "g",
      group_name: "默认",
      is_default: true,
      participating_keys: ["educations", "projects"],
      section_order: ["education", "projects"],
      workspace_revision: 1,
    },
    content: {
      version: 2,
      language: "zh-CN",
      header: { items: [] },
      sections: [
        { key: "education", title: "", kind: "entries", layout: {} as never, entries: [EDU_ENTRY] },
        { key: "projects", title: "", kind: "entries", layout: {} as never, entries: [PRJ_ENTRY] },
      ],
    },
    candidates: [
      {
        section_key: "educations",
        section_name: "教育经历",
        entry_id: "e1",
        title: "示例大学",
        subtitle: "软件工程",
        document_path: "education.ob_edu000001",
        document_entry: EDU_ENTRY,
      },
      {
        section_key: "projects",
        section_name: "项目经历",
        entry_id: "e2",
        title: "别的项目",
        subtitle: "",
        document_path: "projects.ob_prj000001",
        document_entry: PRJ_ENTRY,
      },
    ],
    source_layout: [],
    warnings: [],
    snapshot_token: "t",
  } as unknown as PaperProjectionOut;
}

function setup(document: ResumeDocument = WORKING, selectedPath: string | null = null) {
  api.getCurrentProjection.mockResolvedValue(projection());
  const onChange = vi.fn();
  render(
    <AntdApp>
      <ProfileFillMenu document={document} onChange={onChange} selectedPath={selectedPath} />
    </AntdApp>,
  );
  fireEvent.click(screen.getByRole("button", { name: t("editor.profileFill.aria.entry") }));
  return { onChange };
}

afterEach(() => {
  cleanup();
  api.getCurrentProjection.mockReset();
});

describe("ProfileFillMenu", () => {
  it("选择同分区资料候选：按单一 helper 合并 v2 items 并带 source", async () => {
    const { onChange } = setup();
    fireEvent.click(await screen.findByText("示例大学 · 软件工程"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const items = (onChange.mock.calls[0][0] as ResumeDocument).sections[0].entries[0].items;
    const school = items.find((item) => item.kind === "field" && item.key === "school");
    expect(school && school.kind === "field" && school.placement).toBe("title");
    expect(school && school.kind === "field" && school.source?.field_id).toBe("educations.school");
  });

  it("同一 source 已在条目里：不重复灌入该字段，其余缺的字段照常补", async () => {
    const withSchool = makeResumeDocument({
      sections: [
        {
          key: "education",
          title: "",
          kind: "entries",
          layout: {} as never,
          entries: [makeEntry([SCHOOL], { id: "ob_edu000001" })],
        },
      ],
    });
    const { onChange } = setup(withSchool);
    fireEvent.click(await screen.findByText("示例大学 · 软件工程"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const items = (onChange.mock.calls[0][0] as ResumeDocument).sections[0].entries[0].items;
    const schools = items.filter(
      (item) => item.kind === "field" && item.source?.field_id === "educations.school",
    );
    expect(schools).toHaveLength(1);
    expect(items.length).toBeGreaterThan(1);
  });

  it("selectedPath 指向某个条目：菜单只列该条目的候选（不再摆全量 disabled）", async () => {
    const { onChange } = setup(WORKING, "education.ob_edu000001.it_school00001");
    // 有目标：只留下填得进这个条目的那一条，别的板块的候选根本不渲染。
    await screen.findByTitle("示例大学 · 软件工程");
    // 用 title 定位候选（`*ByText` 里不写中文：cjkRatchet 的 tests 口径）。
    expect(screen.queryByTitle(/别的项目/)).toBeNull();
    fireEvent.click(screen.getByText("示例大学 · 软件工程"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });

  it("有目标时按钮文案带目标条目名，且候选单行省略带 title", async () => {
    // 目标条目里有标题字段 → 按钮读作「填入「示例大学」」。
    const withSchool = makeResumeDocument({
      sections: [
        {
          key: "education",
          title: "",
          kind: "entries",
          layout: {} as never,
          entries: [makeEntry([SCHOOL], { id: "ob_edu000001" })],
        },
      ],
    });
    setup(withSchool, "education.ob_edu000001");
    const button = screen.getByRole("button", { name: t("editor.profileFill.aria.entry") });
    expect(button.textContent).toContain(
      t("editor.profileFill.title.fillTarget", { title: "示例大学" }),
    );
    const option = await screen.findByTitle("示例大学 · 软件工程");
    expect(option.className).toContain("rf-profile-fill-option");
    cleanup();
    // 没有目标时是「添加」语义。
    setup();
    expect(
      screen.getByRole("button", { name: t("editor.profileFill.aria.entry") }).textContent,
    ).toContain(t("editor.profileFill.title.add"));
  });

  it("过滤后为空：给一行说明而不是空菜单", async () => {
    setup(WORKING, "education.ob_nomatch001");
    expect(await screen.findByText(t("editor.profileFill.emptyTarget"))).toBeInTheDocument();
  });

  it("#22：输入关键字过滤候选（菜单项变少），清空后恢复全量", async () => {
    setup();
    const search = await screen.findByPlaceholderText(t("editor.profileFill.search"));
    // 全量：两个板块各一条。
    expect(await screen.findByTitle("示例大学 · 软件工程")).toBeInTheDocument();
    expect(screen.getByTitle("别的项目")).toBeInTheDocument();
    // 过滤：只剩「别的项目」，教育那条不渲染。
    fireEvent.change(search, { target: { value: "别的" } });
    expect(await screen.findByTitle("别的项目")).toBeInTheDocument();
    expect(screen.queryByTitle(/示例大学/)).toBeNull();
    // 清空（allowClear 置空）：全量回来。
    fireEvent.change(search, { target: { value: "" } });
    expect(await screen.findByTitle("示例大学 · 软件工程")).toBeInTheDocument();
    expect(screen.getByTitle("别的项目")).toBeInTheDocument();
  });

  it("#22：过滤后的候选仍可点选填入（搜索框事件拦截不影响正常选择）", async () => {
    const { onChange } = setup();
    const search = await screen.findByPlaceholderText(t("editor.profileFill.search"));
    fireEvent.change(search, { target: { value: "别的" } });
    fireEvent.click(await screen.findByTitle("别的项目"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });

  it("问题 5：搜索框与计数行在固定头部里，不在滚动列表内", async () => {
    setup();
    const search = await screen.findByPlaceholderText(t("editor.profileFill.search"));
    const head = search.closest(".rf-profile-fill-head");
    expect(head).not.toBeNull();
    // 头部必须装下「N 项可添加」计数。
    expect(head?.querySelector(".rf-profile-fill-count-text")).not.toBeNull();
    // 滚动列表里不能再有输入框（否则它会跟着候选滚走——就是本来的缺陷）。
    const list = document.querySelector(".rf-profile-fill-list");
    expect(list).not.toBeNull();
    expect(list?.querySelector("input")).toBeNull();
    // 顺序：头部在列表之前（视觉上才是"固定头部 + 下面滚动"）。
    const shell = document.querySelector(".rf-profile-fill-shell");
    const children = Array.from(shell?.children ?? []);
    expect(children.indexOf(head as Element)).toBeLessThan(children.indexOf(list as Element));
  });

  it("问题 5：列表自己的滚动容器 + 分组标题 top 不再硬编码", () => {
    // jsdom 不求值布局，只能读 CSS 原文（先例：styles/input-focus-ring.test.ts）。
    const source = readFileSync(
      [process.cwd(), "src", "features", "resume", "document", "profile-fill-menu.css"].join("/"),
      "utf8",
    );
    const listRule = /\.rf-profile-fill-list\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(listRule).toContain("overflow-y: auto");
    expect(listRule).toContain("min-height: 0");
    // 分组标题：吸附参照系换成列表容器，`top` 归零，不能再有 58 / 30 这类魔法数字。
    const titleRule =
      /\.rf-profile-fill-menu \.ant-dropdown-menu-item-group-title\s*\{([^}]*)\}/.exec(
        source,
      )?.[1] ?? "";
    expect(titleRule).toContain("top: 0");
    expect(source).not.toContain("top: 58px");
    expect(source).not.toContain("top: 30px");
  });
});
