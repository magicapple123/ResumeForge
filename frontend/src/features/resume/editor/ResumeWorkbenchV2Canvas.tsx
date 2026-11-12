// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台右栏画布（v2）：把"文档变了就重排"接到预览上。
 *
 * 与旧 ResumeWorkbenchLiveCanvas 的差别：内容只有一份（v2 文档，历史 hook 给出），
 * 不再有"宿主已保存 + 草稿 store + overlay"三条来源；草稿就是文档本身。
 * 实时预览的防抖 / 取消 / 滚动位置恢复仍由 useResumeLivePreview 负责（一行未改）。
 */
import { Button, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { renderResume } from "../../../api/resumeLayout";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { useResumeLivePreview } from "../useResumeLivePreview";
import type { ExactPreviewOptions, ResumePreviewHandle } from "../preview/ResumePreview";
import type { PreviewMode } from "../preview/config";
import ResumeWorkbenchCanvas from "./ResumeWorkbenchCanvas";
import { useDebouncedValue } from "./useDebouncedValue";

/**
 * 精确预览合并窗口（Q05）。
 *
 * 精确预览按**未保存**的正文排 PDF，而 PDF 是服务端排的：每一版都要完整走一次请求 +
 * 查看器重建。中栏每敲一个字都直接当依赖，就是"每键一次排版"。600ms 与草稿画布的
 * 实时预览（`useResumeLivePreview` 的 DEFAULT_DEBOUNCE_MS）取同一个值——两条链路的
 * 合并窗口一致，用户看到的草稿与精确不会一前一后跳。
 */
const EXACT_PREVIEW_DEBOUNCE_MS = 600;

function signatureOf(document: ResumeDocument): string {
  try {
    return JSON.stringify(document);
  } catch {
    return "";
  }
}

export interface ResumeWorkbenchV2CanvasProps {
  html: string;
  warnings: string[];
  pages: number;
  previewRef: RefObject<ResumePreviewHandle | null>;
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  exactPreview?: ExactPreviewOptions;
  onPickField?: (path: string) => void;
  document: ResumeDocument | null;
  layout?: ResumeLayout;
  /** 保存（内容或版式）在飞：实时预览让路，别用旧结果盖住保存返回的 html。 */
  suspended?: boolean;
  /**
   * 文档模式（Q11）：`/resumes/render` 按它把页数夹到该模式的上限
   * （`resume` 1–3 页 / `long_cv` 1–10 页）。**不传就等于传 `resume`**，而模板里
   * `body { height: page_limit × 297mm }` 用的是服务端夹紧后的页数——长 CV 选了 10 页，
   * 纸面却只有 3 页高，测量分母随之缩到 3/10，于是「7 页内容」被算成「约需 21 页」。
   */
  documentMode?: "resume" | "long_cv";
  /** 画布容器节点出口（结构面板向 iframe 注入选中/悬停高亮时要用）。 */
  onContainerReady?: (node: HTMLElement | null) => void;
}

export default function ResumeWorkbenchV2Canvas({
  html,
  warnings,
  pages,
  previewRef,
  previewMode,
  onPreviewModeChange,
  exactPreview,
  onPickField,
  document,
  layout,
  suspended = false,
  documentMode,
  onContainerReady,
}: ResumeWorkbenchV2CanvasProps) {
  useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 容器节点交给宿主（结构面板高亮注入要它）；未挂载时回调 null，避免持有旧 DOM。
  useEffect(() => {
    onContainerReady?.(scrollRef.current);
    return () => onContainerReady?.(null);
  }, [onContainerReady]);
  /**
   * 实时结果（草稿纸面）与"保存写回的权威 html"谁优先？
   *
   * 判据是**序号水位**，不是"发起那一刻的宿主 html 字符串"。旧写法 `live.source === html`
   * 看着像"宿主 html 变了就作废这份实时结果"，但 `source` 是在**结果回来那一刻**才读的
   * （`handleHtml` 的闭包每次 html 变化都会重建，`htmlRef` 也跟着刷新），所以它恒等于当前
   * html——判据等于没有，谁最后回来谁上屏。反过来，只要把发起时间挪到请求起跑点，同一份
   * 判据又会把"改一次结构就换过宿主 html"的正常路径全部误判成过期（这正是本任务的现象）。
   *
   * 现在：每**发起**一次渲染 `renderStamp` +1；结果回来时把当时的水位记进 `live.stamp`，
   * 上屏条件是 `live.stamp > savedStamp`。保存写回宿主 html 时把 `savedStamp` 抬到当前
   * 序号——**只有发起于这次保存之前的结果**会被丢掉，保存之后的照常上屏。
   *
   * ## 序号取的是**到达时刻**（不是发起时刻），正确性依赖"不重叠"
   *
   * `handleHtml` 读到的是结果到达时的 `renderStampRef.current`，而不是产出这份 html 的那次
   * 请求的序号。若有两次请求重叠、旧的那次后到，它就会带上新序号，从而绕过 `savedStamp`
   * 水位（表现为"保存结果被旧实时结果顶掉"）。
   *
   * 这条路径靠 `useResumeLivePreview` 的结构保证不成立，而不是靠这里再判一次：
   * `inflightRef` 让同一时刻只有一个在飞请求（新变化只记 `pending`，等这次回来再跑），
   * 而 `suspend()`（保存开始）会 abort 在飞请求并把 `seqRef` 抬高一格，被 abort 的结果在
   * hook 里就被 `seq` 判掉、根本不会调到 `onHtml`。所以到达时"最新发起序号"必然就是产出
   * 这份 html 的那一次。**如果以后改了 hook 允许并发渲染，这里必须改成随请求透传序号。**
   */
  const [live, setLive] = useState<{ html: string; stamp: number } | null>(null);
  const renderStampRef = useRef(0);
  // 水位用 state 而不是 ref：它在渲染期被读（`live.stamp > savedStamp`），而 react-hooks
  // 的 `refs` 规则禁止渲染期读 ref（会与并发渲染的撕裂检查冲突）。写入点在下面的 effect 里。
  const [savedStamp, setSavedStamp] = useState(0);
  const runRender = useCallback(
    (next: ResumeDocument, nextLayout: ResumeLayout, signal: AbortSignal) => {
      // 发起时抬水位：这是"第几次请求"的唯一计数，读取点见 handleHtml 的注释。
      renderStampRef.current += 1;
      // Q11：`document_mode` 只在这一层合并进请求体，**不进 `ResumeLayout` 类型**——
      // 它是记录字段，混进版式会让 `cloneLayout` / 签名把它算成"版式变了"，保存按钮莫名变脏。
      // 不带的后果见 props 注释：模板按服务端夹紧后的页数写 body 高度，测量分母跟着错。
      return renderResume(
        next,
        documentMode ? { ...nextLayout, document_mode: documentMode } : nextLayout,
        signal,
      );
    },
    [documentMode],
  );
  const handleHtml = useCallback(
    // 序号取**到达时刻**的当前值（不重叠时它就等于产出这份 html 的那次请求序号）。
    (next: string) => setLive({ html: next, stamp: renderStampRef.current }),
    [],
  );
  // 精确预览把"还没保存"的正文一起带上（预览与导出一致）。正文先过一层 600ms 合并窗口：
  // 草稿画布那条链路自己会合并击键，精确这条是服务端排版，不合并就是每键一份 PDF。
  const exactDocument = useDebouncedValue(document, EXACT_PREVIEW_DEBOUNCE_MS);
  const exactPreviewWithDraft = useMemo(() => {
    if (!exactPreview || !exactDocument) return exactPreview;
    return {
      ...exactPreview,
      content: exactDocument,
      contentSignature: signatureOf(exactDocument),
    };
  }, [exactDocument, exactPreview]);
  const { state, retry, suspend, resume } = useResumeLivePreview({
    // 精确模式是服务端排的 PDF，不做草稿 html 重排。
    enabled: Boolean(document) && previewMode !== "exact",
    content: document,
    layout,
    render: runRender,
    onHtml: handleHtml,
    scrollRef,
  });
  useSuspension(suspended, suspend, resume, { renderStampRef, setSavedStamp, setLive });
  const status =
    state === "error" ? (
      <Space size={4}>
        {/* R-32：排版失败时纸面停在旧一版——这必须看成"警示"，不能是一行灰色说明。 */}
        <Typography.Text type="warning" className="resume-wb-canvas-note">
          {t("rich.preview.staleDetail")}
        </Typography.Text>
        <Button size="small" type="link" onClick={retry}>
          {t("rich.preview.retry")}
        </Button>
      </Space>
    ) : state === "idle" ? null : (
      <Typography.Text type="secondary" className="resume-wb-canvas-note">
        {t("rich.preview.updating")}
      </Typography.Text>
    );
  return (
    <ResumeWorkbenchCanvas
      // 水位判据：`live.stamp` 不高于保存水位就丢弃（见上面 `live` 的说明）。
      // 宿主 html 因为别的原因变过（打开、版本恢复）都仍让更新的实时结果上屏。
      html={live && live.stamp > savedStamp ? live.html : html}
      warnings={warnings}
      pages={pages}
      previewRef={previewRef}
      previewMode={previewMode}
      onPreviewModeChange={onPreviewModeChange}
      exactPreview={exactPreviewWithDraft}
      onPickField={onPickField}
      scrollRef={scrollRef}
      status={status}
    />
  );
}

/** 保存开始/结束时的交还控制权，同时维护"哪一版实时结果已经作废"。 */
interface SuspensionStamps {
  /** 每次渲染发起 +1；实时结果带着发起时的值上屏。 */
  renderStampRef: MutableRefObject<number>;
  /** "作废水位"：抬到多少，早于它的实时结果就不许再上屏（渲染期要读，所以是 state）。 */
  setSavedStamp: (value: number) => void;
  /** 保存开始时立刻丢掉手上这一份实时结果（它描述的已经是旧文档）。 */
  setLive: (next: null) => void;
}

function useSuspension(
  suspended: boolean,
  suspend: () => void,
  resume: () => void,
  stamps: SuspensionStamps,
): void {
  const { renderStampRef, setSavedStamp, setLive } = stamps;
  // 保存开始就挂起、结束交还控制权（与旧画布同一个写法）。
  useEffect(() => {
    if (suspended) {
      suspend();
      // 保存期间的纸面由宿主 html 决定：手上这份实时结果对应的文档已经旧了。
      // 这一条 setState 就是"结果已失效"的确定性收尾，没有别的渲染路径能承载它。
      setLive(null);
      return;
    }
    resume();
    // 本 effect 只在「挂载」与「suspended 翻转」时跑，所以这一句实际只在保存结束时生效
    // （挂载那一次两边都是 0）。保存写回的 html 是权威版本：把水位抬到当前序号，
    // 此刻之前发起的结果一律不许盖回来；`resume()` 随后补排的那一版序号更高，照常上屏。
    setSavedStamp(renderStampRef.current);
  }, [renderStampRef, resume, setLive, setSavedStamp, suspended, suspend]);
}
