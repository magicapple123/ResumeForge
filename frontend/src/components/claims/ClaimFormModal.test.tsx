// SPDX-License-Identifier: Apache-2.0
/**
 * 台账条目表单：字段组拆分后的两条界面契约（问题清单 §20 P0-3 / §20.6）。
 *
 * 1. 「关联资料条目」是资料库条目的多选（存 entry_id），与"证据来源"分开；
 * 2. 迁移回填出来的自动关联要提示「已自动关联，请核对」，并且提交时把 entry_ids 带上。
 *
 * 表单字段本身的行为（校验、草稿、关闭语义）由 FormModal 与既有用例负责，这里不重复。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { Claim } from "../../types";
import { makeEntry, makeWorkspace } from "../../test/profileWorkspaceFixture";
import ClaimFormModal from "./ClaimFormModal";

const apiMocks = vi.hoisted(() => ({
  createClaim: vi.fn(),
  updateClaim: vi.fn(),
}));

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

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 1,
    title: "检索接口",
    category: "项目经历",
    subject: "校园知识检索平台",
    source_fact: "负责检索接口的实现与联调。",
    candidate_wording: "实现检索接口并联调上线",
    sources: [],
    entry_ids: [],
    entry_ids_auto: false,
    responsibility_level: "参与",
    verification_status: "待确认",
    allowed_uses: [],
    interview_details: { decisions: [], difficulties: [], verification: [], result: null },
    boundary: "",
    risk_notes: [],
    last_verified: "",
    created_at: "2026-09-18T00:00:00",
    updated_at: "2026-09-18T00:00:00",
    warnings: [],
    ...overrides,
  };
}

function workspaceWithEntries() {
  return makeWorkspace({
    entries: [makeEntry("experiences", ENTRY_A, { "experiences.title": "Acme backend intern" }, 0)],
  });
}

/** antd 会给两个汉字的按钮文案中间插一个空格（「保 存」）；断言按空白容忍。 */
function labelPattern(label: string): RegExp {
  return new RegExp(Array.from(label).join("\\s*"));
}

function renderModal(claim: Claim | null) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <AntdApp>
      <ClaimFormModal open claim={claim} onClose={onClose} onSaved={onSaved} />
    </AntdApp>,
  );
  return { onClose, onSaved };
}

/** 打开「关联资料条目」下拉并选中一条资料。 */
async function pickEntry() {
  const combobox = await screen.findByLabelText(t("claimForm.field.entryIds"));
  fireEvent.mouseDown(combobox);
  fireEvent.click(await screen.findByTitle("Acme backend intern"));
}

beforeEach(() => {
  apiMocks.createClaim.mockReset();
  apiMocks.updateClaim.mockReset();
  profileMocks.getWorkspace.mockReset();
  profileMocks.getWorkspace.mockResolvedValue(workspaceWithEntries());
  apiMocks.updateClaim.mockResolvedValue(makeClaim({ entry_ids: [ENTRY_A] }));
  apiMocks.createClaim.mockResolvedValue(makeClaim({ entry_ids: [ENTRY_A] }));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ClaimFormModal 的关联资料条目", () => {
  it("编辑时能选到资料条目，并把 entry_id 作为 entry_ids 提交", async () => {
    renderModal(makeClaim());

    await pickEntry();
    fireEvent.click(screen.getByRole("button", { name: labelPattern(t("claimForm.action.save")) }));

    await waitFor(() => expect(apiMocks.updateClaim).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.updateClaim.mock.calls[0];
    expect(payload.entry_ids).toEqual([ENTRY_A]);
    // 证据来源不再承担关联职责：没填就还是空数组，不会被拿去拼 entry_id。
    expect(payload.sources).toEqual([]);
  });

  it("迁移回填出来的自动关联要提示用户核对", async () => {
    renderModal(makeClaim({ entry_ids: [ENTRY_A], entry_ids_auto: true }));

    expect(
      await screen.findByText((content) => content.includes(t("claimForm.hint.autoLinked"))),
    ).toBeInTheDocument();
  });

  it("资料库没有条目时指出去资料库添加，而不是给一个空下拉", async () => {
    profileMocks.getWorkspace.mockResolvedValue(makeWorkspace({ entries: [] }));

    renderModal(makeClaim());

    expect(await screen.findByText(t("claimForm.entryIds.empty"))).toBeInTheDocument();
  });

  it("资料库读取失败时说明原因，其它字段仍可正常填写", async () => {
    profileMocks.getWorkspace.mockRejectedValue(new Error("profile unavailable"));

    renderModal(makeClaim());

    expect(await screen.findByText(t("claimForm.entryIds.loadFailed"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("claimForm.field.title"))).toBeEnabled();
  });
});
