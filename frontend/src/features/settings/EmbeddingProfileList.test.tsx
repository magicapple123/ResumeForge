// SPDX-License-Identifier: Apache-2.0
/** 「语义检索」命名配置列表：渲染、使用/测试/删除/清除密钥、空态、生效中禁用。 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { makeProfile, makeStatus, remoteReadyStatus, renderCard } from "./embeddingTestHelpers";

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
  apiMocks.getEmbeddingStatus.mockReset().mockResolvedValue(makeStatus());
  for (const mock of MUTATIONS) mock.mockReset().mockResolvedValue(undefined);
});

const CONFIRMED_REMOTE = {
  configured: true,
  enabled: true,
  host: "api.example.com",
  model: "text-embedding-3-large",
  dim: 1024,
  endpoint_mode: "openai" as const,
  batch_size: 25,
  confirmed_hosts: ["api.example.com"],
  pending_host: "",
  error: "",
};

const OLLAMA = makeProfile({
  id: "p_remote_2",
  name: "Local Ollama",
  preset_id: "ollama",
  base_url: "http://localhost:11434/v1",
  model: "nomic-embed-text",
  dim: 768,
  host: "localhost:11434",
});

describe("EmbeddingProfileList", () => {
  it("列表渲染：名称/厂商/密钥标签，只有生效项带「生效中」", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      remoteReadyStatus({ profiles: [makeProfile(), OLLAMA] }),
    );
    renderCard();
    expect(await screen.findByText("Company Azure")).toBeInTheDocument();
    // 配置名与本机预设的显示名相同，用 host 区分这两张卡。
    expect(screen.getByText("localhost:11434")).toBeInTheDocument();
    expect(screen.getByText(t("embeddingSearch.remote.profile.active"))).toBeInTheDocument();
    expect(screen.getAllByText(t("embeddingSearch.remote.profile.keyConfigured"))).toHaveLength(2);
    // 生效项：标题区有「生效中」标签，动作行**不再**渲染「使用中」按钮
    // （第 3 条：同一状态说两遍，还占一个永远点不动的按钮位）。
    expect(
      screen.queryByRole("button", { name: t("embeddingSearch.remote.profile.using") }),
    ).toBeNull();
  });

  it("空列表：显示空态提示（主按钮在同一行的「新建配置」）", async () => {
    renderCard();
    fireEvent.click(await screen.findByText(t("embeddingSearch.mode.remote")));
    expect(
      await screen.findByText(t("embeddingSearch.remote.profiles.emptyHint")),
    ).toBeInTheDocument();
  });

  it("点「使用」：host 已确认 → 直接激活该条（不重新走启用流程）", async () => {
    const backup = makeProfile({ id: "p_remote_3", name: "Backup Azure" });
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      remoteReadyStatus({ profiles: [makeProfile(), backup] }),
    );
    renderCard();
    await screen.findByText("Backup Azure");
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.profile.use") }));
    await waitFor(() =>
      expect(apiMocks.activateEmbeddingProfile).toHaveBeenCalledWith("p_remote_3"),
    );
    expect(apiMocks.confirmEmbeddingHost).not.toHaveBeenCalled();
    expect(apiMocks.enableEmbeddingRemote).not.toHaveBeenCalled();
  });

  it("host 未确认：点「使用」先弹隐私确认，确认后先 confirm 再 activate", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      remoteReadyStatus({ profiles: [makeProfile(), OLLAMA], remote: CONFIRMED_REMOTE }),
    );
    renderCard();
    await screen.findByText("localhost:11434");
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.profile.use") }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(t("embeddingSearch.privacy.body", { host: "localhost:11434" })),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("embeddingSearch.privacy.confirm") }),
    );
    await waitFor(() =>
      expect(apiMocks.confirmEmbeddingHost).toHaveBeenCalledWith("localhost:11434"),
    );
    await waitFor(() =>
      expect(apiMocks.activateEmbeddingProfile).toHaveBeenCalledWith("p_remote_2"),
    );
  });

  it("测试连接：用这一条自己的 key 探测，结果显示在该卡片内", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(remoteReadyStatus());
    apiMocks.testEmbeddingProfile.mockResolvedValue({
      ok: true,
      dim: 1024,
      elapsed_ms: 12,
      model: "text-embedding-3-large",
      error: "",
    });
    renderCard();
    await screen.findByText("Company Azure");
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.profile.test") }));
    await waitFor(() => expect(apiMocks.testEmbeddingProfile).toHaveBeenCalledWith("p_remote_1"));
    expect(
      await screen.findByText(t("embeddingSearch.remote.testOk", { dim: 1024 })),
    ).toBeInTheDocument();
  });

  it("⋮ → 删除配置：二次确认后调用删除", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(remoteReadyStatus());
    renderCard();
    await screen.findByText("Company Azure");
    fireEvent.click(
      screen.getByRole("button", {
        name: t("embeddingSearch.remote.profile.moreActions", { name: "Company Azure" }),
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("embeddingSearch.remote.profile.delete") }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(t("embeddingSearch.remote.profile.deleteBody")),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("embeddingSearch.remote.profile.delete") }),
    );
    await waitFor(() => expect(apiMocks.deleteEmbeddingProfile).toHaveBeenCalledWith("p_remote_1"));
  });

  it("⋮ → 清除密钥：只清这一条（调用 clear-key 端点）", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(remoteReadyStatus());
    renderCard();
    await screen.findByText("Company Azure");
    fireEvent.click(
      screen.getByRole("button", {
        name: t("embeddingSearch.remote.profile.moreActions", { name: "Company Azure" }),
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("embeddingSearch.remote.clear") }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("embeddingSearch.remote.clear") }),
    );
    await waitFor(() =>
      expect(apiMocks.clearEmbeddingProfileKey).toHaveBeenCalledWith("p_remote_1"),
    );
  });

  it("键盘：⋮ → 编辑 打开编辑弹窗（卡根不再是交互角色）", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(remoteReadyStatus());
    renderCard();
    await screen.findByText("Company Azure");

    // 反证：卡根不能是 role=button。卡里已经有「使用 / 测试连接 / ⋮」三个可聚焦
    // 按钮，交互角色套交互角色会被 axe 判 nested-interactive（serious，会让
    // ui-quality.spec.ts 的 WCAG 扫描在 /settings 变红）。键盘等价入口是 ⋮ → 编辑。
    expect(
      screen.queryByRole("button", {
        name: t("embeddingSearch.remote.profile.editNamed", { name: "Company Azure" }),
      }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: t("embeddingSearch.remote.profile.moreActions", { name: "Company Azure" }),
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("embeddingSearch.remote.profile.edit") }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("有未生效改动：生效项保存时间晚于激活时间时显示标签", async () => {
    const profile = makeProfile({ updated_at: "2026-11-09T12:00:00+00:00" });
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      remoteReadyStatus({
        profiles: [profile],
        active_profile_updated_at: "2026-11-09T10:00:00+00:00",
      }),
    );
    renderCard();
    expect(await screen.findByText("Company Azure")).toBeInTheDocument();
    expect(
      screen.getByText(t("embeddingSearch.remote.profile.pendingChanges")),
    ).toBeInTheDocument();
  });
});
