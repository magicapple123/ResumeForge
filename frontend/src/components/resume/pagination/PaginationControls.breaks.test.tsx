// SPDX-License-Identifier: Apache-2.0
/**
 * 分页设置区：**条目级断页清单**（看得见 / 逐条清得掉）与**分页意图 prune**。
 *
 * 从 `PaginationControls.test.tsx` 拆出（2026-11 行数预算）：这两支关心的是"指向条目的
 * 意图会不会丢/会不会残留"，与"全局板块分页方式 + 分组折叠"是两件事。夹具与查询辅助
 * 只有一份实现，在 `src/test/paginationControlsHarness.tsx`。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { t } from "../../../i18n";
import {
  cleanupPaginationPanel,
  ENTRY,
  last,
  layoutWith,
  paginationOf,
  renderPanel,
  SECTIONS,
} from "../../../test/paginationControlsHarness";

afterEach(cleanupPaginationPanel);

describe("PaginationControls · 条目级断页清单（看得见 / 逐条清得掉）", () => {
  const OTHER = { id: "prj_12345678", label: "Beta" };

  /**
   * 以前只有"选中这一条"时才看得见条目断页，而「恢复自然分页」明确不碰条目级——
   * 用户设过就再也找不到、也清不掉。这一组用例钉住"条目断页也在已设置清单里"。
   */
  it("只设了条目断页也会出现芯片区；没有板块断页时不显示「恢复自然分页」", () => {
    renderPanel({
      layout: layoutWith({
        version: 1,
        entries: { [ENTRY.id]: { break_before: "page" }, [OTHER.id]: { break_before: "page" } },
      }),
      sections: SECTIONS,
      entries: [ENTRY, OTHER],
    });
    const list = screen.getByTestId("pagination-section-breaks");
    expect(within(list).getByText(ENTRY.label)).toBeInTheDocument();
    expect(within(list).getByText(OTHER.label)).toBeInTheDocument();
    // 「恢复自然分页」只清板块级：没有板块断页时不渲染，避免"点了没反应"。
    expect(within(list).queryByRole("button", { name: t("pagination.breaks.restore") })).toBeNull();
    expect(within(list).getByText(t("pagination.breaks.entryHint"))).toBeInTheDocument();
  });

  it("点条目芯片的清除只删这一条的条目断页（板块断页原样保留）", () => {
    const onChange = renderPanel({
      layout: layoutWith({
        version: 1,
        entries: { [ENTRY.id]: { break_before: "page" }, [OTHER.id]: { break_before: "page" } },
        sections: { experience: { break_before: "page" } },
      }),
      sections: SECTIONS,
      entries: [ENTRY, OTHER],
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("pagination.breaks.clearEntry", { label: ENTRY.label }),
      }),
    );
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      entries: { [OTHER.id]: { break_before: "page" } },
      sections: { experience: { break_before: "page" } },
    });
  });

  it("条目已被删（entries 里查不到）：用兜底名字列出，仍然清得掉", () => {
    const onChange = renderPanel({
      layout: layoutWith({ version: 1, entries: { gone_12345678: { break_before: "page" } } }),
      sections: SECTIONS,
      entries: [ENTRY],
    });
    const list = screen.getByTestId("pagination-section-breaks");
    expect(within(list).getByText(t("pagination.breaks.unknownEntry"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("pagination.breaks.clearEntry", { label: t("pagination.breaks.unknownEntry") }),
      }),
    );
    // 清掉唯一一条后域整体消失（空域删键，不写回默认值）。
    expect(paginationOf(last(onChange))).toBeUndefined();
  });

  it("没选中条目但有板块清单：给出「去哪选一条」的指路（不静默消失）", () => {
    renderPanel({ sections: SECTIONS });
    expect(screen.getByText(t("pagination.entry.pick"))).toBeInTheDocument();
    cleanup();
    renderPanel({ sections: SECTIONS, entry: ENTRY });
    expect(screen.queryByText(t("pagination.entry.pick"))).toBeNull();
  });
});

describe("PaginationControls · 分页意图 prune（删掉的条目不再残留）", () => {
  it("改任意意图前先裁掉指向已删条目的残留", () => {
    const onChange = renderPanel({
      layout: layoutWith({
        version: 1,
        entries: { gone_12345678: { break_before: "page" }, [ENTRY.id]: { keep_with_next: 2 } },
      }),
      sections: SECTIONS,
      validEntryIds: [ENTRY.id],
      entry: ENTRY,
    });
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.continuation.pageNumbers") }));
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      entries: { [ENTRY.id]: { keep_with_next: 2 } },
      continuation: { page_numbers: true },
    });
  });

  it("板块清单为空时：板块键一个不裁，但条目仍按 id 清单裁（两侧各自独立判断）", () => {
    const onChange = renderPanel({
      layout: layoutWith({
        version: 1,
        entries: { gone_12345678: { break_before: "page" } },
        sections: { experience: { break_before: "page" } },
      }),
      // 没传 sections（只读宿主/还没拿到模板目录），但条目清单是"有值"的。
      validEntryIds: ["entry_12345678"],
    });
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.continuation.pageNumbers") }));
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      // 条目被裁（gone 不在清单里）；板块键原样保留（空清单不敢当"全删"）。
      sections: { experience: { break_before: "page" } },
      continuation: { page_numbers: true },
    });
  });

  it("条目 id 清单为空时也不裁（正文还没加载到宿主，不代表条目都被删了）", () => {
    const onChange = renderPanel({
      layout: layoutWith({ version: 1, entries: { entry_12345678: { break_before: "page" } } }),
      sections: SECTIONS,
      validEntryIds: [],
    });
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.continuation.pageNumbers") }));
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      entries: { entry_12345678: { break_before: "page" } },
      continuation: { page_numbers: true },
    });
  });
});
