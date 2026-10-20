// SPDX-License-Identifier: Apache-2.0
/**
 * 「网申资料」域：给网申填表用的补充资料，与简历资料分开存。
 *
 * 2026-10-13（PR-18）：按 ProfilePage.test.tsx 既有豁免的触发条件（>800 行）从
 * 该文件拆出——本文件只守「网申资料」这个域；通用页面行为（通用简历/分页/
 * 未保存防护/折叠/悬浮球卡/输入性能）仍在 ProfilePage.test.tsx。
 *
 * 这里守两件事：它能在这儿编辑保存；以及它**不进**可拖拽排序的分区栈——后端按
 * `PROFILE_SECTION_KEYS` 归一化 `section_order`，不认识的键会被**静默丢弃**，
 * 混进去会让分区顺序看起来莫名其妙地变了（`ProfileSectionConfig` 里有同款说明）。
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECTION_ORDER } from "../components/profile/ProfileSectionConfig";
import { getProfileSaveControl } from "../features/tou-tou/profileSaveBridge";
import {
  cleanupProfilePage,
  openWebFormTab,
  renderProfilePage,
  resetProfileApiMocks,
} from "../test/profilePageHarness";

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

beforeEach(() => {
  resetProfileApiMocks(apiMocks);
});

afterEach(() => {
  cleanupProfilePage();
});

describe("ProfilePage 「网申资料」", () => {
  it("渲染出「网申资料」区块，并说明它不进简历", async () => {
    renderProfilePage();

    await openWebFormTab();
    expect(screen.getByText("这一区只给「网申填表」用，不会进入简历")).toBeInTheDocument();
  });

  it("查看态只显示已填的项，不铺一屏空标签", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        {
          key: "cet6_score",
          label: "英语六级分数",
          group: "语言与证书",
          kind: "text",
          sensitive: false,
        },
        { key: "student_id", label: "学号", group: "学籍与档案", kind: "text", sensitive: false },
      ],
      groups: ["语言与证书", "学籍与档案"],
      values: { cet6_score: "512" },
    });
    renderProfilePage();
    await openWebFormTab();

    // 填过的那条显示出来。
    expect(await screen.findByText("512")).toBeInTheDocument();
    // 整组都空的分区不渲染（否则一屏空标题，用户找不到自己填过什么）。
    expect(screen.queryByText("学籍与档案")).not.toBeInTheDocument();
    expect(screen.queryByText("学号")).not.toBeInTheDocument();
  });

  it("敏感项不显示「只存本机」标签", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        { key: "height", label: "身高(cm)", group: "身体情况", kind: "text", sensitive: true },
      ],
      groups: ["身体情况"],
      values: { height: "178" },
    });
    renderProfilePage();
    await openWebFormTab();

    expect(await screen.findByText("身高(cm)")).toBeInTheDocument();
    expect(screen.queryByText("只存本机", { exact: true })).not.toBeInTheDocument();
  });

  it("编辑态所有字段都可输入（含空的那些）", async () => {
    renderProfilePage();
    await openWebFormTab();

    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    // 编辑态才铺出全部输入框——查看态看不到空字段。
    expect(await screen.findByLabelText("英语六级分数")).toBeInTheDocument();
    expect(screen.getByLabelText("身高(cm)")).toBeInTheDocument();
  });

  it("简历资料校验失败时不提交网申资料，页面停在编辑态并给出提示", async () => {
    // 回归（用户实测）：简历资料必填项为空（校验不过）时，旧实现仍继续提交网申
    // 资料——用户看到"保存成功"、页面却停在编辑态，而简历资料的改动其实没存上。
    // 现在的语义：两次都成功才算保存；简历资料 invalid 时网申资料不提交。
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });

    // 清空必填的「姓名」制造校验失败（antd 会把错误标在字段上）。
    fireEvent.click(screen.getByRole("tab", { name: "简历资料" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() => expect(apiMocks.saveProfile).not.toHaveBeenCalled());
    expect(apiMocks.updateWebFormExtraProfile).not.toHaveBeenCalled();
    // 页面仍在编辑态（未退出编辑），并给出"先补全必填项"的提示。
    expect(screen.getByRole("button", { name: /保存全部资料/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消/ })).toBeInTheDocument();
    expect(await screen.findByText(/请先补全简历资料里的必填项/)).toBeInTheDocument();
  });

  it("全部合法时保存成功并退出编辑态", async () => {
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() => expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalled());
    // 已退出编辑态：页头回到「编辑资料」。
    expect(await screen.findByRole("button", { name: /编辑资料/ })).toBeInTheDocument();
  });

  it("保存全部资料时，网申资料也跟着存一次", async () => {
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    const input = await screen.findByLabelText("英语六级分数");
    fireEvent.change(input, { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      // 第二个参数是每条的来源与档位——保存时一起提交，用户在界面上改的档位才会生效。
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { cet6_score: "512" },
        {},
        {},
      ),
    );
  });

  it("编辑态可以新增自定义网申字段并随资料一起保存", async () => {
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.change(screen.getByLabelText("英语六级分数"), { target: { value: "512" } });

    fireEvent.change(screen.getByLabelText("新增自定义网申字段名称"), {
      target: { value: "实验室" },
    });
    const customFieldControls = screen
      .getByLabelText("新增自定义网申字段名称")
      .closest(".ant-space-compact");
    expect(customFieldControls).not.toBeNull();
    fireEvent.click(
      within(customFieldControls as HTMLElement).getByRole("button", { name: /添加/ }),
    );

    const customValue = await screen.findByLabelText("实验室");
    fireEvent.change(customValue, { target: { value: "智能计算实验室" } });
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { cet6_score: "512", CUSTOM_实验室: "智能计算实验室" },
        {
          CUSTOM_实验室: {
            value: "",
            source: "manual",
            reuse: "general",
            label: "实验室",
          },
        },
        {},
      ),
    );
  });

  it("编辑态可以修改自定义字段名并保留原值", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        {
          key: "CUSTOM_实验室",
          label: "实验室",
          group: "自定义",
          kind: "text",
          sensitive: false,
          matchable: true,
        },
      ],
      groups: ["自定义"],
      values: { CUSTOM_实验室: "智能计算实验室" },
      details: {
        CUSTOM_实验室: {
          value: "智能计算实验室",
          source: "manual",
          reuse: "general",
          label: "实验室",
        },
      },
    });
    renderProfilePage();
    await openWebFormTab();
    await screen.findByText("实验室");
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.click(screen.getByRole("button", { name: "修改字段名：实验室" }));
    const renameInput = screen.getByRole("textbox", { name: "编辑字段名：实验室" });
    fireEvent.change(renameInput, { target: { value: "导师姓名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存字段名" }));
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { CUSTOM_实验室: "智能计算实验室" },
        {
          CUSTOM_实验室: {
            value: "智能计算实验室",
            source: "manual",
            reuse: "general",
            label: "导师姓名",
          },
        },
        {},
      ),
    );
  });

  it("删除自定义字段后不会再提交它", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        {
          key: "CUSTOM_实验室",
          label: "实验室",
          group: "自定义",
          kind: "text",
          sensitive: false,
          matchable: true,
        },
      ],
      groups: ["自定义"],
      values: { CUSTOM_实验室: "智能计算实验室" },
      details: {
        CUSTOM_实验室: {
          value: "智能计算实验室",
          source: "manual",
          reuse: "general",
          label: "实验室",
        },
      },
    });
    renderProfilePage();
    await openWebFormTab();
    await screen.findByText("实验室");
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除自定义字段：实验室" }));
    fireEvent.click(screen.getByRole("button", { name: /确\s*定/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith({}, {}, {}),
    );
  });

  it("可新增多条教育补充记录，删除后按剩余顺序保存", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [],
      groups: [],
      values: {},
      repeated_groups: [
        {
          key: "education",
          label: "教育经历补充",
          family: "education",
          fields: [
            {
              key: "education_class_rank",
              label: "班级排名",
              kind: "text",
              sensitive: false,
            },
          ],
          records: [],
        },
      ],
    });
    apiMocks.updateWebFormExtraProfile.mockResolvedValue({
      fields: [],
      groups: [],
      values: {},
      repeated_groups: [],
    });
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.click(screen.getByRole("button", { name: "新增教育经历补充" }));
    fireEvent.change(await screen.findByLabelText("教育经历补充第1条班级排名"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增教育经历补充" }));
    fireEvent.change(screen.getByLabelText("教育经历补充第2条班级排名"), {
      target: { value: "1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "删除教育经历补充第1条" }));
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        {},
        {},
        {
          education: [
            {
              id: undefined,
              values: { education_class_rank: "1" },
            },
          ],
        },
      ),
    );
  });

  it("新增自定义字段不会冲掉还没保存的多条记录", async () => {
    // 新增自定义字段会让 WebFormProfileSection 再走一次 onLoaded，而那次带回的
    // repeated_groups 是进入页面时的旧值。照它回填会把用户刚编辑、还没保存的多条记录
    // 改回去（那段代码自己的注释说的是"必须保留用户刚输入、尚未保存的值"）。
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [],
      groups: [],
      values: {},
      repeated_groups: [
        {
          key: "education",
          label: "教育经历补充",
          family: "education",
          fields: [
            { key: "education_class_rank", label: "班级排名", kind: "text", sensitive: false },
          ],
          records: [{ id: 1, values: { education_class_rank: "旧排名" } }],
        },
      ],
    });
    apiMocks.updateWebFormExtraProfile.mockResolvedValue({
      fields: [],
      groups: [],
      values: {},
      repeated_groups: [],
    });
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.change(await screen.findByLabelText("教育经历补充第1条班级排名"), {
      target: { value: "新排名" },
    });
    fireEvent.change(screen.getByLabelText("新增自定义网申字段名称"), {
      target: { value: "实验室" },
    });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { CUSTOM_实验室: "" },
        {
          CUSTOM_实验室: { value: "", source: "manual", reuse: "general", label: "实验室" },
        },
        { education: [{ id: 1, values: { education_class_rank: "新排名" } }] },
      ),
    );
  });

  it("先点编辑资料、之后才打开网申资料，取消一次后仍能正常提交", async () => {
    // 目录是懒加载的：在「简历资料」tab 点「编辑资料」时页面还没有目录。若照"进入编辑时"的
    // 快照回滚目录，就会把已经加载好的目录清成 null——之后再点「保存全部资料」，整份网申资料
    // 都不会提交（界面上却毫无提示）。
    renderProfilePage();
    // 加载态只有骨架屏，页头按钮要等资料取回来才出现。
    fireEvent.click(await screen.findByRole("button", { name: /编辑资料/ }));
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    const input = await within(screen.getByRole("tabpanel")).findByLabelText("英语六级分数");
    fireEvent.change(input, { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { cet6_score: "512" },
        {},
        {},
      ),
    );
  });

  it("「网申资料」不进可拖拽排序的分区栈", () => {
    // 后端会丢掉它不认识的 section_order 键，混进排序栈会让分区顺序莫名其妙地变。
    // 所以它必须留在 DEFAULT_SECTION_ORDER 与 ProfileSectionKey 的排序白名单之外。
    expect(DEFAULT_SECTION_ORDER).not.toContain("web_form_profile");
  });

  it("编辑置脏时挂上悬浮球保存桥，保存成功后收起", async () => {
    // 桥（features/tou-tou/profileSaveBridge）是投投悬浮球「保存资料/取消」的页面侧接线：
    // 页面表单脏时挂上控制块（onSave/onCancel 复用顶部保存条的同一套逻辑），
    // 两次保存都成功、dirty 翻回 false 后自动收起。
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });

    await waitFor(() => expect(getProfileSaveControl()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));
    await waitFor(() => expect(getProfileSaveControl()).toBeNull());
    expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalled();
  });
});
