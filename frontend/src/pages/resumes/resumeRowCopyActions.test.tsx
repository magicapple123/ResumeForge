// SPDX-License-Identifier: Apache-2.0
/**
 * 简历行「复制」子菜单（2026-10-24，2026-11-19 收口到通用工厂）。
 *
 * 这一组动作全是"把数据拿出去"：贴招聘表单、发内推、粘进表格。它们最容易坏在四处，
 * 各钉一条：
 *
 * 1. **空字段不该出现**——备注为空还给一条「复制备注」，点了只得到空字符串；
 * 2. **整行用 Tab 分隔**——逗号分隔会让带逗号的标题在表格里错列；
 * 3. **失败要如实说**——剪贴板被拒时不能弹"已复制"；
 * 4. **Toast 用同一个 key 覆盖**——连续复制几个字段不该在右侧堆成一列。
 */
import { describe, expect, it, vi } from "vitest";
import { COPY_TOAST_KEY } from "../../components/common/copyMenu";
import type { ResumeBrief } from "../../types";
import { copyActionsFor, copyMenuFor } from "./resumeRowCopyActions";

const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock("../../utils/clipboard", () => clipboard);

const RECORD: ResumeBrief = {
  id: 12,
  title: "后端开发（Python）",
  job_id: 3,
  job_title: "高级后端工程师",
  company: "某某科技",
  source: "ai",
  favorite: false,
  note: "投过一轮，HR 说下周给反馈",
  model: "gpt-x",
  enhancement_enabled: true,
  enhancement_level: "balanced",
  template: "classic",
  format_name: "",
  format_config: {},
  page_limit: 1,
  font_scale: "standard",
  created_at: "2026-10-20T10:00:00",
  updated_at: "2026-10-22T09:30:00",
};

function notifier() {
  return { success: vi.fn(), warning: vi.fn() };
}

/** 子菜单里的动作 key（顺序即菜单顺序）。 */
function keys(record: ResumeBrief): string[] {
  return copyActionsFor(record, notifier()).map((item) => item.key);
}

/** 点一项并等到异步复制跑完（`runCopy` 至少两个 await）。 */
async function click(key: string, record: ResumeBrief = RECORD) {
  const notify = notifier();
  const item = copyActionsFor(record, notify).find((entry) => entry.key === key);
  item?.onClick?.();
  await vi.waitFor(() => expect(clipboard.copyText).toHaveBeenCalled());
  return notify;
}

describe("简历行「复制」子菜单", () => {
  it("字段齐全时给出四条 + 整行；空备注不出现在菜单里", () => {
    expect(keys(RECORD)).toEqual([
      "copy_title",
      "copy_job",
      "copy_company",
      "copy_note",
      "copy_row",
    ]);
    // 备注为空：不给"复制空字符串"的入口。
    expect(keys({ ...RECORD, note: "  ", job_title: "", company: "" })).toEqual([
      "copy_title",
      "copy_row",
    ]);
  });

  it("复制的是这个字段的原文（不做任何改写）", async () => {
    clipboard.copyText.mockReset().mockResolvedValue(true);
    await click("copy_title");
    expect(clipboard.copyText).toHaveBeenCalledWith("后端开发（Python）");
    clipboard.copyText.mockClear();
    await click("copy_note");
    expect(clipboard.copyText).toHaveBeenCalledWith("投过一轮，HR 说下周给反馈");
  });

  it("整行用 Tab 分隔（粘进表格直接对齐），并带上来源与最近修改", async () => {
    clipboard.copyText.mockReset().mockResolvedValue(true);
    await click("copy_row");
    const line = clipboard.copyText.mock.calls[0][0] as string;
    expect(line.split("\t")).toEqual([
      "后端开发（Python）",
      "高级后端工程师",
      "某某科技",
      "AI 生成",
      // ISO 有意保留：整行是给表格用的，可排序、Excel 能识别。
      "2026-10-22T09:30:00",
    ]);
  });

  it("复制失败时走 warning，不谎报成功", async () => {
    clipboard.copyText.mockReset().mockResolvedValue(false);
    const notify = await click("copy_title");
    expect(notify.warning).toHaveBeenCalledWith(
      expect.stringContaining("复制失败"),
      expect.objectContaining({ key: COPY_TOAST_KEY }),
    );
    expect(notify.success).not.toHaveBeenCalled();
  });

  it("成功也带同一个 message key：连点多个字段只覆盖上一条，不排队堆叠", async () => {
    clipboard.copyText.mockReset().mockResolvedValue(true);
    const notify = await click("copy_title");
    expect(notify.success).toHaveBeenCalledWith(
      "已复制标题",
      expect.objectContaining({ key: COPY_TOAST_KEY }),
    );
  });

  it("失败文案用桌面端措辞（不再让用户去浏览器里手选）", async () => {
    clipboard.copyText.mockReset().mockResolvedValue(false);
    const notify = await click("copy_title");
    const text = notify.warning.mock.calls[0][0] as string;
    // 这是 Electron 桌面端，没有"浏览器"可切；能手动做的就是选中后按快捷键。
    expect(text).not.toContain("浏览器");
    expect(text).toContain("Ctrl+C");
  });

  it("子菜单挂在「复制」这一项下面，而不是平铺到右键菜单里", () => {
    const menu = copyMenuFor(RECORD, notifier());
    expect(menu.key).toBe("copy");
    expect(menu.label).toBe("复制");
    expect(menu.children?.length).toBeGreaterThanOrEqual(2);
  });
});
