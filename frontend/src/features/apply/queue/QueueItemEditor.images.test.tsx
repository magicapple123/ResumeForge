// SPDX-License-Identifier: Apache-2.0
/**
 * 队列编辑器的配图（R21）两条硬断言：
 *
 * 1. **这里没有删库入口**——"配图 ≠ 图库管理"。删库按钮一旦回到编辑弹窗，用户又会面对
 *    "点掉之后图库里那张也没了 / 或者点了回 409"的老问题；这条用例把它钉住。
 * 2. **配图真的进了请求体**——只有界面好看、`image_ids` 没进 payload，等于没配。
 *
 * 目录之外的依赖（简历远程搜索、推荐简历、话术模板）与这条无关，全部桩掉。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyGreetingImage, ApplyQueueItem } from "../../../types";
import { formatBytes } from "../../../utils/format";
import { QueueItemEditor } from "./QueueItemEditor";

const apiMocks = vi.hoisted(() => ({
  updateQueueItem: vi.fn(),
  previewGreeting: vi.fn(),
  getApplyGreetingImage: vi.fn(),
  uploadGreetingImage: vi.fn(),
  deleteGreetingImage: vi.fn(),
}));

vi.mock("../../../api/apply", () => ({
  updateQueueItem: apiMocks.updateQueueItem,
  previewGreeting: apiMocks.previewGreeting,
}));

vi.mock("../../../api/applyExtras", () => ({
  getApplyGreetingImage: apiMocks.getApplyGreetingImage,
  uploadGreetingImage: apiMocks.uploadGreetingImage,
  deleteGreetingImage: apiMocks.deleteGreetingImage,
  getGreetingTemplates: vi.fn().mockResolvedValue({ templates: [] }),
  markGreetingTemplateUsed: vi.fn(),
}));

vi.mock("../../../hooks/remoteSearchOptions", () => ({
  useResumeSearchSelectForJob: () => ({
    selectProps: { options: [], loading: false, onSearch: vi.fn(), onChange: vi.fn() },
    ensure: vi.fn(),
    reload: vi.fn(),
  }),
}));

// 推荐简历与本条无关（它自己还有一层接口）；桩成空，编辑器保持原样。
vi.mock("../insights/ResumeFitHint", () => ({ default: () => null }));
// 话术模板同理：模板清单是另一个接口的另一件事。
vi.mock("./GreetingTemplatePicker", () => ({ GreetingTemplatePicker: () => null }));

const ITEM: ApplyQueueItem = {
  id: 1,
  job_id: 11,
  job_title: "Backend engineer",
  company: "Acme",
  resume_id: null,
  resume_title: "",
  greeting: "hello from a candidate",
  image_ids: [],
  sort_order: 0,
  status: "pending",
  admission: null,
  hard_gate: null,
  requires_confirm: false,
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
};

const IMAGES: ApplyGreetingImage = {
  enabled: true,
  image_id: null,
  max_count: 4,
  max_image_bytes: 2 * 1024 * 1024,
  max_total_bytes: 8 * 1024 * 1024,
  options: [
    { id: 11, name: "shot-a.png", size_bytes: 1024, deletable: true },
    { id: 12, name: "shot-b.png", size_bytes: 2048, deletable: false },
  ],
};

function renderEditor() {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <AntdApp>
      <QueueItemEditor item={ITEM} onSaved={onSaved} onClose={onClose} />
    </AntdApp>,
  );
  return { onSaved, onClose };
}

/**
 * antd 会在**两个汉字**的按钮文案中间自动插一个空格（`保存` → `保 存`），
 * 所以按按钮名查找时要把字间空白放宽；文案本身仍来自 `t()`，不在测试里写死中文。
 */
function buttonNamed(label: string): HTMLElement {
  const pattern = new RegExp(`^${label.split("").join("\\s*")}$`);
  return screen.getByRole("button", { name: pattern });
}

describe("QueueItemEditor 配图（R21）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getApplyGreetingImage.mockResolvedValue(IMAGES);
    apiMocks.updateQueueItem.mockResolvedValue({ ...ITEM, image_ids: [11] });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("编辑一条队列行时没有删库按钮", async () => {
    renderEditor();

    // 展开图片库：库里有可选图，但每一张都只提供"勾选"，不提供"删除文件"。
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("applyQueue.image.addTileAria", { count: 0, max: 4 }),
      }),
    );

    for (const option of IMAGES.options) {
      expect(
        screen.queryByRole("button", {
          name: t("applyQueue.image.deleteAria", { name: option.name }),
        }),
      ).toBeNull();
    }
    expect(apiMocks.deleteGreetingImage).not.toHaveBeenCalled();
    // 边界写在界面上：要删图去投递设置。
    expect(screen.getByText(t("applyQueue.image.manageInSettings"))).toBeInTheDocument();
  });

  it("勾选的图随保存进入请求体（image_ids）", async () => {
    const { onSaved } = renderEditor();

    fireEvent.click(
      await screen.findByRole("button", {
        name: t("applyQueue.image.addTileAria", { count: 0, max: 4 }),
      }),
    );

    const thumb = await screen.findByRole("button", {
      name: t("applyQueue.image.toggleAria", {
        name: "shot-a.png",
        size: formatBytes(1024),
      }),
    });
    fireEvent.click(thumb);

    // 缩略图槽里出现了这一张（WYSIWYG：投出去的就是这里看到的）。
    expect(
      await screen.findByRole("button", {
        name: t("applyQueue.image.previewAria", { name: "shot-a.png" }),
      }),
    ).toBeInTheDocument();

    fireEvent.click(buttonNamed(t("common.action.save")));

    await waitFor(() => expect(apiMocks.updateQueueItem).toHaveBeenCalledTimes(1));
    // 只钉"配图真的进了请求体"，不钉整份 payload：同一份 body 还承载简历等别的字段，
    // 把每个字段都写死会让这条用例在别人加字段时误红（这条要守的是 image_ids）。
    const [itemId, payload] = apiMocks.updateQueueItem.mock.calls[0];
    expect(itemId).toBe(ITEM.id);
    expect(payload).toMatchObject({ image_ids: [11], greeting: ITEM.greeting });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
