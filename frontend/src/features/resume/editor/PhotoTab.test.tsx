// SPDX-License-Identifier: Apache-2.0
/**
 * 左栏「照片」分组（T02；5.1 从独立页签并入「排版参数」）。
 *
 * 三条只有这一层才会错的契约：
 * 1. **可用性看当前文档**，不看宿主传下来的"已保存详情"——否则上传后缩略图已经出来、
 *    裁剪按钮还是灰的（T02 的假 bug）；
 * 2. 换图必须**同批清掉 `photo_crop`**（sha 指向旧图，留着就是死数据）；
 * 3. 换图写的是页眉 item 的 `value`，不是第二份照片状态。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../i18n";
import { makeDocument } from "../document/documentFixtures";
import { documentHasPhoto } from "../document/view";
import { photoSha256, withPhotoCrop } from "../preview/photoCrop";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";
import { DEFAULT_LAYOUT } from "../layout/ResumeLayoutControls.testkit";
import PhotoTab from "./PhotoTab";

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/**
 * 把页眉里那条照片 item 的 value 设成给定值（**不追加第二条**：
 * `makeDocument()` 本身已经带一条空照片，追加会让 `findIndex(key === "photo")` 指向旧的那条）。
 */
function docWithPhoto(value: string): ResumeDocument {
  const base = makeDocument();
  const others = base.header.items.filter((item) => item.key !== "photo");
  return {
    ...base,
    header: {
      ...base.header,
      items: [
        ...others,
        {
          kind: "field",
          id: "ob_head0099",
          key: "photo",
          label: "",
          value,
          placement: "photo",
        } as ResumeDocument["header"]["items"][number],
      ],
    },
  } as ResumeDocument;
}

/** 用真实写路径造裁剪参数（`parsePhotoCrop` 会校验形状，手搓字面量会被判无效）。 */
function layoutWith(cropped: boolean): ResumeLayout {
  return {
    ...DEFAULT_LAYOUT,
    format_config: cropped
      ? withPhotoCrop(null, {
          version: 1,
          source: { sha256: photoSha256(PHOTO), width: 1200, height: 1600 },
          rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
          aspect: "free",
        })
      : {},
  } as unknown as ResumeLayout;
}

function renderTab(document: ResumeDocument, layout: ResumeLayout = layoutWith(false)) {
  const onDocumentChange = vi.fn();
  const onLayoutChange = vi.fn();
  render(
    <AntdApp>
      <PhotoTab
        document={document}
        layout={layout}
        onDocumentChange={onDocumentChange}
        onLayoutChange={onLayoutChange}
        onNotice={() => undefined}
      />
    </AntdApp>,
  );
  return { onDocumentChange, onLayoutChange };
}

describe("PhotoTab", () => {
  it("没有照片：裁剪与移除都不可用（入口在，但不给死按钮）", () => {
    renderTab(docWithPhoto(""));
    expect(
      screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: new RegExp(t("document.photo.remove")) }),
    ).toBeDisabled();
  });

  it("当前文档有照片 → 裁剪立刻可用（不看'已保存详情'）", () => {
    // 关键：`documentHasPhoto` 只认当前文档。页面刚上传、还没保存时也必须为 true。
    const document = docWithPhoto(PHOTO);
    expect(documentHasPhoto(document)).toBe(true);
    renderTab(document);
    expect(
      screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) }),
    ).toBeEnabled();
  });

  it("移除照片：写回空 value，并在同一批里清掉指向旧图的裁剪参数", () => {
    const { onDocumentChange, onLayoutChange } = renderTab(docWithPhoto(PHOTO), layoutWith(true));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.remove")) }));
    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    const next = onDocumentChange.mock.calls[0][0] as ResumeDocument;
    expect(next.header.items.some((item) => item.key === "photo" && item.value !== "")).toBe(false);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect((onLayoutChange.mock.calls[0][0] as ResumeLayout).format_config).not.toHaveProperty(
      "photo_crop",
    );
  });

  it("不再提供「位置」下拉（5.3：照片位置固定为 photo）", () => {
    renderTab(docWithPhoto(PHOTO));
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
