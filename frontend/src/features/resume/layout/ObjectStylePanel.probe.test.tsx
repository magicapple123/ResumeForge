// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目排版」面板的第二组测试：探针落点（Q14）、对象层写入不回归、分组手风琴（I-21）。
 *
 * 从 `ObjectStylePanel.test.tsx` 拆出来：原文件 561 行，超过 500 行硬闸门。
 * 共享 fixture 在 `ObjectStylePanel.testkit.tsx`。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import { makePreviewRef } from "./ResumeLayoutControls.testkit";
import { registerLiveProbe } from "../preview/liveProbeRegistry";
import { readStyleDomains } from "./styleOverrides";
import {
  LAYOUT,
  OBJECT_ID,
  OTHER_ID,
  editableEntry,
  lastLayout,
  renderPanel,
  rowTestId,
} from "./ObjectStylePanel.testkit";
import ObjectStylePanel from "./ObjectStylePanel";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ObjectStylePanel · 探针与固定（Q14）", () => {
  it("缩进探针落到 ul / .body-paragraph（不是条目根）", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const layout = {
      ...LAYOUT,
      format_config: {
        ...LAYOUT.format_config,
        objects: { version: 1, [OBJECT_ID]: { indent: 0.5 } },
      },
    } as unknown as ResumeLayout;
    renderPanel({ previewRef: ref, layout });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
      }),
    );
    expect(setLiveProbe).toHaveBeenCalledWith(
      `  [data-object-id="${OBJECT_ID}"] ul, [data-object-id="${OBJECT_ID}"] .body-paragraph { padding-left: calc(var(--fs) * 0.55) !important; }`,
    );
  });

  it("固定当前样式按当前作用范围回调宿主", () => {
    const onFreeze = vi.fn();
    renderPanel({ onFreeze });
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.freeze") }));
    expect(onFreeze).toHaveBeenCalledWith("object");
    fireEvent.click(screen.getByText(t("typography.entryStyle.scope.body")));
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.freeze") }));
    expect(onFreeze).toHaveBeenLastCalledWith("body");
  });

  /**
   * I-15：`setLiveProbe` 是**单条覆盖**。先调缩进再调行距，若不做累积，第二条会把
   * 第一条顶掉（表现：刚调好的缩进在 600ms 内回退）。
   */
  it("探针按属性累积：连调两项后两条规则都在", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    renderPanel({ previewRef: ref });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.line_height") }),
      }),
    );
    const calls = setLiveProbe.mock.calls;
    const last = calls[calls.length - 1]?.[0] as string;
    expect(last).toContain("padding-left");
    expect(last).toContain("line-height");
  });

  /**
   * I-15 的主症结：唯一的生产调用点（右键浮层）没有 `previewRef`，探针一次都没注入过。
   * 没有 ref 时必须回落到登记处，而不是静默什么都不做。
   */
  it("没有 previewRef 时探针走登记处（不静默失效）", () => {
    const writer = vi.fn();
    const unregister = registerLiveProbe(writer);
    try {
      renderPanel();
      fireEvent.click(
        screen.getByRole("button", {
          name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
        }),
      );
      expect(writer).toHaveBeenCalled();
      const probeCalls = writer.mock.calls;
      expect(String(probeCalls[probeCalls.length - 1]?.[0])).toContain("padding-left");
    } finally {
      unregister();
    }
  });

  /** 换目标 / 卸载：上一个对象的探针必须撤掉（否则旧规则与正式样式"双份"）。 */
  it("切换目标对象时清空探针", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const { rerender } = render(
      <AntdApp>
        <ObjectStylePanel
          layout={LAYOUT}
          catalog={TEMPLATE_CATALOG}
          objectId={OBJECT_ID}
          objectLabel="Star River"
          entry={editableEntry()}
          previewRef={ref}
          onChange={vi.fn()}
        />
      </AntdApp>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
      }),
    );
    rerender(
      <AntdApp>
        <ObjectStylePanel
          layout={LAYOUT}
          catalog={TEMPLATE_CATALOG}
          objectId={OTHER_ID}
          objectLabel="Other"
          entry={editableEntry({ id: OTHER_ID })}
          previewRef={ref}
          onChange={vi.fn()}
        />
      </AntdApp>,
    );
    expect(setLiveProbe).toHaveBeenLastCalledWith("");
  });
});

