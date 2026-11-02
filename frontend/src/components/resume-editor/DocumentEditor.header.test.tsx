// SPDX-License-Identifier: Apache-2.0
/**
 * 基本信息（页眉）chip 化的组件行为（#10 / #25）。
 *
 * 覆盖：分组渲染、右键菜单（隐藏 / 删除）、双击展开编辑、方向键换位、拖拽换位、
 * 照片缩略图 chip 与「更换 / 裁剪 / 移除」、自定义页眉字段、选中页眉字段时切回基本信息页签。
 *
 * 断言文案一律走 `t()`：中文 ByText 会撞 cjkRatchet 的 tests 口径。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import type { ResumeLayout } from "../../types/resume";
import type { ResumeDocument } from "../../types/resumeDocument";
import { makeDocument } from "../../features/resume-document/documentFixtures";
import {
  photoSha256,
  readPhotoCropFromFormatConfig,
  withPhotoCrop,
} from "../../features/resume-proview/photoCrop";
import DocumentEditor from "./DocumentEditor";

/**
 * 任务 6：裁剪弹窗需要原图像素尺寸（`usePhotoDimensions` 用 `new Image()` 解码，jsdom 不会
 * 解码任何图片）。默认仍是 `null`（保持既有用例里「正在读取照片尺寸…」那条），需要几何的
 * 用例自己设 `photoState.dims`。
 */
const photoState = vi.hoisted(() => ({
  dims: null as { width: number; height: number } | null,
}));

vi.mock("../../features/resume-proview/usePhotoDimensions", () => ({
  usePhotoDimensions: () => photoState.dims,
}));

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";
const CUSTOM_NAME = "Expected city";

function renderEditor(
  document: ResumeDocument = makeDocument(),
  props: Partial<Parameters<typeof DocumentEditor>[0]> = {},
) {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  const utils = render(
    <DocumentEditor
      document={document}
      onChange={onChange}
      onSelectPath={onSelectPath}
      {...props}
    />,
  );
  return { ...utils, onChange, onSelectPath };
}

function lastDocument(onChange: ReturnType<typeof vi.fn>): ResumeDocument {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeDocument;
}

/** 页眉 chip 外壳（无障碍名 = `标签：值`）。 */
function headerChip(labelKey: Parameters<typeof t>[0]): HTMLElement {
  const label = t(labelKey);
  return screen.getByRole("group", {
    name: (name: string) => name === label || name.startsWith(`${label}\uFF1A`),
  }) as HTMLElement;
}

function mainButton(chip: HTMLElement): HTMLElement {
  return within(chip).getAllByRole("button")[0];
}

function withPhoto(): ResumeDocument {
  const base = makeDocument();
  return {
    ...base,
    header: {
      ...base.header,
      items: [
        ...base.header.items,
        {
          kind: "field",
          id: "ob_head0003",
          key: "photo",
          label: "",
          value: PHOTO,
          placement: "photo",
          format: "text",
        },
      ],
    },
  };
}

/**
 * 受控选中态的编辑器：`aria-pressed` 只在选中态**真的被写回**时才成立。
 *
 * 这正是既有用例看不见「双击把选中翻掉」的原因——`renderEditor` 把 `onSelectPath` 传成
 * 一个 spy、`selectedPath` 留空，`selected` 永远是 false，click 的翻转分支根本走不到。
 *
 * `initialSelected` 用来复刻「刚添加的页眉字段已被自动选中」的起点（新增字段 → 双击编辑）。
 */
function ControlledEditor({ initialSelected = null }: { initialSelected?: string | null }) {
  const [document] = useState<ResumeDocument>(() => makeDocument());
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelected);
  return (
    <>
      <span data-testid="selected-path">{selectedPath ?? "null"}</span>
      <DocumentEditor
        document={document}
        onChange={() => undefined}
        selectedPath={selectedPath}
        onSelectPath={setSelectedPath}
      />
    </>
  );
}

function dragPayload() {
  return {
    dataTransfer: {
      setData: () => undefined,
      getData: () => "",
      dropEffect: "move",
      effectAllowed: "move",
    },
  };
}

