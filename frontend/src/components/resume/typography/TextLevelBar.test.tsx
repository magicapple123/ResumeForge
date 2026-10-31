// SPDX-License-Identifier: Apache-2.0
/**
 * 文字级别（v2）：条目 id 来自 `entry.id`，作用范围由纸面路径的 **item placement** 推。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { TextLevelId } from "../../../features/resume-layout/textLevels";
import { readStyleDomains } from "../../../features/resume-layout/styleOverrides";
import { makeDocument } from "../../../features/resume-document/documentFixtures";
import TextLevelBar from "./TextLevelBar";

function baseLayout(): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    format_config: {},
  };
}

interface HarnessProps {
  pickedPath?: string | null;
  selected?: readonly { id: string; label?: string }[];
  selectedObjectId?: string | null;
  selectedLabel?: string;
  document?: ResumeDocument;
  initialLayout?: ResumeLayout;
}

function Harness({
  pickedPath = null,
  selected = [],
  selectedObjectId = null,
  selectedLabel,
  document,
  initialLayout,
}: HarnessProps) {
  const doc = document ?? makeDocument();
  const [layout, setLayout] = useState<ResumeLayout>(initialLayout ?? baseLayout());
  const [applied, setApplied] = useState<{ level: TextLevelId | null; count: number } | null>(null);
  return (
    <>
      <TextLevelBar
        layout={layout}
        document={doc}
        selected={selected}
        selectedObjectId={selectedObjectId}
        selectedLabel={selectedLabel}
        pickedPath={pickedPath}
        onChange={setLayout}
        onApplied={setApplied}
      />
      <output data-testid="applied">
        {applied ? `${applied.level ?? "inherit"}:${applied.count}` : ""}
      </output>
      <output data-testid="layout">{JSON.stringify(layout.format_config)}</output>
    </>
  );
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("layout").textContent ?? "{}") as Record<string, unknown>;
}

function domainsOf() {
  return readStyleDomains(readConfig() as never);
}

describe("TextLevelBar（v2）", () => {
  it("状态行指名当前条目与级别（Q13：不再只写「作用于 N 条」）", () => {
    render(
      <Harness
        selected={[{ id: "ob_entry001", label: "Tsinghua University" }]}
        selectedObjectId="ob_entry001"
        selectedLabel="Tsinghua University"
      />,
    );
    expect(
      screen.getByText(t("typography.level.status", { name: "Tsinghua University" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        t("typography.level.current", { level: t("typography.level.currentInherit") }),
      ),
    ).toBeInTheDocument();
    // 段控下方常驻范围说明：只靠标签解释不了"这次动了哪些字"。
    expect(screen.getByText(t("typography.level.scopeHint.object"))).toBeInTheDocument();
  });

  it("多选目标时状态行给数量；范围术语用「元信息（灰字）」", () => {
    render(
      <Harness
        selected={[{ id: "ob_entry001" }, { id: "ob_entry002" }]}
        selectedObjectId="ob_entry001"
      />,
    );
    expect(
      screen.getByText(
        t("typography.level.status", { name: t("typography.level.statusMany", { count: 2 }) }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("typography.level.scope.meta"))).toBeInTheDocument();
  });

  it("应用级别写到 format_config.objects[entry.id]（整个条目）并回调一次", () => {
    render(<Harness selected={[{ id: "ob_entry001" }]} selectedObjectId="ob_entry001" />);
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.heading2") }));
    const domains = domainsOf();
    expect(domains.objects.ob_entry001).toMatchObject({ font_scale: 1.2, bold: true });
    expect(screen.getByTestId("applied").textContent).toBe("heading2:1");
    expect(screen.getByRole("button", { name: t("typography.level.heading2") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("恢复跟随模板 = 删键（不写默认值）", () => {
    render(
      <Harness
        selected={[{ id: "ob_entry001" }]}
        selectedObjectId="ob_entry001"
        initialLayout={{
          ...baseLayout(),
          format_config: {
            objects: { ob_entry001: { font_scale: 1.2, bold: true } },
          } as unknown as ResumeLayout["format_config"],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.restore") }));
    expect(domainsOf().objects.ob_entry001).toBeUndefined();
    expect(screen.getByTestId("applied").textContent).toBe("inherit:1");
  });

  it("纸面路径是标题字段 → 作用范围默认「条目标题」，写入 object_roles", () => {
    render(
      <Harness
        pickedPath="education.ob_entry001.ob_item0001"
        selected={[{ id: "ob_entry001" }]}
        selectedObjectId="ob_entry001"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.heading3") }));
    expect(domainsOf().objectRoles["ob_entry001:entry_title"]).toMatchObject({ font_scale: 1.08 });
  });

  it("纸面路径是元信息字段 → 作用范围「元信息（灰字）」，只写该角色允许的两项", () => {
    render(
      <Harness
        pickedPath="education.ob_entry001.ob_item0003"
        selected={[{ id: "ob_entry001" }]}
        selectedObjectId="ob_entry001"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.heading1") }));
    const style = domainsOf().objectRoles["ob_entry001:meta"];
    expect(style).toMatchObject({ font_scale: 1.4, bold: true });
    expect(style.space_before).toBeUndefined();
    expect(style.space_after).toBeUndefined();
  });

  it("多选目标：一次应用写到每个条目（历史一步）", () => {
    render(
      <Harness
        selected={[{ id: "ob_entry001" }, { id: "ob_entry002" }]}
        selectedObjectId="ob_entry001"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.caption") }));
    const domains = domainsOf();
    expect(domains.objects.ob_entry001).toMatchObject({ font_scale: 0.9 });
    expect(domains.objects.ob_entry002).toMatchObject({ font_scale: 0.9 });
    expect(screen.getByTestId("applied").textContent).toBe("caption:2");
  });

  it("没有可作用的目标时给引导文案，而不是一排按不动的按钮", () => {
    render(<Harness />);
    expect(screen.getByText(t("typography.level.empty"))).toBeInTheDocument();
  });

  it("已是该级别时再点不制造空历史点", () => {
    render(
      <Harness
        selected={[{ id: "ob_entry001" }]}
        selectedObjectId="ob_entry001"
        initialLayout={{
          ...baseLayout(),
          format_config: {
            objects: {
              ob_entry001: { font_scale: 1.2, bold: true, space_before: 0.3, space_after: 0.15 },
            },
          } as unknown as ResumeLayout["format_config"],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.heading2") }));
    expect(screen.getByTestId("applied").textContent).toBe("");
  });
});
