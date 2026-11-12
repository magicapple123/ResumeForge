// SPDX-License-Identifier: Apache-2.0
/**
 * 中栏字段旁的**来源徽标**（#24 24E）。
 *
 * 钉三件事（就是本条的验收面）：
 * 1. **有标注 → 徽标出现**，且 `data-source` 是三档之一（`profile` / `ai` / `manual`），
 *    读屏名带来源词——徽标上的字很小，视觉之外的通道必须自解释；
 * 2. **没有标注 → 一颗徽标都不许有**（页眉字段、旧记录、自建板块都是这条路），
 *    绝不出现"未知来源"这种看起来有信息量、实际什么都没说的标签；
 * 3. **点开能看到来源原文**，正文复用 `FactAnnotationItem`（与证据面板同一条渲染件）。
 *
 * 走的是**真实宿主路径**：`FactSourceContext` → `ItemChip` → `FactSourceBadge`。
 * 只测 `FactSourceBadge` 单体会漏掉本条最容易写错的一环——v2 文档路径（`section.entryId.itemId`）
 * 与标注里的 v1 路径（`section.0.itemKey`）的映射；`education.0.school` 这种标注必须能被
 * `education.ob_entry001.ob_item0001` 这条 chip 路径命中。
 *
 * 本文件不含 CJK 字面量（棘轮对新增中文断言会红）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { FactAnnotation } from "../../../types";
import { fieldItem, makeDocument } from "./documentFixtures";
import { FactSourceContext } from "../editor/factSourceContext";
import ItemChip from "../editor/ItemChip";
import FactSourceBadge from "./FactSourceBadge";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** 一份真实形状的标注：`education.0.school`（后端 grounding 就写这种路径）。 */
function annotation(origin: FactAnnotation["origin"]): FactAnnotation {
  return {
    path: "education.0.school",
    origin,
    source_fact: "Source fact text",
  };
}

const ITEM = fieldItem({ id: "ob_item0001", key: "school", value: "Tsinghua University" });
const CHIP_PATH = "education.ob_entry001.ob_item0001";

/** 把 chip 挂在标注上下文里渲染（中栏的真实结构：Provider 在编辑器外面）。 */
function renderChip(annotations: readonly FactAnnotation[]) {
  const onChange = vi.fn();
  const view = render(
    <FactSourceContext.Provider value={annotations}>
      <ItemChip
        document={makeDocument()}
        path={CHIP_PATH}
        item={ITEM}
        selected={false}
        sectionKey="education"
        entryId="ob_entry001"
        onSelect={() => {}}
        onChange={onChange}
        onNotice={() => {}}
      />
    </FactSourceContext.Provider>,
  );
  return { ...view, onChange };
}

function sourceLabel(kind: FactAnnotation["origin"]): string {
  const key =
    kind === "grounded" || kind === "restored"
      ? "resume.factSource.profile"
      : kind === "user_added"
        ? "resume.factSource.manual"
        : "resume.factSource.ai";
  return t(key);
}

describe("FactSourceBadge · field source badge", () => {
  it("marks a grounded field as coming from the profile", () => {
    const { container } = renderChip([annotation("grounded")]);
    const badge = container.querySelector("[data-source]");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-source")).toBe("profile");
    expect(badge?.textContent).toBe(sourceLabel("grounded"));
    // 读屏名必须把来源词说全（视觉徽标只有三个字）。
    expect(
      screen.getByRole("button", {
        name: t("resume.factSource.aria", { source: sourceLabel("grounded") }),
      }),
    ).toBeInTheDocument();
  });

  it("maps AI-written and manually typed content to their own kinds", () => {
    const ai = renderChip([annotation("ai_rewrite")]);
    expect(ai.container.querySelector("[data-source]")?.getAttribute("data-source")).toBe("ai");
    cleanup();
    const manual = renderChip([annotation("user_added")]);
    expect(manual.container.querySelector("[data-source]")?.getAttribute("data-source")).toBe(
      "manual",
    );
  });

  it("renders no badge at all when the field has no annotation", () => {
    // 空表 = 旧记录 / 页眉字段 / 自建板块：宁可没有徽标，也不许出现"未知"。
    const { container } = renderChip([]);
    expect(container.querySelector("[data-source]")).toBeNull();
    // 只有一条其它字段的标注时同样不显示：映射是按路径来的，不是"有标注就挂一颗"。
    const other = renderChip([{ path: "summary", origin: "grounded" }]);
    expect(other.container.querySelector("[data-source]")).toBeNull();
  });

  it("opens the source text when clicked", async () => {
    renderChip([annotation("grounded")]);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("resume.factSource.aria", { source: sourceLabel("grounded") }),
      }),
    );
    expect(
      await screen.findByText(t("resume.evidence.basis", { fact: "Source fact text" })),
    ).toBeInTheDocument();
  });

  it("keeps the badge outside the chip's clickable button", () => {
    // 徽标是 `.document-chip-main` 的**兄弟**：主按钮是"选中 / 双击展开"的热区，
    // 把徽标塞进按钮会连带改变它的可点区域（本条明令不许）。
    const { container } = renderChip([annotation("grounded")]);
    const main = container.querySelector(".document-chip-main");
    expect(main?.querySelector("[data-source]")).toBeNull();
  });
});

describe("FactSourceBadge · standalone", () => {
  it("falls back to the raw annotation path when no document is given", async () => {
    render(<FactSourceBadge annotation={annotation("ai_rewrite")} />);
    fireEvent.click(screen.getByRole("button"));
    // 没有文档就没有"人话路径"可翻；来源原文仍然要给（这是"点开能看来源原文"的底线）。
    expect(
      await screen.findByText(t("resume.evidence.basis", { fact: "Source fact text" })),
    ).toBeInTheDocument();
  });
});
