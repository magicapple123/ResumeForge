// SPDX-License-Identifier: Apache-2.0
/**
 * 面试「简历材料」下拉（#25）：两路合并 + 分组 + 按前缀分派 + 无正文禁用。
 *
 * 断言一律用 `t()` 或纯英文夹具名（不用中文 `*ByText`）：测试里的中文断言也属于将来要
 * 迁移的存量，`cjkRatchet` 会盯着。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalResumeDetail, ExternalResumeItem } from "../api/externalResumes";
import { toInternalResumeId } from "../features/interview/materialPayload";
import { t } from "../i18n";
import {
  applyExternalResume,
  useExternalResumeApplier,
  useInterviewResumeSelect,
  EXTERNAL_RESUME_PREFIX,
  INTERNAL_RESUME_PREFIX,
  describeCurrentMaterial,
  externalResumeMaterial,
  externalResumeValue,
  internalResumeValue,
  parseExternalResumeId,
  parseResumeValue,
} from "./useInterviewResumeSelect";

const resumesMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));
const externalMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  getExternalResume: vi.fn(),
}));

vi.mock("../api/resumes", () => resumesMocks);
vi.mock("../api/externalResumes", () => externalMocks);

const INTERNAL_RESUMES = [
  { id: 1, title: "Backend resume" },
  { id: 2, title: "General resume" },
];

function externalItem(overrides: Partial<ExternalResumeItem> = {}): ExternalResumeItem {
  return {
    id: 7,
    file_id: 70,
    name: "external-a.pdf",
    mime: "application/pdf",
    text_chars: 120,
    has_text: true,
    job_id: null,
    job_title: "",
    created_at: "2026-11-11T00:00:00",
    updated_at: "2026-11-11T00:00:00",
    warnings: [],
    ...overrides,
  };
}

function externalDetail(overrides: Partial<ExternalResumeDetail> = {}): ExternalResumeDetail {
  return { ...externalItem(), text: "External resume body", ...overrides };
}

/** 把选项的 ReactNode label 拍成文本，用来断言「名字 + 说明 + 徽标」的组合。 */
function labelText(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

beforeEach(() => {
  resumesMocks.listResumes
    .mockReset()
    .mockResolvedValue({ items: INTERNAL_RESUMES, total: INTERNAL_RESUMES.length });
  resumesMocks.getResume
    .mockReset()
    .mockImplementation((id: number) =>
      Promise.resolve(INTERNAL_RESUMES.find((item) => item.id === id) ?? null),
    );
  externalMocks.listExternalResumes
    .mockReset()
    .mockResolvedValue({ items: [externalItem()], total: 1, page: 1, page_size: 50 });
  externalMocks.getExternalResume.mockReset().mockResolvedValue(externalDetail());
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("下拉 value 的复合引用（T33）", () => {
  it("写出去的是新写法 internal:/external:，旧前缀常量只作为读侧兼容保留", () => {
    expect(internalResumeValue(12)).toBe("internal:12");
    expect(externalResumeValue(7)).toBe("external:7");
    // 旧写法仍被接受（只进不出）：常量本身不再被任何写路径使用。
    expect(INTERNAL_RESUME_PREFIX).toBe("r:");
    expect(EXTERNAL_RESUME_PREFIX).toBe("e:");
  });

  it("parseResumeValue：新旧前缀都认，裸 id 与脏值都算没选", () => {
    expect(parseResumeValue("internal:12")).toEqual({ kind: "internal", id: 12 });
    expect(parseResumeValue("external:7")).toEqual({ kind: "external", id: 7 });
    expect(parseResumeValue("r:12")).toEqual({ kind: "internal", id: 12 });
    expect(parseResumeValue("e:7")).toEqual({ kind: "external", id: 7 });
    for (const dirty of ["12", "r:", "r:0", "x:1", "r:1.5", "", undefined]) {
      expect(parseResumeValue(dirty)).toBeNull();
    }
  });

  it("提交时只有内部简历能还原成数字 id（外部简历没有内部 id）", () => {
    expect(toInternalResumeId("internal:12")).toBe(12);
    expect(toInternalResumeId("r:12")).toBe(12);
    expect(toInternalResumeId("external:7")).toBeUndefined();
    expect(toInternalResumeId(undefined)).toBeUndefined();
  });

  it("深链参数只认正整数 id（其余按「没带参」处理）", () => {
    expect(parseExternalResumeId("7")).toBe(7);
    for (const dirty of ["0", "-3", "abc", "7.5", "", null]) {
      expect(parseExternalResumeId(dirty)).toBeNull();
    }
  });
});

describe("describeCurrentMaterial（「当前材料」这一行）", () => {
  const empty = t("interviewPage.setup.currentMaterial.empty");

  it("从记录选：有选中项说标题，没选中说尚未选择", () => {
    expect(
      describeCurrentMaterial({
        source: "record",
        recordLabel: "Backend resume",
        fileOrigin: null,
      }),
    ).toBe(t("interviewPage.setup.currentMaterial.record", { name: "Backend resume" }));
    expect(describeCurrentMaterial({ source: "record", fileOrigin: null })).toBe(empty);
  });

  it("文件侧按来源区分：外部简历 / 导入的文件 / 还没有材料", () => {
    expect(
      describeCurrentMaterial({
        source: "file",
        fileName: "external-a.pdf",
        fileOrigin: "external",
      }),
    ).toBe(t("interviewPage.setup.currentMaterial.external", { name: "external-a.pdf" }));
    expect(
      describeCurrentMaterial({ source: "file", fileName: "jd.txt", fileOrigin: "file" }),
    ).toBe(t("interviewPage.setup.currentMaterial.file", { name: "jd.txt" }));
    expect(describeCurrentMaterial({ source: "file", fileOrigin: null })).toBe(empty);
  });
});

describe("applyExternalResume：深链与下拉共用的落地函数（#25）", () => {
  function deps() {
    return {
      useFileSource: vi.fn(),
      useFileMaterial: vi.fn(),
      clearRecordValue: vi.fn(),
      notifyApplied: vi.fn(),
      notifyNoText: vi.fn(),
    };
  }

  it("有正文：切到文件侧 + 写入材料 + 清掉记录侧的值（否则会「显示已选、提交为空」）", () => {
    const handlers = deps();

    const applied = applyExternalResume(externalDetail(), handlers);

    expect(applied).toBe(true);
    expect(handlers.useFileSource).toHaveBeenCalledTimes(1);
    expect(handlers.useFileMaterial).toHaveBeenCalledWith({
      name: "external-a.pdf",
      text: "External resume body",
      warnings: [],
      parser: "text",
    });
    expect(handlers.clearRecordValue).toHaveBeenCalledTimes(1);
    expect(handlers.notifyApplied).toHaveBeenCalledWith("external-a.pdf");
    expect(handlers.notifyNoText).not.toHaveBeenCalled();
  });

  it("没有正文：一个状态都不落，只给可照做的提示", () => {
    const handlers = deps();

    const applied = applyExternalResume(externalDetail({ has_text: false, text: "" }), handlers);

    expect(applied).toBe(false);
    expect(handlers.useFileSource).not.toHaveBeenCalled();
    expect(handlers.useFileMaterial).not.toHaveBeenCalled();
    expect(handlers.clearRecordValue).not.toHaveBeenCalled();
    expect(handlers.notifyNoText).toHaveBeenCalledTimes(1);
  });

  it("has_text 为真但正文只有空白：同样按没有正文处理", () => {
    const handlers = deps();

    expect(applyExternalResume(externalDetail({ text: "   \n " }), handlers)).toBe(false);
    expect(handlers.useFileMaterial).not.toHaveBeenCalled();
  });

  it("材料形状与深链预填逐字一致（写端点 extra=forbid 不认 warnings）", () => {
    expect(externalResumeMaterial({ name: "a.txt", text: "body" })).toEqual({
      name: "a.txt",
      text: "body",
      warnings: [],
      parser: "text",
    });
  });
});

describe("useExternalResumeApplier", () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <AntdApp>{children}</AntdApp>;
  }

  function notices(): string {
    return document.body.textContent ?? "";
  }

  it("落地成功弹「已带入」提示，成功提示里带文件名", async () => {
    const useFileMaterial = vi.fn();
    const { result } = renderHook(
      () =>
        useExternalResumeApplier({
          useFileSource: vi.fn(),
          useFileMaterial,
          clearRecordValue: vi.fn(),
        }),
      { wrapper },
    );

    act(() => {
      result.current.apply(externalDetail({ name: "external-a.pdf" }));
    });

    await waitFor(() => expect(useFileMaterial).toHaveBeenCalled());
    await waitFor(() =>
      expect(notices()).toContain(
        t("interviewPage.setup.external.prefilled", { name: "external-a.pdf" }),
      ),
    );
  });

  it("拉不到详情：清掉可能残留的外部 value，再提示加载失败", async () => {
    const clearRecordValue = vi.fn();
    const { result } = renderHook(
      () =>
        useExternalResumeApplier({
          useFileSource: vi.fn(),
          useFileMaterial: vi.fn(),
          clearRecordValue,
        }),
      { wrapper },
    );

    act(() => result.current.notifyFailed());

    expect(clearRecordValue).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(notices()).toContain(t("interviewPage.setup.external.loadFailed")));
  });
});

