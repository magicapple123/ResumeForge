// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实区块：加载/空态/分组列表/新建/编辑/删除/409/加载失败/私密证号提示。
 *
 * 断言文案一律走 `t()`（中文断言行数受 cjkRatchet 守卫），实体名与状态值来自语言包。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import {
  DEFAULT_SECTION_ORDER,
  PROFILE_FACTS_SECTION_KEY,
} from "../../components/profile/ProfileSectionConfig";
import { t } from "../../i18n";
import { FACT_KIND_LABEL_KEYS } from "./constants";
import ProfileFactsSection from "./ProfileFactsSection";
import {
  CREDENTIAL_FACT,
  DEFAULT_SCHEMA,
  PRACTICE_FACT,
  PUBLICATION_FACT,
  RESEARCH_FACT,
  makeKindSchema,
  makeSchema,
} from "./testFixtures";
import type { ProfileFact } from "./types";

const apiMocks = vi.hoisted(() => ({
  listProfileFacts: vi.fn(),
  createProfileFact: vi.fn(),
  updateProfileFact: vi.fn(),
  deleteProfileFact: vi.fn(),
  getProfileFactSchema: vi.fn(),
  saveProfileFactKindSchema: vi.fn(),
  resetProfileFactKindSchema: vi.fn(),
  PROFILE_FACTS_PAGE_SIZE: 200,
}));

vi.mock("./api", () => apiMocks);

function renderSection() {
  return render(
    <AntdApp>
      <ProfileFactsSection />
    </AntdApp>,
  );
}

const CREDENTIAL_LABEL = t(FACT_KIND_LABEL_KEYS.credential);

function publicationLabelText() {
  return t(FACT_KIND_LABEL_KEYS.publication);
}

beforeEach(() => {
  apiMocks.listProfileFacts.mockReset().mockResolvedValue({ items: [], total: 0 });
  apiMocks.createProfileFact.mockReset().mockResolvedValue(PUBLICATION_FACT);
  apiMocks.updateProfileFact.mockReset().mockResolvedValue(PUBLICATION_FACT);
  apiMocks.deleteProfileFact.mockReset().mockResolvedValue({ deleted: true });
  apiMocks.getProfileFactSchema.mockReset().mockResolvedValue(DEFAULT_SCHEMA);
  apiMocks.saveProfileFactKindSchema.mockReset().mockResolvedValue(DEFAULT_SCHEMA);
  apiMocks.resetProfileFactKindSchema.mockReset().mockResolvedValue(DEFAULT_SCHEMA);
});

afterEach(() => {
  cleanup();
});

describe("补充事实区块：加载与空态", () => {
  it("首次加载显示块级加载态", async () => {
    apiMocks.listProfileFacts.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("没有事实时显示空态与新建入口", async () => {
    renderSection();
    expect(await screen.findByText(t("profileFacts.empty.description"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("profileFacts.empty.action") }),
    ).toBeInTheDocument();
  });

  it("加载失败显示可重试的错误态，不伪装成空态", async () => {
    apiMocks.listProfileFacts
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ items: [], total: 0 });
    renderSection();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("profileFacts.section.loadError", { detail: "boom" }));
    fireEvent.click(within(alert).getByRole("button"));
    expect(await screen.findByText(t("profileFacts.empty.description"))).toBeInTheDocument();
  });
});

