// SPDX-License-Identifier: Apache-2.0
/**
 * 导出前的预检闸门（2026-11 问题 3）：**点「导出」时才跑一次预检**，有必须解决的
 * 问题就先问一句。
 *
 * 背景：`ExportOptionsModal` / `ExportButtons` 以前全程不跑预检，`page_limit` 小于实际
 * 页数时后端照截断并返回 200——第三页就这样静默丢了，用户以为导出的是全部内容。
 *
 * 三条硬约束（都写在实现里）：
 * 1. **只在用户点导出时发请求**：不在 `open` 变 true 时预检（那是渲染期的副作用，
 *    打开面板就要等一次约 400ms 的 PDF 渲染）。
 * 2. **预检失败必须放行**：网络断、500、超时都不能让用户导不出——预检是"多一道提醒"，
 *    不是新的失败点；放行时 `console.warn` 留痕。
 * 3. **不叠第二层容器**：确认条是面板内的一条 `Alert`（与 409「还有未完成标记」同一形态）。
 *    在 `*Modal.tsx` 里开 `modal.confirm` 属违规（`popupStackGuard.test.ts` /
 *    `antdStaticGuard.test.ts`，AGENTS.md「同一时刻 ≤1 个容器」）。
 *
 * 为什么单独成文件：`ExportOptionsModal.tsx` 已贴近 500 行预算，判定逻辑（读数、文案、
 * 询问）搬出来才能既守住预算又被单测直接覆盖。**两条链路共用**：旧导出选项面板
 * （`ExportOptionsModal`）与 W19 交付弹层（`delivery/ExportConfigModal`，已保存简历的
 * 主路径）都从本模块取闸门——只挂一条链路的话，用户从主路径导出时第三页照样静默丢失。
 */
import { Alert, Button, Space } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { runPreflight } from "../preflight/preflightApi";
import type { CheckIssue, PreflightOut, PreflightRequest } from "../preflight/types";
import { t } from "../../../i18n";

/** 溢出读数：内容需要几页、当前上限几页（两个数字都要出现在文案里）。 */
export interface ExportOverflowReading {
  pagesNeeded: number;
  pageLimit: number;
}

/** 必须解决的问题（判据是 `severity`，不写死机器码）。 */
export function blockerIssues(result: PreflightOut | null | undefined): CheckIssue[] {
  return (result?.issues ?? []).filter((issue) => issue.severity === "blocker");
}

/**
 * 从一条溢出问题里读"需要几页"。
 *
 * 字段来源（已核对后端源码 `services/resume/preflight_rules_product.py`）：
 * 产物层溢出问题的 `fix.payload.pages_needed` 就是 `pdf.pages_needed`
 * （`PdfRender.pages_needed`，未截断时的真实页数）；`locator.page` 是**截断后**的页数，
 * 不能用。`layout_overflow` 同形（`preflight_rules_layout.py`）。
 */
