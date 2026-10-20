// SPDX-License-Identifier: Apache-2.0
/**
 * 数据集导出命名（R15）：点「导出」先问下载名，默认填 `<数据集名>-<时间戳>`。
 *
 * 只钉两件容易漏的事：默认名带时间戳（防同名覆盖），以及用户改过的名字确实传到了
 * 导出回调——名字停在弹窗里没传出去，用户下载到的还是旧固定名，而界面看起来"成功了"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatasetInfo } from "../../types";
import DatasetsCard from "./DatasetsCard";

const DATASET: DatasetInfo = {
  id: "main",
  name: "校招线",
  source: "本地",
  size_bytes: 1024,
  created_at: "2026-10-19T10:00:00+08:00",
  is_active: true,
  exists: true,
};

function renderCard(overrides: Partial<React.ComponentProps<typeof DatasetsCard>> = {}) {
  const onExport = vi.fn();
  const onExportAll = vi.fn();
  render(
    <AntdApp>
      <DatasetsCard
        datasets={[DATASET, { ...DATASET, id: "other", name: "社招线", is_active: false }]}
        loading={false}
        exporting={false}
        importing={false}
        includeGlobalLLM
        onIncludeGlobalLLMChange={vi.fn()}
        switchingId={null}
        renamingId={null}
        deletingId={null}
        renameTarget={null}
        renameValue=""
        creating={false}
        createOpen={false}
        createName=""
        onExport={onExport}
        onExportAll={onExportAll}
        onImport={vi.fn()}
        onActivate={vi.fn()}
        onOpenRename={vi.fn()}
        onRenameValueChange={vi.fn()}
        onConfirmRename={vi.fn()}
        onCancelRename={vi.fn()}
        onDelete={vi.fn()}
        onOpenCreate={vi.fn()}
        onCreateNameChange={vi.fn()}
        onConfirmCreate={vi.fn()}
        onCancelCreate={vi.fn()}
        {...overrides}
      />
    </AntdApp>,
  );
  return { onExport, onExportAll };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("DatasetsCard 导出选项", () => {
  it("全局模型配置默认勾选，取消后回调 false", () => {
    const onIncludeGlobalLLMChange = vi.fn();
    renderCard({ onIncludeGlobalLLMChange });

    const checkbox = screen.getByRole("checkbox", {
      name: /备份中包含全局模型配置/,
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onIncludeGlobalLLMChange).toHaveBeenCalledWith(false);
  });
});

describe("DatasetsCard 导出命名（R15）", () => {
  it("默认名带数据集名与时间戳，并把用户改过的名字传给导出", async () => {
    const { onExport } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /导出$/ }));
    fireEvent.click(await screen.findByText("导出当前数据集"));

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("导出文件名") as HTMLInputElement;
    expect(input.value).toMatch(/^校招线-\d{8}-\d{6}$/);

    fireEvent.change(input, { target: { value: "我的备份" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(onExport).toHaveBeenCalledWith(DATASET, "我的备份");
  });

  it("导出全部时默认名为「全部数据集-时间戳」", async () => {
    const { onExportAll } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /导出$/ }));
    fireEvent.click(await screen.findByText("导出全部数据集"));

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("导出文件名") as HTMLInputElement;
    expect(input.value).toMatch(/^全部数据集-\d{8}-\d{6}$/);

    fireEvent.click(within(dialog).getByRole("button", { name: /导\s*出/ }));
    await waitFor(() => expect(onExportAll).toHaveBeenCalledTimes(1));
    expect(onExportAll.mock.calls[0][0]).toMatch(/^全部数据集-\d{8}-\d{6}$/);
  });
});
