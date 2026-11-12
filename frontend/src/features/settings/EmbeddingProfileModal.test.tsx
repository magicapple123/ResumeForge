// SPDX-License-Identifier: Apache-2.0
/** 「语义检索」新建/编辑配置弹窗：名称校验、预设回填、空 key 行为、测试连接、保存。 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import {
  fillProfileForm,
  openCreateModal,
  remoteReadyStatus,
  renderCard,
} from "./embeddingTestHelpers";

const apiMocks = vi.hoisted(() => ({
  getEmbeddingStatus: vi.fn(),
  startEmbeddingLocalDownload: vi.fn(),
  cancelEmbeddingLocalDownload: vi.fn(),
  removeEmbeddingLocalAssets: vi.fn(),
  enableEmbeddingLocal: vi.fn(),
  confirmEmbeddingHost: vi.fn(),
  revokeEmbeddingHost: vi.fn(),
  testEmbeddingRemote: vi.fn(),
  fetchEmbeddingModels: vi.fn(),
  enableEmbeddingRemote: vi.fn(),
  disableEmbedding: vi.fn(),
  clearEmbedding: vi.fn(),
  activateEmbeddingProfile: vi.fn(),
  saveEmbeddingProfile: vi.fn(),
  deleteEmbeddingProfile: vi.fn(),
  testEmbeddingProfile: vi.fn(),
  clearEmbeddingProfileKey: vi.fn(),
  embeddingProgressPercent: (progress: number) => {
    if (!Number.isFinite(progress) || progress <= 0) return 0;
    const percent = progress <= 1 ? progress * 100 : progress;
    return Math.min(100, Math.round(percent));
  },
}));

vi.mock("../../api/settings", () => apiMocks);

const MUTATIONS = [
  apiMocks.startEmbeddingLocalDownload,
  apiMocks.cancelEmbeddingLocalDownload,
  apiMocks.removeEmbeddingLocalAssets,
  apiMocks.enableEmbeddingLocal,
  apiMocks.confirmEmbeddingHost,
  apiMocks.revokeEmbeddingHost,
  apiMocks.testEmbeddingRemote,
  apiMocks.fetchEmbeddingModels,
  apiMocks.enableEmbeddingRemote,
  apiMocks.disableEmbedding,
  apiMocks.clearEmbedding,
  apiMocks.activateEmbeddingProfile,
  apiMocks.saveEmbeddingProfile,
  apiMocks.deleteEmbeddingProfile,
  apiMocks.testEmbeddingProfile,
  apiMocks.clearEmbeddingProfileKey,
];

beforeEach(() => {
  apiMocks.getEmbeddingStatus.mockReset().mockResolvedValue(remoteReadyStatus());
  for (const mock of MUTATIONS) mock.mockReset().mockResolvedValue(undefined);
});

/**
 * 打开某条配置的编辑弹窗：走 ⋮ → 编辑。
 *
 * 卡根曾经是 `role="button"`（点整卡即可编辑），但卡里已有「使用 / 测试连接 / ⋮」
 * 三个可聚焦按钮，交互角色套交互角色会被 axe 判 `nested-interactive`（serious），
 * 已改为普通 div。键盘可达路径就是这里用的 ⋮ → 编辑。
 */
async function openEditModal() {
  fireEvent.click(
    await screen.findByRole("button", {
      name: t("embeddingSearch.remote.profile.moreActions", { name: "Company Azure" }),
    }),
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: t("embeddingSearch.remote.profile.edit") }),
  );
  return screen.findByRole("dialog");
}

