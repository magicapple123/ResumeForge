// SPDX-License-Identifier: Apache-2.0
/**
 * QW-5 会话草稿：key 的身份、预算、清理与"异步旧写不覆盖新草稿"。
 *
 * 这些性质都不能靠"打开页面看一眼"验证：跨简历串稿、超限截短、身份切换后旧写入
 * 覆盖新草稿，都是**看起来正常、内容其实错了**的形态。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { t } from "../../../i18n";
import {
  RESUME_DRAFT_MAX_BYTES,
  clearResumeDraft,
  readResumeDraft,
  resumeDraftStorageKey,
  useWorkbenchResumeDraft,
  writeResumeDraft,
  type ResumeDraftIdentity,
} from "./useWorkbenchResumeDraft";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

function doc(name: string): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: {
      items: [
        {
          kind: "field",
          id: "hd_name",
          key: "name",
          label: "",
          value: name,
          placement: "name",
          format: "text",
        },
      ],
      contact_breaks: [],
    },
    sections: [],
  };
}

const ID19: ResumeDraftIdentity = { resumeId: 19, datasetId: "main" };

describe("草稿存储层", () => {
  it("key 同时带数据集、简历 id 与基准版本", () => {
    expect(resumeDraftStorageKey(ID19, 7)).toBe("resumeforge.resume-draft.v1:main:resume-19@r7");
  });

  it("写入后能按身份读回；服务端版本前进后仍能按前缀找到（留给冲突流程）", () => {
    expect(writeResumeDraft(ID19, 3, doc("旧版"), LAYOUT, 1000)).toBe("ok");
    const restored = readResumeDraft(ID19, 1000);
    expect(restored?.document.header.items[0].value).toBe("旧版");
    expect(restored?.baseRevision).toBe(3);

    // 新版本再写一份：同一身份只保留最新的一份，读到的必须是它。
    expect(writeResumeDraft(ID19, 5, doc("新版"), LAYOUT, 2000)).toBe("ok");
    const latest = readResumeDraft(ID19, 2000);
    expect(latest?.document.header.items[0].value).toBe("新版");
    expect(latest?.baseRevision).toBe(5);
    expect(window.sessionStorage.getItem(resumeDraftStorageKey(ID19, 3))).toBeNull();
  });

  it("不同简历 / 不同数据集互不串稿", () => {
    writeResumeDraft(ID19, 3, doc("十九"), LAYOUT, 1000);
    expect(readResumeDraft({ resumeId: 18, datasetId: "main" }, 1000)).toBeNull();
    expect(readResumeDraft({ resumeId: 19, datasetId: "work" }, 1000)).toBeNull();
  });

  it("超出预算不截短：返回 too-large，且不会留下更旧的草稿", () => {
    writeResumeDraft(ID19, 3, doc("小"), LAYOUT, 1000);
    const huge = doc("x".repeat(RESUME_DRAFT_MAX_BYTES));
    expect(writeResumeDraft(ID19, 4, huge, LAYOUT, 2000)).toBe("too-large");
    expect(readResumeDraft(ID19, 2000)).toBeNull();
  });

  it("存储不可用（配额 / 隐私模式）返回 unavailable，不抛异常", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(writeResumeDraft(ID19, 3, doc("小"), LAYOUT, 1000)).toBe("unavailable");
    } finally {
      spy.mockRestore();
    }
  });

  it("过期的草稿读到即清掉", () => {
    writeResumeDraft(ID19, 3, doc("旧"), LAYOUT, 1000);
    expect(readResumeDraft(ID19, 1000 + 25 * 60 * 60 * 1000)).toBeNull();
    expect(clearResumeDraft(ID19)).toBeUndefined();
  });
});

describe("useWorkbenchResumeDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function render(options: {
    document: ResumeDocument;
    dirty: boolean;
    resumeId?: number;
    open?: boolean;
    onNotice?: (text: string) => void;
  }) {
    const onNotice = options.onNotice ?? vi.fn();
    return renderHook(
      (props: { document: ResumeDocument; dirty: boolean; resumeId?: number; open?: boolean }) =>
        useWorkbenchResumeDraft({
          open: props.open ?? true,
          resumeId: props.resumeId ?? 19,
          baseRevision: 3,
          document: props.document,
          layout: LAYOUT,
          enabled: true,
          dirty: props.dirty,
          debounceMs: 100,
          onNotice,
        }),
      { initialProps: options },
    );
  }

  it("编辑停顿后暂存；由脏变干净（保存/放弃）按身份清理", () => {
    const view = render({ document: doc("一"), dirty: true });
    act(() => vi.advanceTimersByTime(100));
    expect(readResumeDraft(ID19)?.document.header.items[0].value).toBe("一");

    // 保存成功 / 放弃 / 恢复版本 → dirty 回到 false：草稿按身份清理。
    view.rerender({ document: doc("一"), dirty: false });
    expect(readResumeDraft(ID19)).toBeNull();
  });

  it("打开时读到草稿只进 pending，不自动应用；restore 取用后清 pending", () => {
    writeResumeDraft(ID19, 3, doc("上次"), LAYOUT, Date.now());
    const view = render({ document: doc("现在"), dirty: false });
    expect(view.result.current.pending?.document.header.items[0].value).toBe("上次");
    act(() => {
      const restored = view.result.current.restore();
      expect(restored?.document.header.items[0].value).toBe("上次");
    });
    expect(view.result.current.pending).toBeNull();
  });

  it("放弃草稿：清 pending 与存储，刷新后不再出现", () => {
    writeResumeDraft(ID19, 3, doc("上次"), LAYOUT, Date.now());
    const view = render({ document: doc("现在"), dirty: false });
    act(() => view.result.current.discard());
    expect(view.result.current.pending).toBeNull();
    expect(readResumeDraft(ID19)).toBeNull();
  });

  it("切简历后旧身份不再可读（异步旧写不覆盖新草稿）", () => {
    const view = render({ document: doc("十九"), dirty: true });
    // 合并窗口内切走：旧身份的待写入必须作废，不能落到新简历的 key 上。
    view.rerender({ document: doc("十八"), dirty: true, resumeId: 18 });
    act(() => vi.advanceTimersByTime(100));
    expect(readResumeDraft({ resumeId: 19, datasetId: "main" })).toBeNull();
    expect(
      readResumeDraft({ resumeId: 18, datasetId: "main" })?.document.header.items[0].value,
    ).toBe("十八");
  });

  it("关掉制作台（open=false）不清理草稿；重新打开时只把草稿放进 pending", () => {
    const first = render({ document: doc("草稿"), dirty: true });
    act(() => vi.advanceTimersByTime(100));
    expect(readResumeDraft(ID19)?.document.header.items[0].value).toBe("草稿");

    // 关闭：identity 变 null，但草稿必须留着——"关掉再打开能回来"就是它存在的理由。
    first.rerender({ document: doc("草稿"), dirty: true, open: false });
    expect(readResumeDraft(ID19)).not.toBeNull();
    first.unmount();

    const second = render({ document: doc("服务端"), dirty: false });
    expect(second.result.current.pending?.document.header.items[0].value).toBe("草稿");
  });

  it("打开另一份简历时读不到这一份的草稿（不串稿）", () => {
    writeResumeDraft(ID19, 3, doc("十九的草稿"), LAYOUT, Date.now());
    const view = render({ document: doc("十八"), dirty: false, resumeId: 18 });
    expect(view.result.current.pending).toBeNull();
  });

  it("超预算：明确提示「未能暂存」，不写任何截短后的草稿", () => {
    const onNotice = vi.fn();
    const huge = doc("x".repeat(RESUME_DRAFT_MAX_BYTES));
    render({ document: huge, dirty: true, onNotice });
    act(() => vi.advanceTimersByTime(100));

    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith(t("workbench.draft.too-large"));
    // 不截短：宁可没有草稿，也不能恢复出一份少了几段的内容。
    expect(readResumeDraft(ID19)).toBeNull();
    // 当前内存里的内容没被改动（hook 只读 document）。
    expect(huge.header.items[0].value.length).toBe(RESUME_DRAFT_MAX_BYTES);
  });

  it("存储不可写：同样明确提示「未能暂存」，当前内容不受影响", () => {
    const onNotice = vi.fn();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      const view = render({ document: doc("配额"), dirty: true, onNotice });
      act(() => vi.advanceTimersByTime(100));
      expect(onNotice).toHaveBeenCalledWith(t("workbench.draft.unavailable"));
      expect(view.result.current.pending).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
