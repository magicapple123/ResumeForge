// SPDX-License-Identifier: Apache-2.0
/**
 * DocumentEditor 基本信息 / 照片 chip 用例的共享脚手架。
 *
 * 2026-11-04（问题清单第二轮·问题 1）：DocumentEditor.header.test.tsx 触及 500 行预算，
 * 按豁免约定的到期日拆分——「标题布局 / chip 交互」留在 DocumentEditor.header.test.tsx，
 * 「照片 chip + 照片裁剪」拆到 DocumentEditor.photoCrop.test.tsx。渲染辅助、chip 查询与
 * 照片裁剪夹具只有这一份实现。
 *
 * `vi.mock` 声明仍留在各测试文件内（vitest 的 mock 注册是文件级的，同
 * trackerPageHarness.tsx 的说明），这里只放不含 mock 的纯脚手架。
 */
import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { t } from "../i18n";
import type { ResumeLayout } from "../types/resume";
import type { ResumeDocument } from "../types/resumeDocument";
import type { ResumeFormatConfig } from "../types/resumeFormat";
import { makeDocument } from "../features/resume/document/documentFixtures";
import {
  photoSha256,
  readPhotoCropFromFormatConfig,
  withPhotoCrop,
} from "../features/resume/preview/photoCrop";
import DocumentEditor from "../features/resume/editor/DocumentEditor";

export const PHOTO = "data:image/png;base64,iVBORw0KGgo=";
export const CUSTOM_NAME = "Expected city";

export function renderEditor(
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

export function lastDocument(onChange: ReturnType<typeof vi.fn>): ResumeDocument {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeDocument;
}

/** 页眉 chip 外壳（无障碍名 = `标签：值`）。 */
export function headerChip(labelKey: Parameters<typeof t>[0]): HTMLElement {
  const label = t(labelKey);
  return screen.getByRole("group", {
    name: (name: string) => name === label || name.startsWith(`${label}\uFF1A`),
  }) as HTMLElement;
}

export function mainButton(chip: HTMLElement): HTMLElement {
  return within(chip).getAllByRole("button")[0];
}

export function withPhoto(): ResumeDocument {
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

export function dragPayload() {
  return {
    dataTransfer: {
      setData: () => undefined,
      getData: () => "",
      dropEffect: "move",
      effectAllowed: "move",
    },
  };
}

export const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "standard",
  page_limit: 1,
  font_scale: "standard",
};

export function renderWithLayout(
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
export function cropOf(layout: ResumeLayout | undefined) {
  return readPhotoCropFromFormatConfig(layout?.format_config ?? null);
}

export function lastLayout(onLayoutChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onLayoutChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeLayout;
}

/** 一份"已裁过"的 format_config（写路径与产品同一个 helper）。 */
export function croppedConfig(rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }): ResumeFormatConfig {
  return withPhotoCrop(null, {
    version: 1,
    source: { sha256: photoSha256(PHOTO), width: 1200, height: 1600 },
    rect,
    aspect: "free",
  });
}
