// SPDX-License-Identifier: Apache-2.0
/**
 * 从资料生成草稿弹窗：主操作随阶段切换（生成 → 保存）、空态只在「生成过且 0 条」时出现、
 * 重新生成前必须确认。这三条都是"结构改了但行为没断言"就会悄悄退化的地方。
 *
 * 这个组件此前零覆盖，本文件只钉这些**界面契约**；`generate()` / `save()` 的请求形状与
 * 错误提示仍由组件自身逐字保留，不在这里重复断言。
 *
 * 断言文案一律走 `t()`：测试里的中文也属于以后要迁移的存量文案，不写第二份字面量。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { emptyClaim } from "../../types";
import type { ClaimPayload } from "../../types";
import { makeEntry, makeWorkspace } from "../../test/profileWorkspaceFixture";
import ClaimDraftModal from "./ClaimDraftModal";

const apiMocks = vi.hoisted(() => ({
  draftClaims: vi.fn(),
  createClaim: vi.fn(),
}));

// 展开真实模块再覆盖：生产代码新增一个导出时，显式列举的 mock 会让调用方直接崩。
vi.mock("../../api/claims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/claims")>()),
  ...apiMocks,
}));

const profileMocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
}));

vi.mock("../../features/profile-library/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/profile-library/api")>()),
  ...profileMocks,
}));

const ENTRY_A = "a1".repeat(12);
const ENTRY_B = "b2".repeat(12);

/** 一条可选的资料条目：字段用 fixture 的通用单行字段（experiences.title）。 */
function workspaceWithEntries() {
  return makeWorkspace({
    entries: [
      makeEntry("experiences", ENTRY_A, { "experiences.title": "Acme backend intern" }, 0),
      makeEntry("experiences", ENTRY_B, { "experiences.title": "Beta analytics intern" }, 1),
    ],
  });
}

/** antd 会给两个汉字的按钮文案中间插一个空格（「取 消」）；断言按空白容忍。 */
function labelPattern(label: string): RegExp {
  return new RegExp(Array.from(label).join("\\s*"));
}

function draft(title: string): ClaimPayload {
  return { ...emptyClaim(), title };
}

function renderModal() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <AntdApp>
      <ClaimDraftModal open onClose={onClose} onSaved={onSaved} />
    </AntdApp>,
  );
  return { onClose, onSaved };
}

/** footer 是主操作的唯一落点：单独取出来，避免正文里的同名按钮混进断言。 */
function footer(): ReturnType<typeof within> {
  const node = document.querySelector(".ant-modal-footer");
  if (!(node instanceof HTMLElement)) throw new Error("modal footer not found");
  return within(node);
}

function generateButton() {
  return screen.getByRole("button", {
    name: labelPattern(t("claimDraftModal.action.generate")),
  });
}

function pasteAndGenerate(text = "负责门店排班与库存盘点") {
  fireEvent.change(screen.getByPlaceholderText(t("claimDraftModal.placeholder.rawText")), {
    target: { value: text },
  });
  fireEvent.click(generateButton());
}

beforeEach(() => {
  apiMocks.draftClaims.mockReset();
  apiMocks.createClaim.mockReset();
  profileMocks.getWorkspace.mockReset();
  profileMocks.getWorkspace.mockResolvedValue(workspaceWithEntries());
});

/** 打开「从资料选择」下拉并点某条资料。 */
async function pickProfileEntry(label: string) {
  const combobox = screen.getByLabelText(t("claimDraftModal.label.fromProfile"));
  fireEvent.mouseDown(combobox);
  const option = await screen.findByTitle(label);
  fireEvent.click(option);
}