function pagesNeededOf(issue: CheckIssue): number | null {
  const value = issue.fix?.payload?.pages_needed;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** 溢出类机器码（product_pdf_overflow / product_docx_overflow / layout_overflow）。 */
function isOverflowIssue(issue: CheckIssue): boolean {
  return issue.code.endsWith("_overflow");
}

/**
 * 溢出读数：优先用响应快照里的 `page_limit`（后端按本次请求的版式折算并回显），
 * 退回面板当前草稿值。
 */
export function overflowReading(
  result: PreflightOut | null | undefined,
  fallbackLimit?: number | null,
): ExportOverflowReading | null {
  const snapshotLimit = result?.snapshot?.page_limit;
  const limit =
    typeof snapshotLimit === "number" && snapshotLimit > 0
      ? snapshotLimit
      : typeof fallbackLimit === "number" && fallbackLimit > 0
        ? fallbackLimit
        : null;
  for (const issue of blockerIssues(result)) {
    if (!isOverflowIssue(issue)) continue;
    const pagesNeeded = pagesNeededOf(issue);
    if (pagesNeeded === null) continue;
    if (limit === null || pagesNeeded <= limit) continue;
    return { pagesNeeded, pageLimit: limit };
  }
  return null;
}

/** 二次确认的两行文案：有溢出读数就给出三个具体数字，否则只说有几条必须解决。 */
export function gateCopy(
  result: PreflightOut | null | undefined,
  fallbackLimit?: number | null,
): { title: string; body: string } {
  const reading = overflowReading(result, fallbackLimit);
  if (reading) {
    return {
      title: t("exportPanel.preflight.overflowTitle", {
        pages: reading.pagesNeeded,
        limit: reading.pageLimit,
      }),
      body: t("exportPanel.preflight.overflowBody", {
        next: reading.pageLimit + 1,
        pages: reading.pagesNeeded,
        limit: reading.pageLimit,
      }),
    };
  }
  return {
    title: t("exportPanel.preflight.blockedTitle"),
    body: t("exportPanel.preflight.blockedBody", {
      count: blockerIssues(result).length,
    }),
  };
}

/**
 * 产物层预检请求：只跑**产物层**（"内容需要几页"只有真渲染一次才知道）。
 *
 * `pdf` **恒带**（1-D）：页数权威只有服务端 PDF 给得出，而「最大篇幅」从 1-D 起约束
 * **所有**格式（HTML/Markdown/TXT 也会按它整块裁），所以只勾 txt/md/html 时同样必须先问
 * 一次——以前这几种格式连提示都没有，用户直到打开文件才发现后半段没了。勾了 Word 再追加
 * `docx`（它有自己的一套估算，能提前暴露"Word 会比 PDF 多出半页"）。
 */
export function productPreflightRequest(
  formats: readonly string[],
  layout: PreflightRequest["layout"],
): PreflightRequest {
  const product_formats: ("pdf" | "docx")[] = ["pdf"];
  if (formats.includes("docx") && !product_formats.includes("docx")) {
    product_formats.push("docx");
  }
  return {
    layers: ["product"],
    product_formats,
    layout,
  };
}

interface Options {
  /** 没有简历 id（未保存草稿走别的链路）时传 null：`confirm` 直接放行。 */
  recordId: number | null;
  /** 预检请求体：页数/字号/语言/版式必须与导出同一份草稿（否则问的数和导的不是一份）。 */
  buildRequest: () => PreflightRequest;
}

export interface ExportPreflightGate {
  /** 允许导出返回 true（无问题 / 用户坚持 / 预检失败放行）；用户选「先调整」返回 false。 */
  confirm: () => Promise<boolean>;
  /** 面板内的确认条（无询问时为 null）。 */
  node: ReactNode;
}

/**
 * 导出闸门 hook：`confirm()` 跑一次预检并在有 blocker 时挂起等用户选。
 *
 * 同一次面板会话里，**同一个溢出读数只问一次**：用户已经点过「仍然导出」，再点一次
 * 不该被同一句话拦住第二次（`approvedRef`）。
 */
export function useExportPreflightGate({ recordId, buildRequest }: Options): ExportPreflightGate {
  const [ask, setAsk] = useState<{ title: string; body: string } | null>(null);
  const resolveRef = useRef<((proceed: boolean) => void) | null>(null);
  const approvedRef = useRef<string | null>(null);

  // 面板被关掉时不能把调用方吊在 Promise 上：按"不导出"收尾。
  useEffect(() => {
    return () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  const askConfirm = useCallback(
    (title: string, body: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setAsk({ title, body });
      }),
    [],
  );

  const answer = useCallback((proceed: boolean): void => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setAsk(null);
    resolve?.(proceed);
  }, []);

  const confirm = useCallback(async (): Promise<boolean> => {
    // 没有 id 就没有预检对象（宿主自己决定这种场景能不能导出）：直接放行。
    if (recordId === null) return true;
    const request = buildRequest();
    let result: PreflightOut;
    try {
      result = await runPreflight(recordId, request);
    } catch (error) {
      // 预检是"多一道提醒"，不能变成新的失败点：放行 + 记录。
      console.warn("[export] preflight incomplete, proceeding with export", error);
      return true;
    }
    if (blockerIssues(result).length === 0) return true;

    const reading = overflowReading(result, request.layout?.page_limit);
    const key = reading ? `overflow:${reading.pagesNeeded}:${reading.pageLimit}` : "blockers";
    if (approvedRef.current === key) return true;

    const copy = gateCopy(result, request.layout?.page_limit);
    const proceed = await askConfirm(copy.title, copy.body);
    if (proceed) approvedRef.current = key;
    return proceed;
  }, [askConfirm, buildRequest, recordId]);

  const node = ask ? (
    <Alert
      type="warning"
      showIcon
      title={ask.title}
      description={ask.body}
      action={
        <Space size={8}>
          <Button size="small" onClick={() => answer(false)}>
            {t("exportPanel.preflight.adjustFirst")}
          </Button>
          <Button size="small" type="primary" danger onClick={() => answer(true)}>
            {t("exportPanel.preflight.exportAnyway")}
          </Button>
        </Space>
      }
    />
  ) : null;

  return { confirm, node };
}
