// SPDX-License-Identifier: Apache-2.0
/**
 * 详情抽屉的内容契约：空值不占位、元信息在标题下、章节层级不靠字号。
 *
 * 这里只钉组件本身的行为——六个使用方的业务语义由各自的测试覆盖。
 * 注意：`Drawer` 的内容渲染在 portal 里（挂在 `document.body`），不在 `render()`
 * 返回的容器里，所以断言一律走 `document`。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecordDetailDrawer } from "./RecordDetail";
import { t } from "../../i18n";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const noop = () => undefined;

describe("RecordDetailDrawer 内容契约", () => {
  it("字段/章节为空串或纯空白时整行不渲染，undefined 同样", () => {
    render(
      <RecordDetailDrawer
        open
        title="某条记录"
        fields={[
          { label: "有值", value: "真实内容" },
          { label: "空串", value: "" },
          { label: "空白", value: "   " },
          { label: "缺省", value: undefined },
        ]}
        sections={[
          { title: "空正文", content: "" },
          { title: "空白正文", content: "  " },
        ]}
        onClose={noop}
      />,
    );

    expect(document.body.textContent).toContain("真实内容");
    expect(document.body.textContent).not.toContain("空串");
    expect(document.body.textContent).not.toContain("空正文");
    expect(document.querySelectorAll(".record-detail-field")).toHaveLength(1);
    expect(document.querySelectorAll(".record-detail-section")).toHaveLength(0);
  });

  it("meta 出现在标题下方，且不占字段行", () => {
    render(
      <RecordDetailDrawer
        open
        title="某条记录"
        meta="2026-11-13 18:29 更新 · 附件（2）"
        fields={[{ label: "有值", value: "真实内容" }]}
        onClose={noop}
      />,
    );

    const meta = document.querySelector(".record-detail-meta");
    expect(meta?.textContent).toContain("2026-11-13 18:29 更新");
    expect(document.querySelectorAll(".record-detail-field")).toHaveLength(1);
  });

  it("只有一条章节时不出现多余分隔线，两条时有且仅有一条", () => {
    const { rerender } = render(
      <RecordDetailDrawer
        open
        title="某条记录"
        sections={[{ title: "正文", content: "第一段" }]}
        onClose={noop}
      />,
    );
    expect(document.querySelectorAll(".ant-divider")).toHaveLength(0);

    rerender(
      <RecordDetailDrawer
        open
        title="某条记录"
        sections={[
          { title: "正文", content: "第一段" },
          { title: "备注", content: "第二段" },
        ]}
        onClose={noop}
      />,
    );
    expect(document.querySelectorAll(".ant-divider")).toHaveLength(1);
  });

  it("字段与章节都为空时给出空态，而不是一屏空白", () => {
    render(
      <RecordDetailDrawer
        open
        title="某条记录"
        fields={[{ label: "空串", value: "" }]}
        sections={[{ title: "空", content: "" }]}
        onClose={noop}
      />,
    );
    expect(document.body.textContent).toContain(t("common.recordDetail.empty"));
  });
});