function rawTextArea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(
    t("claimDraftModal.placeholder.rawText"),
  ) as HTMLTextAreaElement;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ClaimDraftModal 的排版与阶段", () => {
  it("打开时没有空态，footer 是「取消 + 生成草稿」，两个控件都有 label", () => {
    renderModal();

    expect(screen.queryByText(t("claimDraftModal.empty.nothingExtracted"))).not.toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
    expect(
      footer().getByRole("button", { name: labelPattern(t("common.action.cancel")) }),
    ).toBeInTheDocument();
    // label 不能被 placeholder 顶掉：输入之后仍要能看出这一栏是什么。
    expect(screen.getByLabelText(t("claimDraftModal.label.category"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("claimDraftModal.label.subject"))).toBeInTheDocument();
  });

  it("什么都不填就点「生成草稿」仍是原来那句警告，不发请求", async () => {
    renderModal();

    fireEvent.click(generateButton());

    expect(await screen.findByText(t("claimDraftModal.toast.pasteFirst"))).toBeInTheDocument();
    expect(apiMocks.draftClaims).not.toHaveBeenCalled();
    expect(screen.queryByText(t("claimDraftModal.empty.nothingExtracted"))).not.toBeInTheDocument();
  });

  it("生成出 0 条时显示空态，文案说明「没提取到可入库的事实」", async () => {
    apiMocks.draftClaims.mockResolvedValue({ drafts: [], notes: [] });
    renderModal();

    pasteAndGenerate();

    expect(
      await screen.findByText(t("claimDraftModal.empty.nothingExtracted")),
    ).toBeInTheDocument();
  });

  it("有草稿后 footer 变成「取消 + 保存勾选的 N 条」，N 随勾选实时更新", async () => {
    apiMocks.draftClaims.mockResolvedValue({ drafts: [draft("A"), draft("B")], notes: [] });
    renderModal();

    pasteAndGenerate();

    expect(
      await footer().findByRole("button", {
        name: labelPattern(t("claimDraftModal.action.saveSelected", { count: 2 })),
      }),
    ).toBeInTheDocument();
    expect(
      footer().queryByRole("button", { name: labelPattern(t("claimDraftModal.action.generate")) }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(
      await footer().findByRole("button", {
        name: labelPattern(t("claimDraftModal.action.saveSelected", { count: 1 })),
      }),
    ).toBeInTheDocument();
  });
});

describe("ClaimDraftModal 的重新生成", () => {
  it("点「重新生成」先给覆盖确认，取消后不再发请求、草稿保留", async () => {
    apiMocks.draftClaims.mockResolvedValue({ drafts: [draft("A")], notes: [] });
    renderModal();
    pasteAndGenerate();
    await footer().findByRole("button", {
      name: labelPattern(t("claimDraftModal.action.saveSelected", { count: 1 })),
    });

    fireEvent.click(
      screen.getByRole("button", { name: labelPattern(t("claimDraftModal.action.regenerate")) }),
    );

    const confirmText = await screen.findByText(t("claimDraftModal.regenerate.confirm"));
    const popover = confirmText.closest(".ant-popconfirm, .ant-popover");
    if (!(popover instanceof HTMLElement)) throw new Error("popconfirm root not found");
    // 弹层按钮文案跟随 antd locale（测试里是英文），按结构取左起第一个＝取消。
    const cancelButton = popover.querySelector(".ant-popconfirm-buttons button");
    if (!(cancelButton instanceof HTMLElement)) throw new Error("cancel button not found");
    fireEvent.click(cancelButton);

    await waitFor(() => expect(popover.className).toMatch(/leave|hidden/));
    expect(apiMocks.draftClaims).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("A")).toBeInTheDocument();
  });
});