describe("useInterviewResumeSelect", () => {
  function renderSelect(
    overrides: {
      jobId?: number | null;
      value?: string;
      onExternal?: (record: ExternalResumeDetail) => void;
      onExternalFailed?: () => void;
      onSelect?: (value: string | undefined) => void;
    } = {},
  ) {
    const callbacks = {
      onExternal: overrides.onExternal ?? vi.fn(),
      onExternalFailed: overrides.onExternalFailed ?? vi.fn(),
      onSelect: overrides.onSelect ?? vi.fn(),
    };
    const hook = renderHook(() =>
      useInterviewResumeSelect({
        jobId: overrides.jobId === undefined ? 3 : overrides.jobId,
        value: overrides.value,
        ...callbacks,
      }),
    );
    act(() => hook.result.current.reload());
    return { ...hook, ...callbacks };
  }

  it("两组都在：内部 value 用 internal:、外部用 external:（同一个下拉里分来源）", async () => {
    const { result } = renderSelect();

    await waitFor(() => expect(result.current.selectProps.options).toHaveLength(2));
    // 分组对象每次渲染都是新的：断言要读**当前**这一份，别拿着首次渲染的快照去等。
    await waitFor(() => {
      const [, externalGroup] = result.current.selectProps.options;
      expect(externalGroup.options.map((option) => option.value)).toEqual(["external:7"]);
    });
    const [internalGroup, externalGroup] = result.current.selectProps.options;
    expect(internalGroup.label).toBe(t("interviewPage.setup.resumeGroup.internal"));
    expect(externalGroup.label).toBe(t("interviewPage.setup.resumeGroup.external"));
    expect(internalGroup.options.map((option) => option.value)).toEqual([
      "internal:1",
      "internal:2",
    ]);
    // 内部按岗位域过滤（本岗位 + 通用），外部只按关键词查（列表接口没有 job_id 参数）。
    expect(resumesMocks.listResumes).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 3, include_general: true }),
    );
    expect(externalMocks.listExternalResumes).toHaveBeenCalledWith(
      expect.not.objectContaining({ job_id: expect.anything() }),
    );
  });

  it("没有正文的外部简历在下拉里就禁用（不给「选中后再 warning」的机会）", async () => {
    externalMocks.listExternalResumes.mockResolvedValue({
      items: [externalItem({ id: 8, name: "scan.pdf", has_text: false })],
      total: 1,
      page: 1,
      page_size: 50,
    });

    const { result } = renderSelect();

    await waitFor(() => expect(result.current.selectProps.options[1].options).toHaveLength(1));
    const option = result.current.selectProps.options[1].options[0];
    expect(option.disabled).toBe(true);
    expect(labelText(option.label)).toContain("scan.pdf");
    expect(labelText(option.label)).toContain(t("interviewPage.setup.resumeNoTextBadge"));
    // 悬停提示：说清为什么禁用，而不是只把行变灰。
    expect(option.title).toBe(t("interviewPage.setup.resumeNoText"));
  });

  it("岗位关联只打标签不过滤：job_id 命中的打「关联此岗位」，不命中的照样列出来", async () => {
    externalMocks.listExternalResumes.mockResolvedValue({
      items: [externalItem({ id: 7, name: "for-this-job.pdf", job_id: 3 })],
      total: 1,
      page: 1,
      page_size: 50,
    });
    const linked = renderSelect({ jobId: 3 });
    await waitFor(() =>
      expect(linked.result.current.selectProps.options[1].options).toHaveLength(1),
    );
    expect(labelText(linked.result.current.selectProps.options[1].options[0].label)).toContain(
      t("interviewPage.setup.resumeJobTag"),
    );
    cleanup();

    externalMocks.listExternalResumes.mockResolvedValue({
      items: [externalItem({ id: 9, name: "other-job.pdf", job_id: 99 })],
      total: 1,
      page: 1,
      page_size: 50,
    });
    const other = renderSelect({ jobId: 3 });
    await waitFor(() =>
      expect(other.result.current.selectProps.options[1].options).toHaveLength(1),
    );
    // 别的岗位的外部简历**不**被过滤掉，只是没有那个标签。
    const otherOption = other.result.current.selectProps.options[1].options[0];
    expect(otherOption.text).toBe("other-job.pdf");
    expect(labelText(otherOption.label)).not.toContain(t("interviewPage.setup.resumeJobTag"));
  });

  it("外部列表挂了不连坐：外部组留空，内部简历照常可选", async () => {
    externalMocks.listExternalResumes.mockRejectedValue(new Error("boom"));

    const { result } = renderSelect();

    await waitFor(() =>
      expect(result.current.selectProps.options[0].options.map((option) => option.value)).toEqual([
        "internal:1",
        "internal:2",
      ]),
    );
    expect(result.current.selectProps.options[1].options).toEqual([]);
    expect(result.current.selectProps.loading).toBe(false);
  });

  it("选内部简历：只写表单（internal:<id>），不请求外部详情", async () => {
    const { result, onSelect } = renderSelect({ value: undefined });

    act(() => result.current.selectProps.onChange("internal:2"));

    expect(onSelect).toHaveBeenCalledWith("internal:2");
    expect(externalMocks.getExternalResume).not.toHaveBeenCalled();
  });

  it("选外部简历：取正文后交给 onExternal，并把 external:<id> 写回表单", async () => {
    const { result, onExternal, onSelect } = renderSelect();

    act(() => result.current.selectProps.onChange("external:7"));

    await waitFor(() => expect(onExternal).toHaveBeenCalledTimes(1));
    expect(externalMocks.getExternalResume).toHaveBeenCalledWith(7);
    expect(onExternal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, name: "external-a.pdf", text: "External resume body" }),
    );
    // 选择值本身是复合引用：界面与表单说"选的是哪一份"，材料才承载正文。
    expect(onSelect).toHaveBeenCalledWith("external:7");
  });

  it("没有正文的外部简历即使被程序化选中也不写值（由落地函数说明为什么 + 怎么办）", async () => {
    externalMocks.getExternalResume.mockResolvedValue(
      externalDetail({ has_text: false, text: "" }),
    );
    const { result, onExternal, onSelect } = renderSelect();

    act(() => result.current.selectProps.onChange("external:7"));

    await waitFor(() => expect(onExternal).toHaveBeenCalledTimes(1));
    // 不写回值：下拉仍停在"没选"，用户不会看到"已选却进不了面试"的假状态。
    expect(onSelect).not.toHaveBeenCalledWith("external:7");
  });

  it("外部简历已被删除：不落材料，交给 onExternalFailed", async () => {
    externalMocks.getExternalResume.mockRejectedValue(new Error("404"));
    const { result, onExternal, onExternalFailed } = renderSelect();

    act(() => result.current.selectProps.onChange("external:7"));

    await waitFor(() => expect(onExternalFailed).toHaveBeenCalledTimes(1));
    expect(onExternal).not.toHaveBeenCalled();
  });

  it("清空（allowClear）与认不出的脏值都按「没选」写回表单", async () => {
    const { result, onSelect } = renderSelect({ value: "internal:1" });

    act(() => result.current.selectProps.onChange(undefined));
    act(() => result.current.selectProps.onChange("garbage"));

    expect(onSelect).toHaveBeenNthCalledWith(1, undefined);
    expect(onSelect).toHaveBeenNthCalledWith(2, undefined);
  });

  it("已选值保显示：候选里没有它时按 id 回查钉住，reload 之后仍然拿得到文案", async () => {
    resumesMocks.listResumes.mockResolvedValue({ items: [], total: 0 });
    const { result } = renderSelect({ value: "internal:2" });

    // 换岗位重载候选项：这一次第一页里没有 internal:2，但已选项不能退化成显示裸值。
    await waitFor(() => expect(result.current.labelFor("internal:2")).toBe("General resume"));
    act(() => result.current.reload());
    await waitFor(() => expect(resumesMocks.listResumes).toHaveBeenCalledTimes(2));
    // reload 会清掉钉住项，封装层紧接着重新 ensure；等它回填。
    await waitFor(() => expect(result.current.labelFor("internal:2")).toBe("General resume"));
    expect(result.current.selectProps.options[0].options.map((option) => option.value)).toContain(
      "internal:2",
    );
  });

  it("reload 同时刷新两组（内部跟随岗位、外部跟随关键词）", async () => {
    const { result } = renderSelect({ jobId: 3 });

    await waitFor(() => expect(externalMocks.listExternalResumes).toHaveBeenCalledTimes(1));
    act(() => result.current.reload());

    await waitFor(() => expect(externalMocks.listExternalResumes).toHaveBeenCalledTimes(2));
    expect(externalMocks.listExternalResumes).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: "" }),
    );
  });
});