describe("DocumentEditor · 基本信息 chip（#10）", () => {
  it("页眉字段按位置分组渲染成 chip，不再是表单行", () => {
    const { container } = renderEditor();
    const nameGroup = container.querySelector('[data-header-placement="name"]');
    const contactGroup = container.querySelector('[data-header-placement="contact"]');
    expect(nameGroup).not.toBeNull();
    expect(contactGroup).not.toBeNull();
    expect(within(nameGroup as HTMLElement).getByText("Li Si")).toBeInTheDocument();
    expect(within(contactGroup as HTMLElement).getByText("13800000000")).toBeInTheDocument();
    // chip 上没有可见的隐藏/删除按钮（统一走右键菜单）。
    const chip = headerChip("document.headerField.name");
    expect(within(chip).queryByRole("button", { name: t("document.item.remove") })).toBeNull();
    expect(within(chip).queryByRole("button", { name: t("document.item.hide") })).toBeNull();
  });

  it("右键菜单能真的隐藏页眉字段", async () => {
    const { onChange } = renderEditor();
    fireEvent.contextMenu(headerChip("document.headerField.name"));
    fireEvent.click(await screen.findByText(t("document.item.hide")));
    expect(lastDocument(onChange).header.items[0].placement).toBe("hidden");
  });

  it("右键菜单能真的删除页眉字段", async () => {
    const { onChange } = renderEditor();
    fireEvent.contextMenu(headerChip("document.headerField.phone"));
    fireEvent.click(await screen.findByText(t("document.item.remove")));
    const items = lastDocument(onChange).header.items;
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("name");
  });

  it("双击展开字段编辑器（单击只选中）", () => {
    const { onChange, onSelectPath } = renderEditor();
    const main = mainButton(headerChip("document.headerField.name"));
    fireEvent.click(main);
    expect(onSelectPath).toHaveBeenLastCalledWith("header.ob_head0001");
    expect(screen.queryByLabelText(t("document.headerField.name"))).toBeNull();
    fireEvent.doubleClick(main);
    expect(main).toHaveAttribute("aria-expanded", "true");
    const input = screen.getByLabelText(t("document.headerField.name")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Wang Wu" } });
    expect(lastDocument(onChange).header.items[0].value).toBe("Wang Wu");
  });

  it("真实双击序列（click×2 + dblclick）首次就展开且保持选中", () => {
    // 回归 F1：真实浏览器里 `dblclick` 不是可靠信号（chip 是 draggable，两次按下之间
    // 动一两像素就走拖动判定；第一下选中触发的定位滚动/重渲染也会让第二下落空），
    // 而第二下 `click` 照样到达——修复前它会被当成"再点一次"翻转选中并清空展开态。
    render(<ControlledEditor />);
    const main = mainButton(headerChip("document.headerField.name"));

    fireEvent.click(main, { detail: 1 });
    fireEvent.click(main, { detail: 2 });
    fireEvent.doubleClick(main); // 真实浏览器会补这一发，只该生效一次

    expect(main).toHaveAttribute("aria-expanded", "true");
    expect(main).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("selected-path")).toHaveTextContent("header.ob_head0001");
    expect(screen.getByLabelText(t("document.headerField.name"))).toBeInTheDocument();
  });

  it("浏览器没发 dblclick 时，第二下 click 也要能展开", () => {
    // draggable 抖动 / 目标在两击之间飘移时，浏览器只发两下 click、不发 dblclick。
    render(<ControlledEditor />);
    const main = mainButton(headerChip("document.headerField.name"));
    fireEvent.click(main, { detail: 1 });
    fireEvent.click(main, { detail: 2 });
    expect(main).toHaveAttribute("aria-expanded", "true");
    expect(main).toHaveAttribute("aria-pressed", "true");
  });

  it("已展开的 chip 再双击一次是收起（含尾随 dblclick，不能被弹开）", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    try {
      render(<ControlledEditor />);
      const main = mainButton(headerChip("document.headerField.name"));
      fireEvent.click(main, { detail: 1 });
      fireEvent.click(main, { detail: 2 });
      fireEvent.doubleClick(main);
      expect(main).toHaveAttribute("aria-expanded", "true");

      // 隔 600ms 再来一次完整双击：第一下 click 会收起（select() 无条件清空展开态），
      // 第二下与尾随的 dblclick 都必须**保持**收起，不能再 toggle 回展开。
      nowSpy.mockReturnValue(2_000_000 + 600);
      fireEvent.click(main, { detail: 1 });
      nowSpy.mockReturnValue(2_000_000 + 620);
      fireEvent.click(main, { detail: 2 });
      fireEvent.doubleClick(main);
      expect(main).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByLabelText(t("document.headerField.name"))).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("已选中但未展开（新增字段自动选中）→ 双击仍展开并保持选中", () => {
    // 「添加页眉字段」后新 chip 是自动选中的：此时双击的第一下 click 会先把选中翻掉，
    // 若第二下只 toggle 不恢复选中，就会变成"展开了却没选中"或整个手势双输。
    render(<ControlledEditor initialSelected="header.ob_head0001" />);
    const main = mainButton(headerChip("document.headerField.name"));
    expect(main).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(main, { detail: 1 });
    fireEvent.click(main, { detail: 2 });
    fireEvent.doubleClick(main);

    expect(main).toHaveAttribute("aria-expanded", "true");
    expect(main).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("selected-path")).toHaveTextContent("header.ob_head0001");
    expect(screen.getByLabelText(t("document.headerField.name"))).toBeInTheDocument();
  });

  it("两下都是 detail=1 但间隔 80ms（人类快速双击）→ 仍按同一次手势处理", () => {
    // 真实浏览器并不保证第二下带 `detail=2`：两次按下间隔略长、或第二下落在同一 chip 的
    // 另一个子节点上时，连击计数可能还是 1。PAIR_WINDOW_MS 的时间窗就是为这条兜底用的
    // （QA 真机实测：加完字段后两下都 `detail=1`、间隔 80ms，靠它才展开并补回选中）。
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(3_000_000);
    try {
      render(<ControlledEditor initialSelected="header.ob_head0001" />);
      const main = mainButton(headerChip("document.headerField.name"));
      fireEvent.click(main, { detail: 1 }); // 第一下：按既有语义翻掉选中
      expect(main).toHaveAttribute("aria-pressed", "false");

      nowSpy.mockReturnValue(3_000_000 + 80);
      fireEvent.click(main, { detail: 1 }); // 第二下：detail 仍是 1，靠时间窗认成双击
      expect(main).toHaveAttribute("aria-expanded", "true");
      expect(main).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("selected-path")).toHaveTextContent("header.ob_head0001");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("两击间隔超过双击阈值时仍是两次单击（第二下取消选中、不展开）", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      render(<ControlledEditor />);
      const main = mainButton(headerChip("document.headerField.name"));
      fireEvent.click(main, { detail: 1 });
      expect(main).toHaveAttribute("aria-pressed", "true");

      // 900ms 之后：人不会把它当双击，浏览器也不会发 dblclick。
      nowSpy.mockReturnValue(1_000_000 + 900);
      fireEvent.click(main, { detail: 1 });
      expect(main).toHaveAttribute("aria-pressed", "false");
      expect(main).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("selected-path")).toHaveTextContent("null");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("提示条是编辑器根节点的浮层子级，不在字段区/chip 行的流里", () => {
    // F1-b 回归：提示条原先参与 flex 布局、坐在页签之上，一出现/一消失就把字段区顶动
    // （真机 52.3px）。第一次点击 chip 会 `setNotice(null)`，于是"刚加完字段就快速双击"
    // 的第二下落到空处、双击看起来没反应。
    // jsdom 不做布局（`getBoundingClientRect()` 恒为 0），所以这里只断言**结构事实**，
    // 位移归零由真机脚本验；浮层化本身由 styles/document-editor-notice.test.ts 守。
    render(<ControlledEditor />);
    const nameInput = screen.getByLabelText(t("document.basic.customField"));
    fireEvent.change(nameInput, { target: { value: CUSTOM_NAME } });
    fireEvent.click(screen.getByRole("button", { name: t("document.basic.customAdd") }));

    const notice = screen.getByRole("alert");
    const layer = notice.closest(".document-editor-notice") as HTMLElement | null;
    const editor = document.querySelector(".document-editor") as HTMLElement;
    const panel = document.querySelector('[data-document-section="header"]') as HTMLElement;

    expect(layer).not.toBeNull();
    // 浮层是编辑器根节点的直接子级：既不进字段区，也不在 chip 行的容器内。
    expect(layer?.parentElement).toBe(editor);
    expect(panel.contains(layer as HTMLElement)).toBe(false);
    // chip 所在面板的前一个兄弟不能是提示条（回到流里就会把这一行顶下去）。
    expect(panel.previousElementSibling).not.toBe(layer);
  });

  it("方向键换位：Enter 拿起 → → 换到下一个位置组", () => {
    const { onChange } = renderEditor();
    const main = mainButton(headerChip("document.headerField.name"));
    fireEvent.keyDown(main, { key: "Enter" });
    fireEvent.keyDown(main, { key: "ArrowRight" });
    const moved = lastDocument(onChange).header.items.find((item) => item.id === "ob_head0001");
    expect(moved?.placement).toBe("name_meta");
  });

  it("拖拽换位：把手机拖到姓名格上", () => {
    const { onChange } = renderEditor();
    const phone = headerChip("document.headerField.phone");
    const name = headerChip("document.headerField.name");
    fireEvent.dragStart(mainButton(phone), dragPayload());
    fireEvent.dragOver(name, dragPayload());
    fireEvent.drop(name, dragPayload());
    const items = lastDocument(onChange).header.items;
    expect(items[0].id).toBe("ob_head0002");
    expect(items[0].placement).toBe("name");
  });

  it("自定义页眉字段：输入名字后落进 chip 流", () => {
    const { onChange, onSelectPath } = renderEditor();
    const nameInput = screen.getByLabelText(t("document.basic.customField"));
    fireEvent.change(nameInput, { target: { value: CUSTOM_NAME } });
    fireEvent.click(screen.getByRole("button", { name: t("document.basic.customAdd") }));
    const items = lastDocument(onChange).header.items;
    const added = items[items.length - 1];
    expect(added.label).toBe(CUSTOM_NAME);
    expect(added.key.startsWith("custom_")).toBe(true);
    expect(added.placement).toBe("contact");
    expect(onSelectPath).toHaveBeenCalled();
  });

  it("选中页眉字段时自动切回「基本信息」页签（定位修复）", () => {
    const document = makeDocument();
    const onChange = vi.fn();
    const { rerender } = render(
      <DocumentEditor
        document={document}
        onChange={onChange}
        selectedPath="education.ob_entry001"
      />,
    );
    expect(screen.queryByText(t("document.basic.hint"))).toBeNull();
    rerender(
      <DocumentEditor document={document} onChange={onChange} selectedPath="header.ob_head0002" />,
    );
    expect(screen.getByText(t("document.basic.hint"))).toBeInTheDocument();
  });
});

describe("DocumentEditor · 照片 chip（#25）", () => {
  it("照片渲染成缩略图，不把 base64 铺成文本", () => {
    const { container } = renderEditor(withPhoto());
    const chip = headerChip("document.headerField.photo");
    const image = within(chip).getByRole("img", { name: t("document.photo.thumbnail") });
    expect(image).toHaveAttribute("src", PHOTO);
    expect(chip.textContent ?? "").not.toContain("data:image");
    expect(container.textContent ?? "").not.toContain("base64");
  });

  it("展开态给出更换 / 裁剪 / 移除三个动作，裁剪能打开弹窗", async () => {
    renderEditor(withPhoto());
    fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
    expect(
      screen.getByRole("button", { name: new RegExp(t("document.photo.replace")) }),
    ).toBeInTheDocument();
    const crop = screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) });
    expect(
      screen.getByRole("button", { name: new RegExp(t("document.photo.remove")) }),
    ).toBeInTheDocument();
    fireEvent.click(crop);
    expect(await screen.findByText(t("document.photo.cropTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.photo.hint"))).toBeInTheDocument();
    // 图片尺寸还没读出来时给可读的占位（而不是一个空框 / 一张坏图）。
    expect(screen.getByText(t("document.photo.cropLoading"))).toBeInTheDocument();
  });

  it("移除照片把值清空（字段本身保留）", () => {
    const { onChange } = renderEditor(withPhoto());
    fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.remove")) }));
    const photo = lastDocument(onChange).header.items.find((item) => item.key === "photo");
    expect(photo?.value).toBe("");
  });

  it("没有照片时裁剪入口存在但不可用（不留死按钮陷阱）", () => {
    const base = makeDocument();
    const document: ResumeDocument = {
      ...base,
      header: {
        ...base.header,
        items: [
          ...base.header.items,
          {
            kind: "field",
            id: "ob_head0004",
            key: "photo",
            label: "",
            value: "",
            placement: "photo",
            format: "text",
          },
        ],
      },
    };
    renderEditor(document);
    fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
    const crop = screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) });
    expect(crop).toBeDisabled();
    expect(screen.getByText(t("document.photo.empty"))).toBeInTheDocument();
  });
});