describe("ObjectStylePanel · 对象层写入（既有行为不回归）", () => {
  it("改一个属性只写 objects[该条]，角色覆盖与其它条目不丢", async () => {
    const layout = {
      ...LAYOUT,
      format_config: {
        ...LAYOUT.format_config,
        objects: {
          version: 1,
          [OTHER_ID]: { bullet: "none" },
          [OBJECT_ID]: { indent: 0.5 },
        },
      },
    } as unknown as ResumeLayout;
    const onChange = renderPanel({ layout });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const domains = readStyleDomains(lastLayout(onChange).format_config);
    expect(domains.objects[OBJECT_ID]).toMatchObject({ indent: 0.55 });
    expect(domains.objects[OTHER_ID]).toEqual({ bullet: "none" });
    expect(domains.roles.body).toEqual({ line_height: 1.55 });
  });
});

/**
 * I-21：右键浮层里的分组手风琴。
 *
 * 判据三条——① 默认只展开一组，其余组头可见、内容收起；② 展开另一组时前一组自动收起
 * （高度不累积）；③ 分组口径与 `objectStyleGroups.ts` 一致（文案 + 组内属性）。
 * 高度本身在真浏览器里量（jsdom 没有布局），这里只钉"同一时刻只有一组的内容在 DOM 里"。
 */
describe("ObjectStylePanel · 分组手风琴（I-21）", () => {
  const groupHead = (id: string) => screen.getByTestId(`style-group-${id}`);
  const openGroups = () => globalThis.document.querySelectorAll(".resume-typography-group.is-open");

  it("默认只展开第一组：四个组头都在，只有该组的行渲染", () => {
    renderPanel({ collapsibleGroups: true });
    expect(groupHead("text")).toHaveAttribute("aria-expanded", "true");
    for (const id of ["spacing", "list", "meta"]) {
      expect(groupHead(id)).toHaveAttribute("aria-expanded", "false");
    }
    expect(globalThis.document.querySelector(rowTestId("color"))).not.toBeNull();
    expect(globalThis.document.querySelector(rowTestId("line_height"))).toBeNull();
    expect(globalThis.document.querySelector(rowTestId("letter_spacing"))).toBeNull();
  });

  it("展开另一组 → 前一组自动收起，DOM 里始终只有一组内容", () => {
    renderPanel({ collapsibleGroups: true });
    fireEvent.click(groupHead("spacing"));
    expect(groupHead("spacing")).toHaveAttribute("aria-expanded", "true");
    expect(groupHead("text")).toHaveAttribute("aria-expanded", "false");
    expect(openGroups()).toHaveLength(1);
    expect(globalThis.document.querySelector(rowTestId("color"))).toBeNull();
    expect(globalThis.document.querySelector(rowTestId("line_height"))).not.toBeNull();
    expect(globalThis.document.querySelector(rowTestId("indent"))).not.toBeNull();

    fireEvent.click(groupHead("list"));
    expect(openGroups()).toHaveLength(1);
    expect(globalThis.document.querySelector(rowTestId("line_height"))).toBeNull();
    expect(globalThis.document.querySelector(rowTestId("bullet"))).not.toBeNull();
    expect(globalThis.document.querySelector(rowTestId("align"))).not.toBeNull();
  });

  it("组头文案与分组口径：文字与颜色 / 行距与缩进 / 列表与对齐 / 日期与字距", () => {
    renderPanel({ collapsibleGroups: true });
    for (const [id, key] of [
      ["text", "typography.objectGroup.text"],
      ["spacing", "typography.objectGroup.spacing"],
      ["list", "typography.objectGroup.list"],
      ["meta", "typography.objectGroup.meta"],
    ] as const) {
      expect(groupHead(id)).toHaveTextContent(t(key));
    }
    fireEvent.click(groupHead("meta"));
    expect(globalThis.document.querySelector(rowTestId("meta_align"))).not.toBeNull();
    expect(globalThis.document.querySelector(rowTestId("letter_spacing"))).not.toBeNull();
  });

  it("左栏（不分组的宿主）仍然平铺：没有组头，7 行都在", () => {
    renderPanel();
    expect(screen.queryByTestId("style-group-text")).toBeNull();
    for (const prop of [
      "color",
      "line_height",
      "indent",
      "bullet",
      "align",
      "meta_align",
      "letter_spacing",
    ]) {
      expect(globalThis.document.querySelector(rowTestId(prop))).not.toBeNull();
    }
  });
});
