// SPDX-License-Identifier: Apache-2.0
/**
 * W13 版本与变体弹窗：列表/创建/比较/恢复冲突/选择性同步（接口层 mock，组件真实渲染）。
 *
 * 恢复冲突是本文件最重要的一条：409 时必须给"刷新后再试"，**不许自动重试覆盖**。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client";
import { t } from "../../../i18n";
import VersionsModal from "./VersionsModal";

/** antd 会在两个汉字之间插空格（"比 较"），按角色查名字时用容忍空格的模式。 */
function looseName(label: string): RegExp {
  return new RegExp("^" + label.split("").join("\\s*") + "$");
}

const VERSION = {
  id: 5,
  resume_id: 7,
  name: "Final draft",
  change_summary: "2 lines added",
  job_id: null,
  job_title: "",
  company: "",
  content_sha256: "abc",
  params_sha256: "def",
  source_revision: 3,
  parent_version_id: null,
  frozen: false,
  source: "manual",
  created_at: "2026-10-20T10:00:00",
};
const VARIANT = {
  id: 9,
  resume_id: 7,
  name: "Backend variant",
  job_id: null,
  job_title: "",
  company: "",
  content_sha256: "aaa",
  base_version_id: null,
  last_synced_version_id: null,
  synced_at: null,
  created_at: "2026-10-20T10:00:00",
  updated_at: "2026-10-20T10:00:00",
};
const COMPARE = {
  base_id: 5,
  against_id: 0,
  base_name: "Final draft",
  against_name: "current",
  content: {
    base_id: 5,
    against_id: 0,
    base_title: "Final draft",
    against_title: "current",
    lines: [],
    stats: { added: 1, removed: 0, unchanged: 3 },
  },
  layout: { added: [], removed: [], changed: ["template"], equal: false },
};

const api = vi.hoisted(() => ({
  listVersions: vi.fn(),
  createVersion: vi.fn(),
  freezeVersion: vi.fn(),
  compareVersions: vi.fn(),
  restoreVersion: vi.fn(),
  listVariants: vi.fn(),
  createVariant: vi.fn(),
  syncVariants: vi.fn(),
}));

vi.mock("../../../features/resume-versions/versionsApi", () => api);

function renderModal() {
  return render(
    <AntdApp>
      <VersionsModal
        open
        onClose={vi.fn()}
        resumeId={7}
        currentRevision={3}
        currentContent={{ summary: "后端", experience: [{ company: "Acme" }] }}
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  api.listVersions.mockResolvedValue({ items: [VERSION] });
  api.createVersion.mockResolvedValue({ ...VERSION, id: 6, name: "New version" });
  api.freezeVersion.mockResolvedValue({ ...VERSION, frozen: true });
  api.compareVersions.mockResolvedValue(COMPARE);
  api.restoreVersion.mockResolvedValue({ version: VERSION, resume: {}, revision: 4 });
  api.listVariants.mockResolvedValue({ items: [VARIANT] });
  api.createVariant.mockResolvedValue({ ...VARIANT, id: 10, name: "New variant" });
  api.syncVariants.mockResolvedValue({
    source_version_id: null,
    items: [{ variant_id: 9, applied_paths: ["summary"], content_sha256: "bbb" }],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("版本与变体弹窗（W13）", () => {
  it("加载命名版本列表；创建版本调用真实接口参数", async () => {
    renderModal();
    expect(await screen.findByText("Final draft")).toBeInTheDocument();
    const nameInput = screen.getByRole("textbox", { name: t("versions.create.name") });
    fireEvent.change(nameInput, { target: { value: "New version" } });
    fireEvent.click(screen.getByRole("button", { name: t("versions.create.action") }));
    await waitFor(() =>
      expect(api.createVersion).toHaveBeenCalledWith(7, {
        name: "New version",
        change_summary: "",
      }),
    );
  });

  it("比较：调用 compare(current) 并渲染正文+排版摘要", async () => {
    renderModal();
    // 先等创建区出现（= tab 正文已挂载），再点行内按钮。
    await screen.findByRole("button", { name: t("versions.create.action") });
    await waitFor(() => expect(api.listVersions).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole("button", { name: looseName(t("versions.action.compare")) }),
    );
    await waitFor(() => expect(api.compareVersions).toHaveBeenCalledWith(7, 5, "current"));
    expect(
      await screen.findByText(t("versions.compare.contentStats", { added: 1, removed: 0 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("versions.compare.layoutChanged", { keys: "template" })),
    ).toBeInTheDocument();
  });

  it("恢复：带 expected_revision；409 只提示刷新，不自动重试覆盖", async () => {
    api.restoreVersion.mockRejectedValueOnce(
      new ApiError("版本已过期", 409, {
        businessCode: "resume_revision_conflict",
        payload: { revision: 12 },
      }),
    );
    renderModal();
    await screen.findByText("Final draft");
    fireEvent.click(
      await screen.findByRole("button", {
        name: looseName(t("versions.action.restore")),
      }),
    );
    const confirms = await screen.findAllByRole("button", {
      name: looseName(t("versions.restore.ok")),
    });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(api.restoreVersion).toHaveBeenCalledWith(7, 5, 3));
    expect(await screen.findByText(t("versions.restore.conflict"))).toBeInTheDocument();
    expect(api.restoreVersion).toHaveBeenCalledTimes(1);
  });

  it("选择性同步：只提交勾选的变体与路径（其余岗位定制不动）", async () => {
    renderModal();
    await screen.findByText("Final draft");
    fireEvent.click(screen.getByRole("tab", { name: t("versions.tab.variants") }));
    expect((await screen.findAllByText("Backend variant")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Backend variant" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: t("versions.variants.syncAction") }));
    await waitFor(() =>
      expect(api.syncVariants).toHaveBeenCalledWith(7, {
        source_version_id: null,
        variant_ids: [9],
        paths: ["summary"],
      }),
    );
  });
});