describe("EmbeddingProfileModal", () => {
  it("新建：名称/地址/模型必填，缺名称时给可读原因且不发请求", async () => {
    renderCard();
    await openCreateModal();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.modal.save") }));
    expect(
      await screen.findByText(t("embeddingSearch.remote.validation.nameRequired")),
    ).toBeInTheDocument();
    expect(apiMocks.saveEmbeddingProfile).not.toHaveBeenCalled();
  });

  it("新建：填好后保存，请求体不含明文以外的多余字段且名称去空格", async () => {
    renderCard();
    await openCreateModal();
    fillProfileForm({
      name: "  Company Azure  ",
      baseUrl: "https://api.example.com/v1",
      model: "text-embedding-3-large",
      key: "test-key",
    });
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.modal.save") }));
    await waitFor(() => expect(apiMocks.saveEmbeddingProfile).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveEmbeddingProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Company Azure",
        preset_id: "custom",
        config: expect.objectContaining({
          provider: "openai-http",
          base_url: "https://api.example.com/v1",
          model: "text-embedding-3-large",
          api_key: "test-key",
        }),
      }),
    );
    // 保存不暗含启用：不调用 activate。
    expect(apiMocks.activateEmbeddingProfile).not.toHaveBeenCalled();
    // 保存成功后重读 status（由 status 决定界面），而不是前端自己记「已保存」。
    await waitFor(() => expect(apiMocks.getEmbeddingStatus).toHaveBeenCalledTimes(2));
  });

  it("重名 409：把后端的失败原因留在弹窗内", async () => {
    apiMocks.saveEmbeddingProfile.mockRejectedValue(new Error("name already exists"));
    renderCard();
    await openCreateModal();
    fillProfileForm({ name: "Company Azure", baseUrl: "https://api.example.com/v1", model: "m" });
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.modal.save") }));
    expect(await screen.findByText(/name already exists/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("预设回填：点 OpenAI 预设填好地址与候选模型", async () => {
    renderCard();
    await openCreateModal();
    const grid = screen.getByRole("radiogroup", { name: t("embeddingSearch.remote.preset.aria") });
    fireEvent.click(
      within(grid).getByRole("radio", { name: t("embeddingSearch.remote.preset.openai") }),
    );
    expect(screen.getByLabelText(t("embeddingSearch.remote.baseUrl.label"))).toHaveValue(
      "https://api.openai.com/v1",
    );
    expect(screen.getByLabelText(t("embeddingSearch.remote.model.label"))).toHaveValue(
      "text-embedding-3-small",
    );
  });

  it("编辑：回填已存地址/模型，密钥为空并提示沿用这条的旧 key", async () => {
    renderCard();
    const dialog = await openEditModal();
    expect(
      within(dialog).getByText(t("embeddingSearch.remote.modal.editTitle")),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(t("embeddingSearch.remote.modal.nameLabel"))).toHaveValue(
      "Company Azure",
    );
    expect(within(dialog).getByLabelText(t("embeddingSearch.remote.baseUrl.label"))).toHaveValue(
      "https://api.example.com/v1",
    );
    const keyInput = within(dialog).getByLabelText(
      t("embeddingSearch.remote.key.label"),
    ) as HTMLInputElement;
    expect(keyInput.value).toBe("");
    expect(
      within(dialog).getByText(t("embeddingSearch.remote.profile.keyKept")),
    ).toBeInTheDocument();
  });

  it("编辑态测试连接：用该条已存 key（带上 profile id），结果留在弹窗内", async () => {
    apiMocks.testEmbeddingProfile.mockResolvedValue({
      ok: true,
      dim: 1024,
      elapsed_ms: 9,
      model: "text-embedding-3-large",
      error: "",
    });
    renderCard();
    const dialog = await openEditModal();
    fireEvent.click(within(dialog).getByRole("button", { name: t("embeddingSearch.remote.test") }));
    await waitFor(() => expect(apiMocks.testEmbeddingProfile).toHaveBeenCalledTimes(1));
    expect(apiMocks.testEmbeddingProfile).toHaveBeenCalledWith(
      "p_remote_1",
      expect.objectContaining({ api_key: "" }),
    );
    expect(
      await screen.findByText(t("embeddingSearch.remote.testOk", { dim: 1024 })),
    ).toBeInTheDocument();
  });

  it("编辑保存：带上 profile id，保存后弹窗关闭", async () => {
    renderCard();
    await openEditModal();
    fillProfileForm({ model: "text-embedding-3-small" });
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.modal.save") }));
    await waitFor(() => expect(apiMocks.saveEmbeddingProfile).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveEmbeddingProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p_remote_1", name: "Company Azure" }),
    );
    await waitFor(() => expect(apiMocks.getEmbeddingStatus).toHaveBeenCalledTimes(2));
  });

  it("复制：预填「副本」名称与同一条地址，密钥留空", async () => {
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("embeddingSearch.remote.profile.moreActions", { name: "Company Azure" }),
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("embeddingSearch.remote.profile.duplicate") }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(t("embeddingSearch.remote.modal.nameLabel"))).toHaveValue(
      `Company Azure ${t("embeddingSearch.remote.profile.copySuffix")}`,
    );
    expect(within(dialog).getByLabelText(t("embeddingSearch.remote.baseUrl.label"))).toHaveValue(
      "https://api.example.com/v1",
    );
    expect(
      (within(dialog).getByLabelText(t("embeddingSearch.remote.key.label")) as HTMLInputElement)
        .value,
    ).toBe("");
  });
});