describe("ClaimDraftModal 的保存", () => {
  it("只提交勾选的行", async () => {
    apiMocks.draftClaims.mockResolvedValue({ drafts: [draft("A"), draft("B")], notes: [] });
    apiMocks.createClaim.mockResolvedValue({ id: 1 });
    renderModal();
    pasteAndGenerate();
    await footer().findByRole("button", {
      name: labelPattern(t("claimDraftModal.action.saveSelected", { count: 2 })),
    });

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(
      footer().getByRole("button", {
        name: labelPattern(t("claimDraftModal.action.saveSelected", { count: 1 })),
      }),
    );

    await waitFor(() => expect(apiMocks.createClaim).toHaveBeenCalledTimes(1));
    expect(apiMocks.createClaim).toHaveBeenCalledWith(expect.objectContaining({ title: "B" }));
  });

  it("取消会清掉「生成过」的标记，不会把下次打开说成失败", async () => {
    apiMocks.draftClaims.mockResolvedValue({ drafts: [], notes: [] });
    renderModal();
    pasteAndGenerate();
    await screen.findByText(t("claimDraftModal.empty.nothingExtracted"));

    fireEvent.click(
      footer().getByRole("button", { name: labelPattern(t("common.action.cancel")) }),
    );

    await waitFor(() =>
      expect(
        screen.queryByText(t("claimDraftModal.empty.nothingExtracted")),
      ).not.toBeInTheDocument(),
    );
    expect(generateButton()).toBeInTheDocument();
  });
});

describe("ClaimDraftModal 从资料选择（P3）", () => {
  it("选中一条资料后预填原文、主体与类别", async () => {
    renderModal();

    await pickProfileEntry("Acme backend intern");

    expect(rawTextArea().value).toContain("Acme backend intern");
    const subject = screen.getByLabelText(t("claimDraftModal.label.subject")) as HTMLInputElement;
    expect(subject.value).toBe("Acme backend intern");
    // 板块 → 台账分类的默认映射（实习/工作经历 → 实习/工作）。
    expect(
      screen.getByLabelText(t("claimDraftModal.label.category")).closest(".ant-select"),
    ).toHaveTextContent(t("claimDraftModal.category.internship"));
  });

  it("再次选择另一条资料前必须确认，取消后保留用户已改的内容", async () => {
    renderModal();
    await pickProfileEntry("Acme backend intern");

    // 用户改过内容之后再选另一条：不能静默覆盖。
    fireEvent.change(rawTextArea(), { target: { value: "我把这段改成了自己的说法" } });
    await pickProfileEntry("Beta analytics intern");

    expect(await screen.findByText(t("claimDraftModal.replaceEntry.confirm"))).toBeInTheDocument();
    const popover = screen
      .getByText(t("claimDraftModal.replaceEntry.confirm"))
      .closest(".ant-popconfirm, .ant-popover");
    if (!(popover instanceof HTMLElement)) throw new Error("popconfirm root not found");
    const [cancelButton] = popover.querySelectorAll(".ant-popconfirm-buttons button");
    fireEvent.click(cancelButton);

    await waitFor(() => expect(rawTextArea().value).toBe("我把这段改成了自己的说法"));
    // 取消后主体仍停在原资料上，不会显示成已经选了新的。
    const subject = screen.getByLabelText(t("claimDraftModal.label.subject")) as HTMLInputElement;
    expect(subject.value).toBe("Acme backend intern");
  });

  it("确认替换后才把原文换成新选的资料", async () => {
    renderModal();
    await pickProfileEntry("Acme backend intern");
    fireEvent.change(rawTextArea(), { target: { value: "临时改过的内容" } });

    await pickProfileEntry("Beta analytics intern");
    const confirmText = await screen.findByText(t("claimDraftModal.replaceEntry.confirm"));
    const popover = confirmText.closest(".ant-popconfirm, .ant-popover");
    if (!(popover instanceof HTMLElement)) throw new Error("popconfirm root not found");
    const buttons = popover.querySelectorAll(".ant-popconfirm-buttons button");
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(rawTextArea().value).toContain("Beta analytics intern"));
  });

  it("资料库读取失败时给出出路：可以继续手动粘贴", async () => {
    profileMocks.getWorkspace.mockRejectedValue(new Error("profile unavailable"));

    renderModal();

    expect(
      await screen.findByText(t("claimDraftModal.fromProfile.loadFailed")),
    ).toBeInTheDocument();
    // 手动路径还在：textarea 依旧可输入。
    expect(rawTextArea()).toBeEnabled();
  });
});
