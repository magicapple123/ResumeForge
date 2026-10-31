// SPDX-License-Identifier: Apache-2.0
/** P5-2：无法定位的旧关联提示条（逐条原因 + 删除/重新关联两个出口）。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../../features/resume-provenance/i18n";
import type { UnresolvedLinkOut } from "../../../features/resume-provenance/types";
import UnresolvedLinksCard from "./UnresolvedLinksCard";

const ITEM: UnresolvedLinkOut = {
  link_id: 77,
  source_id: 5,
  source_title: "旧台账来源",
  source_kind: "claim",
  object_id: null,
  point_id: null,
  path: "experience.9.description.0",
  field: "experience",
  reason: "target_missing",
};

function renderCard(overrides: Partial<React.ComponentProps<typeof UnresolvedLinksCard>> = {}) {
  const onDelete = vi.fn();
  const onRelink = vi.fn();
  const view = render(
    <AntdApp>
      <UnresolvedLinksCard
        items={[ITEM]}
        canRelink
        onDelete={onDelete}
        onRelink={onRelink}
        {...overrides}
      />
    </AntdApp>,
  );
  return { ...view, onDelete, onRelink };
}

afterEach(() => cleanup());

describe("UnresolvedLinksCard", () => {
  it("没有失效旧关联时不渲染任何东西", () => {
    const { container } = renderCard({ items: [] });
    expect(container.querySelector("[data-unresolved-links]")).toBeNull();
  });

  it("逐条展示来源/路径/原因，并给出两个出口", () => {
    renderCard();
    expect(screen.getByText(pt("provenance.unresolved.title", { count: 1 }))).toBeTruthy();
    expect(screen.getByText(ITEM.source_title)).toBeTruthy();
    expect(screen.getByText(ITEM.path)).toBeTruthy();
    expect(screen.getByText(pt("provenance.unresolved.reason.targetMissing"))).toBeTruthy();
    expect(screen.getByRole("button", { name: pt("provenance.unresolved.delete") })).toBeTruthy();
    expect(screen.getByRole("button", { name: pt("provenance.unresolved.relink") })).toBeTruthy();
  });

  it("未选中目标块时重新关联禁用并说明要先选块", () => {
    renderCard({ canRelink: false });
    const relink = screen.getByRole("button", {
      name: pt("provenance.unresolved.relink"),
    }) as HTMLButtonElement;
    expect(relink.disabled).toBe(true);
    expect(screen.getByText(pt("provenance.unresolved.relinkHint"))).toBeTruthy();
  });

  it("点重新关联只回调这一条，不自动挑目标块", () => {
    const { onRelink } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.unresolved.relink") }));
    expect(onRelink).toHaveBeenCalledTimes(1);
    expect(onRelink).toHaveBeenCalledWith(ITEM);
  });

  it("删除旧关联要二次确认，确认后回调", async () => {
    const { onDelete } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.unresolved.delete") }));
    await screen.findByText(pt("provenance.unresolved.deleteConfirmTitle"));
    expect(screen.getByText(pt("provenance.unresolved.deleteConfirmBody"))).toBeTruthy();
    const buttons = screen.getAllByRole("button", {
      name: pt("provenance.unresolved.delete"),
    });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onDelete).toHaveBeenCalledWith(ITEM);
  });

  it("未知原因码按原因未知显示，不编造具体原因", () => {
    renderCard({ items: [{ ...ITEM, reason: "something_new" }] });
    expect(screen.getByText(pt("provenance.unresolved.reason.unknown"))).toBeTruthy();
  });
});
