// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台右栏画布的**实时预览容器**：把"内容变了就重排"接到画布上。
 *
 * 三个职责，都刻意留在这一个薄壳里：
 *
 * 1. **显示哪份 html**：`liveHtml ?? props.html`。宿主给的 html 是"已保存的那一版"（保存、
 *    重新排版、AI 修订之后都会换新），实时结果是"还在改的那一版"。宿主一换 html 就把实时
 *    结果丢掉——保存返回的 html 是权威的，hook 不得覆盖它（见 `useResumeLivePreview` 第 8 条）。
 * 2. **保存期间挂起**：`suspended` 为真时 abort 在飞请求，免得保存写进去的新 html 被一个
 *    早发出的旧响应盖掉。
 * 3. **状态条**：`预览更新中…` / `显示的是上一次成功预览 + 重试`。它必须贴在画布条上——
 *    用户在右栏看纸，状态就得在纸的旁边，而不是弹窗底部。
 *
 * 精确模式下不挂实时预览：那一栏显示的是服务端排的 PDF，重排草稿 html 纯属浪费。
 */
import { Button, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { renderResume } from "../../api/resumeLayout";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import {
  createResumeDraftStore,
  type ResumeDraftStore,
} from "../../features/resume/resumeDraftContent";
import { useResumeLivePreview } from "../../features/resume/useResumeLivePreview";
import { ensureEntryIds } from "../../features/resume-document/identity";
import { contentSignature } from "../../utils/contentSignature";
import type { ExactPreviewOptions, ResumePreviewHandle } from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import type { RichTextEditAdapter } from "../resume-preview/richText";
import {
  ProviewProvider,
  type ProviewShellConfig,
} from "../../features/resume-proview/ProviewContext";
import ResumeWorkbenchCanvas from "./ResumeWorkbenchCanvas";
import { useLocale } from "../../i18n/i18nContext";

/** 让调用方（`ResumeZoomModal`）只多一条 import 就能拿到这个类型。 */
export type { RichTextEditAdapter } from "../resume-preview/richText";

/**
 * 没有草稿通道时的替身（只读宿主 / 生成流程的预览态）。
 *
 * 必须是**模块级常量**：`useSyncExternalStore` 拿它当 `subscribe` 的依赖，每次渲染新建一个
 * 对象会让它每次重新订阅（每帧一次订阅/退订），而 `getSnapshot` 也必须返回稳定引用。
 * 这里的 `getSnapshot` 恒返回 `null`——语义正是"没有草稿，用宿主那一版"。
 */
const NO_DRAFT_STORE: ResumeDraftStore = createResumeDraftStore(0);

interface Props {
  html: string;
  warnings: string[];
  pages: number;
  previewRef: RefObject<ResumePreviewHandle | null>;
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  exactPreview?: ExactPreviewOptions;
  onPickField?: (path: string) => void;
  richEdit?: RichTextEditAdapter;
  /** 合并 overlay 之后的正文；`null` = 中栏没有内容，实时预览不启用。 */
  content: ResumeContent | null;
  layout?: ResumeLayout;
  /** 保存（内容或版式）在飞：实时预览让路，别用旧结果盖住保存返回的 html。 */
  suspended?: boolean;
  /**
   * 中栏的草稿通道（P0-7）。**订阅只发生在这个薄壳里**：三栏（参数 / 中栏 / 画布外壳）
   * 不因每键输入而重渲染（设计 §7 R3）。
   */
  draftStore?: ResumeDraftStore;
  /**
   * 草稿内容的再加工（加粗 overlay）：`overlays.merge`。
   *
   * `mergeOverlays` 只在"路径当前值 === overlay.base"时生效，所以用户在编辑器里改过这个
   * 字段后 overlay 自动作废——"加粗 + 改字"叠加时显示的是合并后的结果，不需要额外通知。
   */
  mergeLive?: (content: ResumeContent | null) => ResumeContent | null;
  /**
   * 专业视图（W15）的宿主能力：命令（保存/导出…）、工作区预设、照片裁剪通道。
   *
   * 不传时画布内置能力（缩放档位/页导航/辅助线/灰度校样/命令面板）照常可用——
   * 这些只改视图状态；保存/导出命令、照片裁剪与工作区预设**必须**由宿主注入，
   * 没有回调就不渲染对应入口（不做点了没反应的按钮）。
   */
  proview?: ProviewShellConfig;
}

export default function ResumeWorkbenchLiveCanvas({
  html,
  warnings,
  pages,
  previewRef,
  previewMode,
  onPreviewModeChange,
  exactPreview,
  onPickField,
  richEdit,
  content,
  layout,
  suspended = false,
  draftStore,
  mergeLive,
  proview,
}: Props) {
  useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * 中栏正在编辑的那一版（`null` = 没有草稿，用宿主那一版）。
   *
   * `content` prop 永远是**服务端已保存**的那一份（宿主传下来的 `liveContent ?? content`）；
   * 草稿只从这里进来，绝不回写成 `content`——那是"用户每打一个字就被服务端覆盖"的成因。
   */
  const store = draftStore ?? NO_DRAFT_STORE;
  const draft = useSyncExternalStore(store.subscribe, store.getSnapshot);
  /**
   * 草稿 + 加粗 overlay 的合并结果。
   *
   * **必须 memo**：`mergeOverlays` 在真的叠了 overlay 时会返回**新对象**，每次渲染都调一遍
   * 就等于每帧给 `useResumeLivePreview` 一个"内容变了"的信号——那条 effect 会重新排一次
   * 防抖，于是每次渲染都重置计时器，实时预览永远停在"更新中"（自激）。按"草稿这一版"缓存
   * 之后，同一份草稿在整个渲染期间是同一个引用。
   */
  const mergedDraft = useMemo(() => {
    if (!draft) return null;
    const merged = mergeLive?.(draft) ?? draft;
    // 草稿也要补条目 id（W01）：面板的条目下拉读的是历史里那份草稿，两边各自补一次
    // 也必须是**同一批 id**（`ensureEntryIds` 按内容签名记住补出来的 id 表）。
    // 已有合法 id 的条目原样返回，所以这条对正常编辑是零变化。
    return ensureEntryIds(merged);
  }, [draft, mergeLive]);
  /**
   * 正文优先级（只此三条分支，不许多一条）：
   * 草稿（叠加加粗）→ 宿主的实时正文。
   */
  const previewContent = mergedDraft ?? content;
  /**
   * 实时结果与它**基于哪一版宿主 html**。
   *
   * 不用"html 变了就在 effect 里清空"的写法：`source` 与 prop 一比就知道结果是否过期，
   * 既少一轮级联渲染，也不会有"effect 还没跑、界面已经先显示旧结果"的那一帧。
   */
  const [live, setLive] = useState<{ source: string; html: string } | null>(null);

  // `renderResume` 签名稳定（模块级函数），这里再包一层是为了把 `signal` 传进去。
  const runRender = useCallback(
    (next: ResumeContent, nextLayout: ResumeLayout, signal: AbortSignal) =>
      renderResume(next, nextLayout, signal),
    [],
  );
  // 结果记下"生成它时宿主给的是哪一版"：宿主一换 html，这条结果自动失效。
  const handleHtml = useCallback((next: string) => setLive({ source: html, html: next }), [html]);

  /**
   * 精确预览用的上下文：把**还没保存**的正文一起带上（W04 / P0-03）。
   *
   * 只在这一层算：本组件本来就随每次草稿变化重渲染（订阅点在这里），而
   * `ResumeZoomModal` 刻意不订阅草稿——在那一层订阅会让每键输入重渲染整个三栏。
   * 签名同步改成这份草稿的签名，否则 `formatKey` 不变、请求根本不会重发。
   *
   * **没有草稿时也要覆盖 content**：`exactPreview` 是宿主用 `detail.content`（后端读旧记录
   * 时**没有条目 id** 的那一份）组出来的，直接透传会让精确预览按"没有身份"的正文排版，
   * `format_config.field_layout.entries.<id>` / `objects.<id>` 一律失效（条目级排版在精确
   * 预览里静默退回分区默认）。本组件的 `content` prop 已经是补过 id 的那一份。
   */
  const exactPreviewWithDraft = useMemo(() => {
    if (!exactPreview) return exactPreview;
    const nextContent = mergedDraft ?? content;
    if (!nextContent) return exactPreview;
    return {
      ...exactPreview,
      content: nextContent,
      contentSignature: contentSignature(nextContent),
    };
  }, [exactPreview, mergedDraft, content]);

  const { state, retry, suspend, resume } = useResumeLivePreview({
    enabled: Boolean(previewContent) && previewMode !== "exact",
    content: previewContent,
    layout,
    render: runRender,
    onHtml: handleHtml,
    scrollRef,
  });

  useEffect(() => {
    if (suspended) suspend();
    else resume();
  }, [resume, suspended, suspend]);

  const status =
    state === "error" ? (
      <Space size={4}>
        <Typography.Text type="secondary" className="resume-wb-canvas-note">
          {t("rich.preview.stale")}
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
    <ProviewProvider config={proview ?? {}}>
      <ResumeWorkbenchCanvas
        html={live && live.source === html ? live.html : html}
        warnings={warnings}
        pages={pages}
        previewRef={previewRef}
        previewMode={previewMode}
        onPreviewModeChange={onPreviewModeChange}
        exactPreview={exactPreviewWithDraft}
        onPickField={onPickField}
        richEdit={richEdit}
        scrollRef={scrollRef}
        status={status}
      />
    </ProviewProvider>
  );
}