describe("补充事实区块：分组列表", () => {
  it("按九类分组展示标题、副标题与状态徽标", async () => {
    apiMocks.listProfileFacts.mockResolvedValue({
      items: [PUBLICATION_FACT, CREDENTIAL_FACT, RESEARCH_FACT, PRACTICE_FACT],
      total: 4,
    });
    renderSection();
    expect(await screen.findByText(PUBLICATION_FACT.payload.title)).toBeInTheDocument();
    expect(screen.getByText(t(FACT_KIND_LABEL_KEYS.publication))).toBeInTheDocument();
    expect(screen.getByText(t(FACT_KIND_LABEL_KEYS.credential))).toBeInTheDocument();
    // 副标题只拼已有值：期刊 · 年份 / 颁发机构。
    expect(screen.getByText("Example Conference · 2025")).toBeInTheDocument();
    expect(screen.getByText("Example Health Commission")).toBeInTheDocument();
    // 状态徽标：在投不是已发表，资格状态由用户填写。
    expect(screen.getByText(t("research.status.under_review"))).toBeInTheDocument();
    expect(screen.getByText(t("profileFacts.credentialStatus.active"))).toBeInTheDocument();
    expect(screen.getByText(t("profileFacts.experienceKind.volunteer"))).toBeInTheDocument();
  });

  it("组内保持服务端返回的 sort_order 顺序，不按标题或时间重排", async () => {
    const secondListed: ProfileFact = {
      ...PUBLICATION_FACT,
      fact_id: "fact_pub_late",
      payload: { ...PUBLICATION_FACT.payload, title: "Second listed paper" },
      sort_order: 9,
    };
    const firstListed: ProfileFact = {
      ...PUBLICATION_FACT,
      fact_id: "fact_pub_early",
      payload: { ...PUBLICATION_FACT.payload, title: "First listed paper" },
      sort_order: 2,
    };
    apiMocks.listProfileFacts.mockResolvedValue({
      items: [secondListed, firstListed],
      total: 2,
    });
    renderSection();
    await screen.findByText("Second listed paper");
    // 按标题自身的 DOM 顺序判断：不依赖 Listy 的内部行类名。
    const titles = screen.getAllByText(/listed paper/).map((node) => node.textContent ?? "");
    expect(titles).toEqual(["Second listed paper", "First listed paper"]);
  });
});

