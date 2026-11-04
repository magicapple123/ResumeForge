// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台左栏「获取分页报告」的**请求体**：`page_limit=0`（不限篇幅）必须原样发 0。
 *
 * 旧写法 `Number(layout.page_limit) || 1` 把不限折成 1 页：面板按 1 页排，屏幕上
 * "实际 1 页"、导出却是完整多页——用户看到的是一个自相矛盾的产品。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  request: clientMocks.request,
}));

import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import type { ResumeDocument } from "../../types/resumeDocument";
import { makeResumeDocument } from "../../test/documentHarness";
import WorkbenchParamsColumnV2 from "./WorkbenchParamsColumnV2";

function layout(pageLimit: number): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: pageLimit,
    font_scale: "standard",
    format_config: {} as ResumeLayout["format_config"],
  };
}

function Harness({ pageLimit, documentMode }: { pageLimit: number; documentMode?: "resume" }) {
  const previewRef = useRef<ResumePreviewHandle>(null);
  const [document] = useState<ResumeDocument>(() => makeResumeDocument());
  return (
    <WorkbenchParamsColumnV2
      layout={layout(pageLimit)}
      baseline={layout(pageLimit)}
      relayouting={false}
      previewRef={previewRef}
      tier="three"
      editorEnabled
      resumeId={7}
      revision={1}
      documentMode={documentMode}
      onChange={vi.fn()}
      document={document}
      onDocumentChange={vi.fn()}
      pagesNeeded={null}
    />
  );
}

/** 点缩略图条上的「获取分页报告」——它触发的就是本组件注册的那一次请求。 */
async function clickGetReport() {
  const buttons = await screen.findAllByRole("button", {
    name: t("pagination.thumbnails.refresh"),
  });
  fireEvent.click(buttons[0]);
}

function sentBody(): Record<string, unknown> {
  const call = clientMocks.request.mock.calls.find((item) =>
    String(item[0]).endsWith("/pagination/report"),
  );
  const init = call?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  clientMocks.request.mockReset();
  clientMocks.request.mockResolvedValue({
    pages: 3,
    pages_needed: 3,
    overflow: false,
    page_limit: 10,
    page_limit_is_unlimited: true,
    truncated_at: null,
    manual_breaks: [],
    warnings: [],
    snapshot: { content_sha256: "c".repeat(64), render_config_sha256: "r".repeat(64) },
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("WorkbenchParamsColumnV2 · 分页请求的 page_limit", () => {
  it("layout.page_limit=0（不限）→ 请求体发 0，不折成 1", async () => {
    render(
      <AntdApp>
        <Harness pageLimit={0} documentMode="resume" />
      </AntdApp>,
    );
    await clickGetReport();
    await waitFor(() =>
      expect(
        clientMocks.request.mock.calls.some((item) =>
          String(item[0]).endsWith("/pagination/report"),
        ),
      ).toBe(true),
    );
    expect(sentBody()["page_limit"]).toBe(0);
  });

  it("有上限时照旧发正数（不受「不限」改动影响）", async () => {
    render(
      <AntdApp>
        <Harness pageLimit={3} documentMode="resume" />
      </AntdApp>,
    );
    await clickGetReport();
    await waitFor(() =>
      expect(
        clientMocks.request.mock.calls.some((item) =>
          String(item[0]).endsWith("/pagination/report"),
        ),
      ).toBe(true),
    );
    expect(sentBody()["page_limit"]).toBe(3);
  });
});
