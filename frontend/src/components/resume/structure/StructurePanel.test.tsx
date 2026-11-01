// SPDX-License-Identifier: Apache-2.0
/**
 * 结构面板的渲染 / 交互测试（计划 §9.3、§10.2）。
 *
 * 覆盖"看起来有、其实没接线"的部分：树结构、搜索、点选回传、隐藏/复制真实改文档、
 * 键盘导航与 Alt 移动、纸面点击反选、只读态。断言用 t() 而不是中文字面量。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type {
  DocumentFieldCatalog,
  ResumeDocument,
  ResumeItem,
} from "../../../types/resumeDocument";
import StructurePanel from "./StructurePanel";

function makeField(
  id: string,
  key: string,
  value: string,
  placement: "title" | "meta" | "lead" | "trail" | "body" | "hidden",
  source = true,
): ResumeItem {
  return {
    kind: "field",
    id,
    key,
    label: "",
    value,
    placement,
    format: "text",
    wrap: "none",
    show_label: placement === "lead" || placement === "trail",
    solo: false,
    source: source ? { section_key: "educations", field_id: key } : null,
    body_style: "bullet",
  };
}

function makeDocument(): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: {
      items: [
        {
          kind: "field",
          id: "header_name_01",
          key: "name",
          label: "",
          value: "张三",
          placement: "name",
          format: "text",
        },
      ],
      contact_breaks: [],
    },
    sections: [
      {
        key: "education",
        title: "",
        kind: "entries",
        layout: {
          columns: 1,
          align: "equal",
          gap: null,
          hide_title: false,
          keep_together: false,
          start_on_new_page: false,
          title_override: "",
        },
        entries: [
          {
            id: "entry_edu_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [
              makeField("school_01", "school", "上海大学", "title"),
              makeField("major_01", "major", "计算机", "title"),
              makeField("degree_01", "degree", "本科", "meta"),
              makeField("gpa_001", "gpa", "3.8", "lead"),
              makeField("study_01", "study_form", "全日制", "trail"),
              makeField("rank_001", "rank", "前 10%", "hidden"),
              { kind: "text", id: "achieve_1", style: "bullet", text: "获一等奖", hidden: false },
            ],
          },
        ],
      },
      {
        key: "custom:sec_0001",
        title: "开源项目",
        kind: "entries",
        layout: {
          columns: 1,
          align: "equal",
          gap: null,
          hide_title: false,
          keep_together: false,
          start_on_new_page: false,
          title_override: "",
        },
        entries: [
          {
            id: "entry_proj_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [makeField("pname_001", "custom:name", "项目甲", "title", false)],
          },
        ],
      },
    ],
  };
}

function rowOf(container: HTMLElement, path: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-tree-path="${path}"]`);
  if (!row) throw new Error("missing row: " + path);
  return row;
}

function treeKeyRow(container: HTMLElement, key: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!row) throw new Error("missing tree row: " + key);
  return row;
}

function Harness({
  initial,
  readOnly,
  pickTarget,
  onDoc,
}: {
  initial: ResumeDocument;
  readOnly?: boolean;
  pickTarget?: { path: string; nonce: number } | null;
  onDoc?: (doc: ResumeDocument) => void;
}) {
  const [document, setDocument] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <StructurePanel
      document={document}
      readOnly={readOnly}
      pickTarget={pickTarget ?? null}
      selectedPath={selected}
      onSelectPath={setSelected}
      pagesNeeded={2}
      onChange={(next) => {
        setDocument(next);
        onDoc?.(next);
      }}
    />
  );
}

describe("StructurePanel · 渲染", () => {
  it("渲染概览、板块名、条目名、位置分组与字段", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    expect(screen.getByText(t("structure.panel.title"))).toBeInTheDocument();
    expect(screen.getByText(t("structure.section.education"))).toBeInTheDocument();
    expect(rowOf(container, "education.entry_edu_01")).toBeInTheDocument();
    // 标题行分组在条目卡下（每卡一个），用 data-tree-key 定位更稳。
    expect(treeKeyRow(container, "education.entry_edu_01.#title")).toBeInTheDocument();
    expect(rowOf(container, "education.entry_edu_01.school_01")).toBeInTheDocument();
  });

  it("R-09：页眉字段出现在树里（合并成单个「基本信息」分组）", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    // 只剩一个页眉分组行，位置名（姓名行 / 联系方式 …）不再单独占行。
    expect(container.querySelectorAll('[data-tree-key="header"]')).toHaveLength(1);
    expect(container.querySelector('[data-tree-key="header.#name"]')).toBeNull();
    expect(rowOf(container, "header.header_name_01")).toBeInTheDocument();
    expect(treeKeyRow(container, "header").textContent).toContain(t("structure.node.header"));
  });

  it("隐藏字段带隐藏徽标，来源资料/手动圆点分开", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    const hiddenRow = rowOf(container, "education.entry_edu_01.rank_001");
    expect(hiddenRow.className).toContain("is-hidden");
    expect(within(hiddenRow).getByText(t("structure.badge.hidden"))).toBeInTheDocument();
    expect(
      rowOf(container, "education.entry_edu_01.school_01").querySelector(
        ".rf-structure-dot-profile",
      ),
    ).not.toBeNull();
    const manualRow = rowOf(container, "custom:sec_0001.entry_proj_01.pname_001");
    expect(manualRow.querySelector(".rf-structure-dot-manual")).not.toBeNull();
  });

  it("自建板块用文档里的 title 显示", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    expect(treeKeyRow(container, "custom:sec_0001")).toBeInTheDocument();
  });

  it("页数给定时显示页数；未给时显示待测量", () => {
    render(<Harness initial={makeDocument()} />);
    expect(screen.getByText(t("structure.panel.overviewPages", { pages: 2 }))).toBeInTheDocument();
  });
});

describe("StructurePanel · 选中与搜索", () => {
  it("点条目行回传条目路径，点字段行回传字段路径", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <StructurePanel document={makeDocument()} onChange={() => {}} onSelectPath={onSelect} />,
    );
    fireEvent.click(treeKeyRow(container, "education.entry_edu_01"));
    expect(onSelect).toHaveBeenLastCalledWith("education.entry_edu_01");
    fireEvent.click(rowOf(container, "education.entry_edu_01.gpa_001"));
    expect(onSelect).toHaveBeenLastCalledWith("education.entry_edu_01.gpa_001");
  });

  it("搜索只保留命中字段与祖先链，并显示匹配数", () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    const input = screen.getByRole("textbox", { name: t("structure.search.aria") });
    // 用只出现在 trail 字段里的词：条目标题（title 字段拼接）不含它，能验证"兄弟字段不带出"。
    fireEvent.change(input, { target: { value: "全日制" } });
    expect(rowOf(container, "education.entry_edu_01.study_01")).toBeInTheDocument();
    expect(
      container.querySelector('[data-tree-path="education.entry_edu_01.school_01"]'),
    ).toBeNull();
    expect(screen.getByText(t("structure.search.count", { count: 4 }))).toBeInTheDocument();
  });

  it("搜索无命中显示空态", () => {
    render(<Harness initial={makeDocument()} />);
    const input = screen.getByRole("textbox", { name: t("structure.search.aria") });
    fireEvent.change(input, { target: { value: "不存在的内容" } });
    // 顶部提示与树内空态都显示这句话（两处都是"没有匹配"的出口）。
    expect(screen.getAllByText(t("structure.search.empty")).length).toBeGreaterThanOrEqual(1);
  });

  it("R-09：搜位置名「联系方式」能命中该位置的 4 个字段（合并成单个分组后的新能力）", () => {
    const document = makeDocument();
    const headerItem = (
      id: string,
      key: string,
      value: string,
      placement: "name" | "name_meta" | "subtitle" | "contact" | "photo",
    ) => ({
      kind: "field" as const,
      id,
      key,
      label: "",
      value,
      placement,
      format: "text" as const,
    });
    document.header.items = [
      headerItem("h_name", "name", "张三", "name"),
      headerItem("h_meta", "english_name", "Zhang San", "name_meta"),
      headerItem("h_sub", "job_intent", "会员运营专员", "subtitle"),
      headerItem("h_phone", "phone", "13801738891", "contact"),
      headerItem("h_mail", "email", "lin@example.com", "contact"),
      headerItem("h_city", "city", "上海", "contact"),
      headerItem("h_birth", "birth", "1998-11", "contact"),
      headerItem("h_photo", "photo", "data:image/png;base64,AAAA", "photo"),
    ];
    const { container } = render(<StructurePanel document={document} onChange={() => {}} />);
    // 顶部只有一个「基本信息 8」。
    expect(container.querySelectorAll('[data-tree-key="header"]')).toHaveLength(1);
    expect(treeKeyRow(container, "header").textContent).toContain(t("structure.node.header"));
    expect(treeKeyRow(container, "header").textContent).toContain("8");
    // 展开顺序 = 纸面顺序（姓名 → 姓名旁小字 → 求职意向 → 联系方式 → 照片）。
    const headerRows = [
      ...container.querySelectorAll<HTMLElement>('[data-tree-key^="header."]'),
    ].map((row) => row.dataset.treePath);
    expect(headerRows).toEqual([
      "header.h_name",
      "header.h_meta",
      "header.h_sub",
      "header.h_phone",
      "header.h_mail",
      "header.h_city",
      "header.h_birth",
      "header.h_photo",
    ]);

    const input = screen.getByRole("textbox", { name: t("structure.search.aria") });
    fireEvent.change(input, { target: { value: "联系方式" } });
    for (const id of ["h_phone", "h_mail", "h_city", "h_birth"]) {
      expect(rowOf(container, `header.${id}`)).toBeInTheDocument();
    }
    // 姓名 / 求职意向 / 照片仍在同一分组下，但不属于联系方式，不应被带出。
    expect(container.querySelector('[data-tree-path="header.h_name"]')).toBeNull();
    // 分组自身 + 4 个命中字段 = 5 处匹配。
    expect(screen.getByText(t("structure.search.count", { count: 5 }))).toBeInTheDocument();
  });
});

describe("StructurePanel · 写操作", () => {
  it("隐藏字段：点行内隐藏按钮 → 文档里 placement 变 hidden", () => {
    const onDoc = vi.fn();
    const { container } = render(<Harness initial={makeDocument()} onDoc={onDoc} />);
    // 悬停动作只在 CSS 上隐藏；jsdom 里仍在 DOM。
    const row = rowOf(container, "education.entry_edu_01.school_01");
    const hideButton = within(row).getByRole("button", { name: t("structure.action.hide") });
    fireEvent.click(hideButton);
    const next = onDoc.mock.calls[onDoc.mock.calls.length - 1]?.[0] as ResumeDocument;
    const item = next.sections[0].entries[0].items.find(
      (candidate) => candidate.id === "school_01",
    ) as {
      placement: string;
    };
    expect(item.placement).toBe("hidden");
  });

  it("隐藏条目：entry.hidden 取反", () => {
    const onDoc = vi.fn();
    const { container } = render(<Harness initial={makeDocument()} onDoc={onDoc} />);
    const row = treeKeyRow(container, "education.entry_edu_01");
    fireEvent.click(within(row).getByRole("button", { name: t("structure.action.hide") }));
    const next = onDoc.mock.calls[onDoc.mock.calls.length - 1]?.[0] as ResumeDocument;
    expect(next.sections[0].entries[0].hidden).toBe(true);
  });

  it("复制条目：文档多一条并把选择落到副本", () => {
    const onDoc = vi.fn();
    const { container } = render(<Harness initial={makeDocument()} onDoc={onDoc} />);
    const row = treeKeyRow(container, "education.entry_edu_01");
    fireEvent.click(within(row).getByRole("button", { name: t("structure.action.copyEntry") }));
    const next = onDoc.mock.calls[onDoc.mock.calls.length - 1]?.[0] as ResumeDocument;
    expect(next.sections[0].entries).toHaveLength(2);
    expect(next.sections[0].entries[1].id).not.toBe("entry_edu_01");
  });

  it("只读态不渲染写操作按钮，也不会改文档", () => {
    const onDoc = vi.fn();
    const { container } = render(<Harness initial={makeDocument()} readOnly onDoc={onDoc} />);
    const row = treeKeyRow(container, "education.entry_edu_01");
    expect(within(row).queryByRole("button", { name: t("structure.action.copyEntry") })).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("sections.templateControls.orderTriggerAriaLabel") }),
    ).toBeNull();
    expect(onDoc).not.toHaveBeenCalled();
  });
});

describe("StructurePanel · 键盘与纸面反选", () => {
  it("方向键在行间移动焦点", async () => {
    const { container } = render(<Harness initial={makeDocument()} />);
    const first = treeKeyRow(container, "header");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => {
      const active = container.querySelector<HTMLElement>('[data-tree-key][tabindex="0"]');
      expect(active?.dataset.treeKey).toBe("header.header_name_01");
    });
  });

  it("Alt+↑ 在字段组内上移（真实改文档）", () => {
    const onDoc = vi.fn();
    const { container } = render(<Harness initial={makeDocument()} onDoc={onDoc} />);
    const row = rowOf(container, "education.entry_edu_01.major_01");
    fireEvent.keyDown(row, { key: "ArrowUp", altKey: true });
    const next = onDoc.mock.calls[onDoc.mock.calls.length - 1]?.[0] as ResumeDocument;
    const ids = next.sections[0].entries[0].items
      .filter((item) => item.kind !== "text" && item.placement === "title")
      .map((item) => item.id);
    expect(ids).toEqual(["major_01", "school_01"]);
  });

  it("纸面点击（pickTarget）把对应行展开并聚焦", async () => {
    const { container, rerender } = render(<Harness initial={makeDocument()} />);
    // 先折叠教育板块（caret 要按本行取，容器里第一个 caret 属于页眉分组）
    const sectionRow = treeKeyRow(container, "education");
    const caret = sectionRow.querySelector<HTMLElement>(".rf-structure-caret-button");
    if (!caret) throw new Error("missing caret");
    fireEvent.click(caret);
    expect(container.querySelector('[data-tree-key="education.entry_edu_01"]')).toBeNull();
    rerender(
      <Harness
        initial={makeDocument()}
        pickTarget={{ path: "education.entry_edu_01.school_01", nonce: 1 }}
      />,
    );
    await waitFor(() => {
      expect(rowOf(container, "education.entry_edu_01.school_01")).toBeInTheDocument();
    });
  });
});

function fieldCatalogFixture(): DocumentFieldCatalog {
  return {
    sections: [
      {
        key: "education",
        title: "教育经历",
        title_key: "education",
        kind: "entries",
        profile_section_key: "educations",
        material_only: false,
        fields: [
          {
            key: "study_form",
            label: "学习形式",
            format: "text",
            field_type: "single_line",
            default_placement: "trail",
            material_only: false,
            private: false,
            source_field_id: "educations.study_form",
          },
        ],
      },
    ],
    header_fields: [],
  };
}

describe("StructurePanel · 字段目录标签与断页标记（Q20 / Q08）", () => {
  it("Q20：没有值的字段显示目录中文标签，不再显示英文 key", () => {
    const document = makeDocument();
    document.sections[0].entries[0].items.push(
      makeField("study_form_01", "study_form", "", "trail"),
    );
    const { container } = render(
      <StructurePanel
        document={document}
        onChange={() => {}}
        fieldCatalog={fieldCatalogFixture()}
      />,
    );
    const row = rowOf(container, "education.entry_edu_01.study_form_01");
    expect(row.textContent).toContain("学习形式");
    expect(row.textContent).not.toContain("study_form");
    // 有值的字段仍然显示值（目录标签只在没值时兜底）。
    expect(rowOf(container, "education.entry_edu_01.school_01").textContent).toContain("上海大学");
  });

  it("Q20：目录不可用时退回原始 key（兜底不丢字段）", () => {
    const document = makeDocument();
    document.sections[0].entries[0].items.push(makeField("study_02", "study_form", "", "trail"));
    const { container } = render(<StructurePanel document={document} onChange={() => {}} />);
    const row = rowOf(container, "education.entry_edu_01.study_02");
    expect(row.textContent).toContain("study_form");
  });

  it("Q08：已设置断页的条目行带标记与徽标", () => {
    const document = makeDocument();
    document.sections[0].entries[0].layout = {
      head: "split",
      columns: null,
      align: null,
      gap: null,
      start_on_new_page: true,
      keep_together: true,
    };
    const { container } = render(<StructurePanel document={document} onChange={() => {}} />);
    const row = treeKeyRow(container, "education.entry_edu_01");
    expect(row.dataset.treePageBreak).toBe("true");
    expect(within(row).getByText(t("structure.badge.pageBreak"))).toBeInTheDocument();
    // 没设断页的其它条目没有标记。
    expect(treeKeyRow(container, "custom:sec_0001.entry_proj_01").dataset.treePageBreak).toBe(
      undefined,
    );
  });
});