describe("补充事实区块：新建与编辑", () => {
  it("空态入口新建论文：保存完整 payload，保存成功后关闭编辑器并重载列表", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: t("profileFacts.empty.action") }));
    expect(
      await screen.findByText(
        t("profileFacts.editor.createTitle", { label: publicationLabelText() }),
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t("research.publications.title")), {
      target: { value: "A new paper" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("profileFacts.editor.save.publication") }),
    );
    await waitFor(() => expect(apiMocks.createProfileFact).toHaveBeenCalledTimes(1));
    const created = apiMocks.createProfileFact.mock.calls[0][0];
    expect(created).toMatchObject({
      kind: "publication",
      sort_order: 1,
      payload: { title: "A new paper", status: "other", authors: [] },
    });
    await waitFor(() => expect(apiMocks.listProfileFacts).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(t("profileFacts.toast.saved", { label: publicationLabelText() })),
    ).toBeInTheDocument();
  });

  it("编辑已有事实：回填后保存带 expected_revision", async () => {
    apiMocks.listProfileFacts.mockResolvedValue({ items: [PUBLICATION_FACT], total: 1 });
    renderSection();
    const editButton = await screen.findByRole("button", {
      name: t("profileFacts.list.editAria", {
        label: publicationLabelText(),
        title: PUBLICATION_FACT.payload.title,
      }),
    });
    fireEvent.click(editButton);
    expect(
      await screen.findByText(
        t("profileFacts.editor.editTitle", { label: publicationLabelText() }),
      ),
    ).toBeInTheDocument();
    const titleInput = screen.getByLabelText(t("research.publications.title"));
    expect(titleInput).toHaveValue(PUBLICATION_FACT.payload.title);
    fireEvent.change(titleInput, { target: { value: "Updated paper title" } });
    fireEvent.click(
      screen.getByRole("button", { name: t("profileFacts.editor.save.publication") }),
    );
    await waitFor(() =>
      expect(apiMocks.updateProfileFact).toHaveBeenCalledWith(PUBLICATION_FACT.fact_id, {
        payload: expect.objectContaining({ title: "Updated paper title" }),
        expected_revision: PUBLICATION_FACT.revision,
      }),
    );
  });

  it("论文作者可增删并调整顺序：保存时顺序即提交顺序", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: t("profileFacts.empty.action") }));
    fireEvent.change(screen.getByLabelText(t("research.publications.title")), {
      target: { value: "Ordered authors" },
    });
    const unit = t("profileFacts.people.authorUnit");
    // 图标会进入按钮的可访问名（antd 图标带 aria-label），用正则匹配文字部分。
    const addAuthor = screen.getByRole("button", {
      name: new RegExp(t("research.authors.add")),
    });
    fireEvent.click(addAuthor);
    fireEvent.change(screen.getByLabelText(t("profileFacts.people.nameAria", { index: 1, unit })), {
      target: { value: "First Person" },
    });
    fireEvent.click(addAuthor);
    fireEvent.change(screen.getByLabelText(t("profileFacts.people.nameAria", { index: 2, unit })), {
      target: { value: "Second Person" },
    });
    fireEvent.click(screen.getAllByRole("checkbox", { name: t("research.authors.self") })[0]);
    fireEvent.click(
      screen.getByRole("button", { name: t("profileFacts.people.moveUpAria", { index: 2, unit }) }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("profileFacts.editor.save.publication") }),
    );
    await waitFor(() => expect(apiMocks.createProfileFact).toHaveBeenCalledTimes(1));
    expect(apiMocks.createProfileFact.mock.calls[0][0].payload.authors).toEqual([
      { name: "Second Person", is_self: false, corresponding: false },
      { name: "First Person", is_self: true, corresponding: false },
    ]);
  });

  it("409 版本冲突提示刷新后再编辑，不静默覆盖", async () => {
    apiMocks.listProfileFacts.mockResolvedValue({ items: [PUBLICATION_FACT], total: 1 });
    apiMocks.updateProfileFact.mockRejectedValue(
      new ApiError("conflict", 409, { businessCode: "profile_fact_revision_conflict" }),
    );
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("profileFacts.list.editAria", {
          label: publicationLabelText(),
          title: PUBLICATION_FACT.payload.title,
        }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("profileFacts.editor.save.publication") }),
    );
    expect(await screen.findByText(t("profileFacts.editor.conflict"))).toBeInTheDocument();
    // antd 会给两个汉字的按钮插入空格（「刷新」→「刷 新」），与项目既有 /重\s*试/ 写法一致。
    fireEvent.click(screen.getByRole("button", { name: /刷\s*新/ }));
    await waitFor(() => expect(apiMocks.listProfileFacts).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(t("profileFacts.editor.conflict"))).not.toBeInTheDocument();
  });
});

describe("补充事实区块：删除与私密字段", () => {
  it("删除是软删：调用删除接口、提示移入回收站并重载列表", async () => {
    apiMocks.listProfileFacts.mockResolvedValue({ items: [PUBLICATION_FACT], total: 1 });
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("profileFacts.list.deleteAria", {
          label: publicationLabelText(),
          title: PUBLICATION_FACT.payload.title,
        }),
      }),
    );
    await waitFor(() =>
      expect(apiMocks.deleteProfileFact).toHaveBeenCalledWith(PUBLICATION_FACT.fact_id),
    );
    expect(
      await screen.findByText(t("profileFacts.toast.deleted", { label: publicationLabelText() })),
    ).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.listProfileFacts).toHaveBeenCalledTimes(2));
  });

  it("资格证照的证号用密码框，并常驻私密提示", async () => {
    apiMocks.listProfileFacts.mockResolvedValue({ items: [CREDENTIAL_FACT], total: 1 });
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("profileFacts.list.editAria", {
          label: CREDENTIAL_LABEL,
          title: CREDENTIAL_FACT.payload.name,
        }),
      }),
    );
    expect(await screen.findByText(t("profileFacts.credential.numberHint"))).toBeInTheDocument();
    const numberInput = screen.getByLabelText(t("profileFacts.credential.number"));
    expect(numberInput).toHaveAttribute("type", "password");
    expect(numberInput).toHaveValue(CREDENTIAL_FACT.payload.credential_number);
  });
});

