// SPDX-License-Identifier: Apache-2.0
/**
 * W07-TL「文字级别」工具条：显示当前级别、单选/多选套用、一次提交、恢复跟随模板。
 *
 * 断言文案一律走 `t()`（cjkRatchet 的 tests 口径逐文件卡中文 `*ByText`）；宿主用最小
 * harness 记录"提交了几次 + 每次的 layout"，因为「一次应用 = W03 历史一步」的性质就是
 * "一次 `onChange`"，不在组件里另造历史。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import {
  TEXT_LEVEL_LABELS,
  applyTextLevel,
  type TextLevelId,
} from "../../../features/resume-layout/textLevels";
import TextLevelBar from "./TextLevelBar";
import WorkbenchTypographyTools from "../WorkbenchTypographyTools";

const OBJ_A = "exp_12345678";
const OBJ_B = "prj_87654321";

function baseLayout(formatConfig: Record<string, unknown> = {}): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    format_config: formatConfig as ResumeLayout["format_config"],
  };
}

interface HarnessProps {
  initial?: ResumeLayout;
  selected?: readonly { id: string }[];
  selectedObjectId?: string | null;
  onCommitSpy?: (next: ResumeLayout) => void;
}

/** 最小宿主：layout 住在这里，提交次数与最后一次 layout 暴露给断言。 */
function Harness({ initial, selected = [], selectedObjectId = null, onCommitSpy }: HarnessProps) {
  const [layout, setLayout] = useState<ResumeLayout>(initial ?? baseLayout());
  const [commits, setCommits] = useState(0);
  const commit = (next: ResumeLayout) => {
    setCommits((count) => count + 1);
    onCommitSpy?.(next);
    setLayout(next);
  };
  return (
    <div>
      <output data-testid="commits">{commits}</output>
      <output data-testid="layout">{JSON.stringify(layout.format_config)}</output>
      <TextLevelBar
        layout={layout}
        selected={selected}
        selectedObjectId={selectedObjectId}
        onChange={commit}
      />
    </div>
  );
}

function objectsOf(): Record<string, Record<string, unknown>> {
  const raw = JSON.parse(screen.getByTestId("layout").textContent ?? "{}") as {
    objects?: Record<string, Record<string, unknown>>;
  };
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw.objects ?? {})) {
    if (key === "version") continue;
    entries[key] = value;
  }
  return entries;
}

/**
 * antd Button 默认在两个汉字之间插空格（`autoInsertSpace`，全站既有行为，例如「取 消」）。
 * 查询用"允许任意空白"的正则，既容忍它，也不会误配到别的级别。
 */
function levelButton(level: TextLevelId) {
  const label = t(TEXT_LEVEL_LABELS[level]);
  return screen.getByRole("button", { name: new RegExp(`^${label.split("").join("\\s*")}$`) });
}

function currentText(stateLabel: string) {
  return t("typography.level.current", { level: stateLabel });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("文字级别工具条", () => {
  it("没有选中内容时给出处，不渲染级别按钮", () => {
    render(<Harness />);
    expect(screen.getByText(t("typography.level.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("typography.level.heading1") })).toBeNull();
  });

  it("单选：点一级标题 → 只提交一次，对象覆盖四项齐全，当前级别随之显示", () => {
    const onCommit = vi.fn();
    render(<Harness selectedObjectId={OBJ_A} onCommitSpy={onCommit} />);
    expect(screen.getByText(currentText(t("typography.level.currentInherit")))).toBeInTheDocument();

    fireEvent.click(levelButton("heading1"));

    expect(screen.getByTestId("commits").textContent).toBe("1");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(objectsOf()[OBJ_A]).toEqual({
      font_scale: 1.4,
      bold: true,
      space_before: 0.4,
      space_after: 0.2,
    });
    expect(screen.getByText(currentText(t("typography.level.heading1")))).toBeInTheDocument();
    // 显式覆盖要挂"本条已调整"来源胶囊（不是整份简历 / 同类段落）。
    expect(screen.getByText(t("typography.source.object"))).toBeInTheDocument();
  });

  it("选中项没有合法稳定 id 时按未选中处理：不渲染按钮，也写不进垃圾键", () => {
    render(<Harness selected={[{ id: "short" }]} />);
    expect(screen.getByText(t("typography.level.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("typography.level.heading1") })).toBeNull();
  });

  it("多选批量：两条目标在一次提交里都拿到级别覆盖", () => {
    const onCommit = vi.fn();
    render(
      <Harness
        selected={[{ id: OBJ_A }, { id: OBJ_B }]}
        selectedObjectId={OBJ_A}
        onCommitSpy={onCommit}
      />,
    );
    expect(screen.getByText(t("typography.level.count", { count: 2 }))).toBeInTheDocument();

    fireEvent.click(levelButton("heading2"));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(objectsOf()[OBJ_A]).toMatchObject({ font_scale: 1.2, bold: true });
    expect(objectsOf()[OBJ_B]).toMatchObject({ font_scale: 1.2, bold: true });
  });

  it("已是当前级别再点：不制造一次看起来没变的提交", () => {
    const initial = baseLayout(applyTextLevel({}, [OBJ_A], "body") as never);
    render(<Harness initial={initial} selectedObjectId={OBJ_A} />);
    expect(screen.getByText(currentText(t("typography.level.body")))).toBeInTheDocument();

    fireEvent.click(levelButton("body"));

    expect(screen.getByTestId("commits").textContent).toBe("0");
  });

  it("手改过的对象显示自定义", () => {
    render(
      <Harness
        initial={baseLayout({ objects: { version: 1, [OBJ_A]: { font_scale: 1.31 } } })}
        selectedObjectId={OBJ_A}
      />,
    );
    expect(screen.getByText(currentText(t("typography.level.currentCustom")))).toBeInTheDocument();
  });

  it("多选级别不一致显示多个级别", () => {
    render(
      <Harness
        initial={baseLayout(
          applyTextLevel(applyTextLevel({}, [OBJ_A], "heading1"), [OBJ_B], "caption") as never,
        )}
        selected={[{ id: OBJ_A }, { id: OBJ_B }]}
      />,
    );
    expect(screen.getByText(currentText(t("typography.level.currentMixed")))).toBeInTheDocument();
  });

  it("恢复跟随模板：删掉四项覆盖、保留其它局部调整，只提交一次", () => {
    const initial = applyTextLevel(
      { objects: { version: 1, [OBJ_A]: { color: "#123456" } } } as never,
      [OBJ_A],
      "heading3",
    );
    const onCommit = vi.fn();
    render(
      <Harness
        initial={baseLayout(initial as never)}
        selectedObjectId={OBJ_A}
        onCommitSpy={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: t("typography.level.restore") }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(objectsOf()[OBJ_A]).toEqual({ color: "#123456" });
    expect(screen.getByText(currentText(t("typography.level.currentInherit")))).toBeInTheDocument();
  });
});

describe("文字级别 · 参数栏真实挂载", () => {
  it("「局部排版」组里出现文字级别工具条；应用成功提示带级别名与条数", async () => {
    render(
      <AntdApp>
        <WorkbenchTypographyTools
          layout={baseLayout()}
          selectedObjectId={OBJ_A}
          selected={[]}
          onChange={vi.fn()}
          onClearSelection={vi.fn()}
        />
      </AntdApp>,
    );
    expect(screen.getByText(t("typography.level.title"))).toBeInTheDocument();

    fireEvent.click(levelButton("heading1"));

    expect(
      await screen.findByText(
        t("typography.level.applied", {
          level: t("typography.level.heading1"),
          count: 1,
        }),
      ),
    ).toBeInTheDocument();
  });
});