// ===== 任务 6：照片裁剪改成非破坏（写 photo_crop，不动 item.value） =====

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "standard",
  page_limit: 1,
  font_scale: "standard",
};

function renderWithLayout(
  document: ResumeDocument,
  formatConfig: ResumeFormatConfig | null = null,
) {
  const onChange = vi.fn();
  const onLayoutChange = vi.fn();
  render(
    <DocumentEditor
      document={document}
      onChange={onChange}
      onLayoutChange={onLayoutChange}
      layout={{ ...LAYOUT, format_config: formatConfig ?? undefined }}
    />,
  );
  return { onChange, onLayoutChange };
}

/** 已保存的裁剪参数（走生产同一条读取路径，避免测试自己解释域格式）。 */
function cropOf(layout: ResumeLayout | undefined) {
  return readPhotoCropFromFormatConfig(layout?.format_config ?? null);
}

function lastLayout(onLayoutChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onLayoutChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeLayout;
}

/** 一份"已裁过"的 format_config（写路径与产品同一个 helper）。 */
function croppedConfig(rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }): ResumeFormatConfig {
  return withPhotoCrop(null, {
    version: 1,
    source: { sha256: photoSha256(PHOTO), width: 1200, height: 1600 },
    rect,
    aspect: "free",
  });
}

