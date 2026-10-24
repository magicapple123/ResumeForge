// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ProviewCommand } from "../../../features/resume-proview/types";
import CommandPalette from "./CommandPalette";

type Runs = {
  alpha: ReturnType<typeof vi.fn<() => void>>;
  beta: ReturnType<typeof vi.fn<() => void>>;
  blocked: ReturnType<typeof vi.fn<() => void>>;
};

function makeRuns(): Runs {
  return {
    alpha: vi.fn<() => void>(),
    beta: vi.fn<() => void>(),
    blocked: vi.fn<() => void>(),
  };
}

function makeCommands(runs: Runs): ProviewCommand[] {
  return [
    { id: "alpha", label: "Alpha action", keywords: ["first"], run: runs.alpha },
    { id: "beta", label: "Beta export", keywords: ["export", "pdf"], run: runs.beta },
    {
      id: "blocked",
      label: "Blocked action",
      run: runs.blocked,
      unavailable: true,
    },
  ];
}

function renderPalette(open: boolean, commands: ProviewCommand[], onClose = vi.fn()) {
  return render(
    <AntdApp>
      <CommandPalette open={open} onClose={onClose} commands={commands} />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("命令面板（D13）", () => {
  it("打开时列出全部命令与键盘说明", () => {
    const runs = makeRuns();
    renderPalette(true, makeCommands(runs));
    expect(screen.getByText(t("proview.command.title"))).toBeInTheDocument();
    expect(screen.getByText("Alpha action")).toBeInTheDocument();
    expect(screen.getByText("Beta export")).toBeInTheDocument();
    expect(screen.getByText(t("proview.command.hint"))).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: t("proview.command.searchAria") }),
    ).toBeInTheDocument();
  });

  it("搜索过滤；回车执行真实回调并关闭", () => {
    const runs = makeRuns();
    const onClose = vi.fn();
    renderPalette(true, makeCommands(runs), onClose);
    const input = screen.getByRole("combobox", { name: t("proview.command.searchAria") });
    fireEvent.change(input, { target: { value: "pdf" } });
    expect(screen.queryByText("Alpha action")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runs.beta).toHaveBeenCalledTimes(1);
    expect(runs.alpha).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("方向键在列表里移动高亮，回车执行当前高亮项", () => {
    const runs = makeRuns();
    renderPalette(true, makeCommands(runs));
    const input = screen.getByRole("combobox", { name: t("proview.command.searchAria") });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runs.beta).toHaveBeenCalledTimes(1);
    expect(runs.alpha).not.toHaveBeenCalled();
  });

  it("最近使用：执行过的命令再次打开时出现在「最近使用」分组", async () => {
    const runs = makeRuns();
    const commands = makeCommands(runs);
    const { rerender } = renderPalette(true, commands);
    const input = screen.getByRole("combobox", { name: t("proview.command.searchAria") });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    rerender(
      <AntdApp>
        <CommandPalette open={false} onClose={vi.fn()} commands={commands} />
      </AntdApp>,
    );
    rerender(
      <AntdApp>
        <CommandPalette open onClose={vi.fn()} commands={commands} />
      </AntdApp>,
    );
    await waitFor(() => {
      expect(screen.getByText(t("proview.command.recent"))).toBeInTheDocument();
    });
    expect(screen.getByText(t("proview.command.all"))).toBeInTheDocument();
  });

  it("暂不可用的命令照常可搜索，但回车不会执行，并说明原因", async () => {
    const runs = makeRuns();
    renderPalette(true, makeCommands(runs));
    const input = screen.getByRole("combobox", { name: t("proview.command.searchAria") });
    fireEvent.change(input, { target: { value: "blocked" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runs.blocked).not.toHaveBeenCalled();
    expect(await screen.findByText(t("proview.command.unavailable"))).toBeInTheDocument();
  });

  it("Esc 关闭面板", () => {
    const runs = makeRuns();
    const onClose = vi.fn();
    renderPalette(true, makeCommands(runs), onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