describe("补充事实区块：字段设置", () => {
  it("打开「编辑字段」并保存：提交 hidden_fields/custom_fields 与 expected_revision", async () => {
    apiMocks.listProfileFacts.mockResolvedValue({ items: [PUBLICATION_FACT], total: 1 });
    const schema = makeSchema({ publication: { hidden_fields: ["year"], revision: 3 } });
    apiMocks.getProfileFactSchema.mockResolvedValue(schema);
    apiMocks.saveProfileFactKindSchema.mockResolvedValue(schema);
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("profileFacts.settings.open")) }),
    );
    expect(await screen.findByText(t("profileFacts.settings.defaultFields"))).toBeInTheDocument();
    // 年份当前被隐藏（未勾选）；勾上表示重新可见，保存时 hidden_fields 应清空。
    fireEvent.click(screen.getByRole("checkbox", { name: t("research.publications.year") }));
    fireEvent.click(screen.getByRole("button", { name: t("profileFacts.settings.save") }));
    await waitFor(() => expect(apiMocks.saveProfileFactKindSchema).toHaveBeenCalledTimes(1));
    const [kind, body] = apiMocks.saveProfileFactKindSchema.mock.calls[0];
    expect(kind).toBe("publication");
    expect(body.expected_revision).toBe(3);
    expect(body.hidden_fields).toEqual([]);
    expect(body.custom_fields).toEqual([]);
  });

  it("保存返回单类 schema 时归一化，恢复默认后 revision 继续前进", async () => {
    apiMocks.listProfileFacts.mockResolvedValue({ items: [PUBLICATION_FACT], total: 1 });
    apiMocks.getProfileFactSchema.mockResolvedValue(makeSchema());
    apiMocks.saveProfileFactKindSchema.mockResolvedValue(
      makeKindSchema("publication", { revision: 4 }),
    );
    apiMocks.resetProfileFactKindSchema.mockResolvedValue(
      makeKindSchema("publication", { revision: 5 }),
    );
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("profileFacts.settings.open")) }),
    );
    fireEvent.click(await screen.findByRole("button", { name: t("profileFacts.settings.save") }));
    expect(
      await screen.findByText(t("profileFacts.settings.revision", { revision: 4 })),
    ).toBeInTheDocument();
    // 恢复默认（内联确认）后 revision 5。成功 Toast 也是 role=alert，
    // 所以按确认标题定位那条 Alert，而不是笼统 getByRole("alert")。
    fireEvent.click(screen.getByRole("button", { name: t("profileFacts.settings.reset") }));
    const confirmTitle = await screen.findByText(
      t("profileFacts.settings.resetConfirmTitle", {
        label: t("profileFacts.kind.publication"),
      }),
    );
    const confirmAlert = confirmTitle.closest('[role="alert"]') as HTMLElement;
    fireEvent.click(
      within(confirmAlert).getByRole("button", {
        name: t("profileFacts.settings.resetConfirm"),
      }),
    );
    expect(
      await screen.findByText(t("profileFacts.settings.revision", { revision: 5 })),
    ).toBeInTheDocument();
  });

  it("字段设置接口失败时按默认字段降级显示事实，并给可重试提示", async () => {
    apiMocks.listProfileFacts.mockResolvedValue({ items: [PUBLICATION_FACT], total: 1 });
    apiMocks.getProfileFactSchema.mockRejectedValue(new Error("schema boom"));
    renderSection();
    expect(await screen.findByText(PUBLICATION_FACT.payload.title)).toBeInTheDocument();
    expect(
      screen.getByText(t("profileFacts.section.schemaWarning", { detail: "schema boom" })),
    ).toBeInTheDocument();
  });
});

describe("补充事实区块：分区注册", () => {
  it("不是旧资料分区，不进可拖拽排序栈", () => {
    expect(DEFAULT_SECTION_ORDER).not.toContain(PROFILE_FACTS_SECTION_KEY);
  });
});