describe("DocumentEditor · 照片裁剪非破坏（任务 6）", () => {
  it("应用裁剪写进 format_config.photo_crop，页眉照片值一个字节都不变", async () => {
    photoState.dims = { width: 1200, height: 1600 };
    try {
      const { onChange, onLayoutChange } = renderWithLayout(withPhoto());
      fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) }));
      fireEvent.click(await screen.findByRole("button", { name: t("document.photo.cropApply") }));

      // 照片值没被改：`onChange` 一次都不该因为裁剪而触发。
      expect(onChange).not.toHaveBeenCalled();
      // 哈希必须对应**原图**（后端用它对照片做失效判据）。
      expect(cropOf(lastLayout(onLayoutChange))?.source.sha256).toBe(photoSha256(PHOTO));
    } finally {
      photoState.dims = null;
    }
  });

  it("「恢复原图」删掉 photo_crop 域", async () => {
    photoState.dims = { width: 1200, height: 1600 };
    try {
      const { onLayoutChange } = renderWithLayout(withPhoto(), croppedConfig());
      fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) }));
      fireEvent.click(await screen.findByRole("button", { name: t("proview.photo.reset") }));

      expect(cropOf(lastLayout(onLayoutChange))).toBeNull();
    } finally {
      photoState.dims = null;
    }
  });

  it("移除照片的同时清掉指向旧图的裁剪参数", () => {
    const { onChange, onLayoutChange } = renderWithLayout(withPhoto(), croppedConfig());
    fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.remove")) }));

    const photo = lastDocument(onChange).header.items.find((item) => item.key === "photo");
    expect(photo?.value).toBe("");
    expect(cropOf(lastLayout(onLayoutChange))).toBeNull();
  });

  it("页眉 chip 的缩略图按裁剪参数显示取景（不再是整张原图）", () => {
    renderWithLayout(withPhoto(), croppedConfig({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }));
    const chip = headerChip("document.headerField.photo");
    const thumb = chip.querySelector(".rf-crop-thumb") as HTMLElement | null;
    expect(thumb).not.toBeNull();
    // 取景是 1200×1600 原图的中间一半 → 600×800，外层盒子比例 0.75。
    expect(thumb?.style.aspectRatio).toContain("0.75");
    // 内层 img 放大 2 倍并左/上各偏移 50%：这就是"只看中间那 1/4"。
    const img = thumb?.querySelector("img") as HTMLImageElement | null;
    expect(img?.style.width).toBe("200%");
    expect(img?.style.left).toBe("-50%");
  });
});
