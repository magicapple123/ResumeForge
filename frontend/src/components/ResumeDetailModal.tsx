// SPDX-License-Identifier: Apache-2.0
/** 简历记录预览弹窗（历史记录用）：加载详情、调整版式、渲染 HTML 后展示。
 *
 * 预览主体已抽到 ``components/resume/ResumeDetailPreview``（B3）：本弹窗只负责
 * 加载 detail/html、错误与骨架屏，以及把「换版式 / 自动一页 / 保存编辑」这些会改
 * 数据与重渲染的动作准备好，交给共享组件渲染。
 */
import { CloseOutlined } from "@ant-design/icons";
import { Alert, App, Button, Modal, Popconfirm, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchResumeHtml, fetchResumeTemplates, getResume, renderResume } from "../api/resumes";
import type { ResumeDetail, ResumeLayout } from "../types";
import type { LayoutMeasure } from "../utils/resumeLayoutMeasure";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import {
  createResumeDocumentHost,
  DEFAULT_RESUME_LAYOUT,
  layoutFromDetail,
} from "../features/resume-document/resumeDocumentHost";
import { revisionOf } from "../features/resume-document/saveOutcome";
import { remapAnnotationPaths } from "../features/resume-outline";
import type { PathRemap } from "../features/resume-outline/paths";
import type { ResumeDocumentPipeline } from "../features/resume-document/types";
import { setActiveWritingResume } from "../features/resume-writing/activeResume";
import { useResumeRelayout } from "../features/resume/useResumeRelayout";
import { useRichTextOverrides } from "../features/resume/useRichTextOverrides";
import type { RichTextOverlayMap } from "../features/resume/useRichTextOverrides";
import type { RichTextEditAdapter } from "./resume-preview/richText";
import ResumeDeliveryInfo from "./resume/ResumeDeliveryInfo";
import ResumeDetailPreview from "./resume/ResumeDetailPreview";
import ResumeProfileUsage from "./resume/ResumeProfileUsage";
import PageSkeleton from "./common/PageSkeleton";
import type { ResumePreviewHandle } from "./ResumePreview";

interface Props {
  recordId: number | null;
  onClose: () => void;
  /** 打开就进制作台（「新建简历 → 前往简历制作台」）。见 `ResumeDetailPreview`。 */
  autoOpenWorkbench?: boolean;
}

export default function ResumeDetailModal({ recordId, onClose, autoOpenWorkbench = false }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [detail, setDetail] = useState<ResumeDetail | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<ResumeLayout>(DEFAULT_RESUME_LAYOUT);
  const [savedLayout, setSavedLayout] = useState<ResumeLayout>(DEFAULT_RESUME_LAYOUT);
  const [layoutStatus, setLayoutStatus] = useState<{
    pages: number;
    overflow: boolean;
  } | null>(null);
  const [pdfDirectAvailable, setPdfDirectAvailable] = useState(true);
  const [layoutSaving, setLayoutSaving] = useState(false);
  // 预览量到的实测高度：只有浏览器能量准，所以由预览上报、这里转交给诊断面板。
  const [measure, setMeasure] = useState<LayoutMeasure | null>(null);
  const previewRef = useRef<ResumePreviewHandle>(null);
  /**
   * 「右键加粗」的乐观叠加层：把还没保存的粗体记在 `detail.content` 之外（见
   * `useRichTextOverrides` 文件头）。这里是它**唯一**的持有者——只有这一层同时握着
   * `detail.content`、`setHtml`、保存链路与制作台的历史。受控模式把 state 放在这里，
   * 制作台只是读取并回写，于是撤销/恢复能连粗体一起退回去（W02/W03）。
   */
  const [overlayMap, setOverlayMap] = useState<RichTextOverlayMap>({});
  const overlays = useRichTextOverrides(detail?.content ?? null, {
    overlays: overlayMap,
    onChange: setOverlayMap,
  });

  /**
   * 把"正在看哪份简历"登记给全局右键菜单（写作增强的四个动作都要 `resume_id`）。
   *
   * 登记在**详情弹窗**这一层而不是编辑器面板：制作台、手动调整、只看预览三种形态下
   * 用户都可能选中文字右键，而它们是同一个弹窗的三个子视图。关掉弹窗即注销，
   * 免得在岗位页右键时冒出一个属于上一份简历的写作增强。
   */
  /**
   * W06 大纲结构命令之后：加粗 overlay 与事实标注的 path 跟着对象换到新下标。
   * 不做这一步，把第二个项目移到第一位后，experience.1.* 的加粗会绑到别的项目上。
   */
  const handleRemapPaths = useCallback(
    (remap: PathRemap) => {
      overlays.remapPaths(remap);
      setDetail((previous) =>
        previous
          ? {
              ...previous,
              fact_annotations: remapAnnotationPaths(previous.fact_annotations ?? [], remap),
            }
          : previous,
      );
    },
    [overlays],
  );

  /** 服务端已有新版本（表达资产插入等）：刷新 detail 并重渲染预览（不写库）。 */
  const handleDocumentSynced = useCallback(
    (synced: ResumeDetail) => {
      setDetail({ ...synced, draft: false });
      void renderResume(synced.content, layout).then((rendered) => setHtml(rendered));
    },
    [layout],
  );

  const activeResumeId = detail?.id ?? null;
  useEffect(() => {
    setActiveWritingResume(activeResumeId);
    return () => setActiveWritingResume(null);
  }, [activeResumeId]);
  /**
   * 预览用的加粗契约。**这里刻意不重渲染 html**：
   *
   * 纸面上那一栏已经被 `useClickToEditPreview` 就地改过（立刻看到粗体），随后由制作台的实时
   * 预览（合并内容整份重排）或保存后的重渲染收口。若在这里再发一次 `/render`，iframe 会白屏
   * 重载一次，把用户刚恢复的选区一并丢掉——用户的感受是"点加粗，页面闪了一下"。
   */
  const richEdit = useMemo<RichTextEditAdapter | undefined>(() => {
    if (!detail) return undefined;
    return {
      read: (path) => overlays.read(path),
      toggle: (path, next, base) => {
        overlays.apply(path, next, base);
      },
    };
  }, [detail, overlays]);
  /**
   * 版式重排：尾随合并（`useResumeRelayout`，项 6 / D11）。
   *
   * 本地草稿只在**渲染成功之后**推进（`onRendered`），所以"读数已经前进、画面还是旧版式"
   * 这种不一致不可能出现——这正是本项要修掉的既有缺陷（C5 的第一种形态）。
   * 失败时**不重试**、只提示并清掉探针（D13：探针是"我看到的"，渲染失败就不能继续呈现它）。
   */
  const { relayouting, request: requestLayout } = useResumeRelayout({
    render: async (next) => {
      if (!detail) return;
      setHtml(await renderResume(detail.content, next));
    },
    onRendered: (next) => setLayout(next),
    onError: (err) => {
      message.error(err instanceof Error ? err.message : t("resume.detail.relayoutFailed"));
      previewRef.current?.setLiveProbe("");
    },
  });
  const [suggestionsGenerated, setSuggestionsGenerated] = useState(false);
  const [suggestionsResetKey, setSuggestionsResetKey] = useState(0);
  const loadedRecordId = useRef<number | null>(null);
  const requestVersion = useRef(0);
  const saveRequestVersion = useRef(0);
  const layoutDirty = JSON.stringify(layout) !== JSON.stringify(savedLayout);
  /**
   * 关闭前的确认卡片（2026-10-24）：排版设置改了没保存时，关窗会把它一起丢掉。
   *
   * 内容那一半不在这里管——「手动调整」子弹窗有自己的守卫（`useResumeEditorPanel` 的
   * 脏值确认），两层各问一句会让用户连点两次才关得掉。
   *
   * 判断写在 `Popconfirm` 的 `onOpenChange` 里而不是按钮的 `onClick` 上：antd 会把
   * `Popconfirm` 自己的 onClick 与子元素的合并，两处各写一份就会"问完又立刻关掉"。
   */
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const handleCloseRequest = (next: boolean) => {
    if (!next) return setCloseConfirmOpen(false);
    if (layoutDirty) setCloseConfirmOpen(true);
    else onClose();
  };
  // 确认后先收起卡片再关：这张卡片住在弹窗里，留着 `open` 的话换一份简历再打开会直接
  // 亮着一张"要不要丢弃"的卡片。
  const confirmClose = () => {
    setCloseConfirmOpen(false);
    onClose();
  };

  // Compiler 规范：随 recordId 变化的重置用渲染期守卫式调整（含首次挂载）；
  // ref 失效递增与异步取数留在 effect。
  const [prevRecordId, setPrevRecordId] = useState<number | null | undefined>(recordId);
  if (prevRecordId !== recordId) {
    setPrevRecordId(recordId);
    setDetail(null);
    setHtml("");
    setError("");
    setLayoutStatus(null);
    // 换一份简历：上一条留下的加粗 overlay 绝不能跟过来（同名字段很可能就是同一句原文）。
    overlays.clear();
    // 换一份简历：上一份留下的"要不要丢弃排版"卡片不能跟过来。
    setCloseConfirmOpen(false);
  }

  useEffect(() => {
    const currentRequest = ++requestVersion.current;
    if (!recordId) return;
    // "上次加载的记录 id"跨渲染比较属于 ref 读写：按规则必须留在 effect 内。
    const isNewRecord = loadedRecordId.current !== recordId;
    loadedRecordId.current = recordId;
    if (isNewRecord) {
      setSuggestionsGenerated(false);
      setSuggestionsResetKey((value) => value + 1);
    }
    void Promise.all([getResume(recordId), fetchResumeHtml(recordId)])
      .then(([data, rendered]) => {
        if (currentRequest !== requestVersion.current) return;
        setDetail(data);
        setHtml(rendered);
        // 版式跟着记录走：上次用的是哪套，这次打开还是哪套（字段兜底只在 layoutFromDetail 一处）。
        const nextLayout = layoutFromDetail(data);
        setLayout(nextLayout);
        setSavedLayout(nextLayout);
      })
      .catch((err) => {
        if (currentRequest === requestVersion.current) {
          setError(err instanceof Error ? err.message : t("resume.detail.loadFailed"));
        }
      });
    return () => {
      if (currentRequest === requestVersion.current) requestVersion.current += 1;
    };
  }, [recordId]);

  // 只有第一次打开时才去问后端的模板目录（能不能直接生成 PDF）。
  useEffect(() => {
    void fetchResumeTemplates()
      .then((catalog) => setPdfDirectAvailable(catalog.pdf_direct_available))
      .catch(() => {
        // 取不到目录时仍允许导出，失败会由导出接口给出提示。
      });
  }, []);

  /** 旧建议 / 风险扫描结论在正文变化后过期：保存成功与"用最新的"都要重置。 */
  const resetSuggestionState = () => {
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
  };

  // 请求序号读写的**稳定闭包**：ref 本身不进渲染期执行的对象，规则要求只能经由
  // useCallback 暴露（真正的读写都发生在保存回调里）。
  const readRequestVersion = useCallback(() => requestVersion.current, []);
  const readSaveRequestVersion = useCallback(() => saveRequestVersion.current, []);
  const nextSaveRequestVersion = useCallback(() => {
    saveRequestVersion.current += 1;
    return saveRequestVersion.current;
  }, []);

  /**
   * 文档写入层（W02）：条件写、冲突终态、草稿发布、"用最新的 / 另存副本"全在那一份实现里
   * （`features/resume-document/resumeDocumentHost.ts`），本组件只负责接 UI。
   */
  // eslint-disable-next-line react-hooks/refs -- 交给宿主的是"读请求序号"的稳定闭包，只在保存回调里调用
  const hostDocument = createResumeDocumentHost({
    detail,
    layout,
    layoutDirty,
    layoutSaving,
    overlays,
    message,
    readRequestVersion,
    readSaveRequestVersion,
    nextSaveRequestVersion,
    setDetail,
    setHtml,
    setLayout,
    setSavedLayout,
    setLayoutSaving,
    resetSuggestions: resetSuggestionState,
    render: renderResume,
  });
  // 老入口别名：主预览底部「保存」与「手动调整」弹窗继续走无版本条件的写（行为逐字不变）。
  const saveEditedResume = hostDocument.saveEditedResume;
  const saveLayout = hostDocument.saveLayout;
  const publishDraft = hostDocument.publishDraft;
  /**
   * W02 条件写通道：制作台整体保存消费它。`revision` 取**当前 detail** 的版本——保存成功后
   * 宿主 `setDetail` 会带来新值，下一轮保存自然用新版本。
   */
  const documentPipeline: ResumeDocumentPipeline | undefined = detail
    ? {
        revision: revisionOf(detail),
        saveLayout: hostDocument.commitLayout,
        saveContent: hostDocument.saveEditedResumeConditional,
        publishDraft: hostDocument.publishDraftConditional,
        fetchLatest: () => getResume(detail.id),
        adoptLatest: hostDocument.adoptLatest,
        saveAsCopy: hostDocument.saveAsCopy,
        // 纸面加粗的唯一状态：制作台的统一历史把它并进快照，撤销/恢复经这里回写。
        overlays: overlayMap,
        onOverlaysChange: setOverlayMap,
      }
    : undefined;

  /**
   * AI 修订（AI 修改 / 采纳建议）成功后的刷新：修订接口已在服务端落库，这里只需
   * 按新内容重渲染预览。旧建议基于修订前的正文，一并重置。
   */
  const applyRevisedDetail = async (updated: ResumeDetail) => {
    const requestAtStart = requestVersion.current;
    const rendered = await renderResume(updated.content, layout);
    if (requestAtStart !== requestVersion.current) return;
    setDetail(updated);
    setHtml(rendered);
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
  };

  const cancelLayout = () => {
    if (!detail || !layoutDirty || relayouting || layoutSaving) return;
    // 走同一条重排通道：草稿在渲染成功后才回到 `savedLayout`（一个宿主只有一套口径）。
    requestLayout(savedLayout);
  };

  return (
    <Modal
      title={
        // 标题行右侧自绘 ×（`closable={false}`）：卡片长在用户刚点的地方，不用把视线
        // 拉到底部去找确认。
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{detail?.title ?? t("resume.detail.titleFallback")}</span>
          <Popconfirm
            open={closeConfirmOpen}
            onOpenChange={handleCloseRequest}
            title={t("workbench.close.title")}
            description={t("resume.preview.close.body")}
            okText={t("workbench.close.confirm")}
            cancelText={t("common.action.keep-editing")}
            okButtonProps={{ danger: true }}
            onConfirm={confirmClose}
            placement="bottomRight"
          >
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label={t("common.action.close")}
              style={{ marginLeft: "auto" }}
            />
          </Popconfirm>
        </div>
      }
      open={!!recordId}
      onCancel={() => handleCloseRequest(true)}
      // × 由标题行自绘（见上），弹窗自带的那个会和它并排出现两颗。
      closable={false}
      width="min(960px, 96vw)"
      footer={null}
      // 弹窗自身滚动：预览区高度已经与上方内容解耦（见 ResumePreview 的固定预算），
      // 内容再长也只是让这里滚动，不去压缩预览。
      // 正文右缘原本紧贴滚动条（body 自己就是滚动容器，左右内边距为 0）：滚动条一出现
      // 内容就被顶到它边上。右侧留 12px 让两者分开；再用等量的负外边距把这 12px
      // 从弹窗内边距里"借"回来，内容宽度因此一点不变——滚动条整条往弹窗边缘挪
      // 12px，左右看起来也仍然平衡。
      styles={{
        body: {
          maxHeight: "var(--rf-modal-body-max-h)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 12,
          marginRight: -12,
        },
      }}
      destroyOnHidden
    >
      {error ? (
        <Alert type="error" showIcon title={error} />
      ) : !detail || !html ? (
        <PageSkeleton rows={8} card={false} />
      ) : (
        <>
          {/* 关联上下文（RF-11）：这份简历对着哪个岗位，投递进度与模拟面试都带着
              job_id 直达，不必到对应模块再找一遍岗位。纯 Link 行、零新增请求；
              通用简历（无 job_id）没有这行（预览头部的「通用简历」标签照旧）。 */}
          {detail.job_id ? (
            <Space size={12} wrap style={{ marginBottom: 12 }}>
              <Link to={`/jobs?job_id=${detail.job_id}`}>{t("resume.detail.link.job")}</Link>
              <Typography.Text type="secondary">·</Typography.Text>
              <Link to={`/tracker?job_id=${detail.job_id}`}>
                {t("resume.detail.link.progress")}
              </Link>
              <Typography.Text type="secondary">·</Typography.Text>
              <Link to={`/interview?job_id=${detail.job_id}`}>
                {t("resume.detail.link.interview")}
              </Link>
            </Space>
          ) : null}
          {/* 本次使用（R-33）：保存/生成时的组与参与大字段；资料/定义变了提示需重新生成。
              纯只读，读取失败时整块隐藏（不阻断下面的正文预览）。 */}
          <ResumeProfileUsage recordId={detail.id} />
          {/* 版本信息位（RF-17）：血缘 + 投递记录，弹窗打开时按需拉取一次。 */}
          <div style={{ marginBottom: 12 }}>
            <ResumeDeliveryInfo
              recordId={detail.id}
              parentRevisionId={detail.parent_revision_id ?? null}
            />
          </div>
          <ResumeDetailPreview
            detail={detail}
            html={html}
            layout={layout}
            autoOpenWorkbench={autoOpenWorkbench}
            // 叠加了纸面上加粗的那几条：只给制作台的实时预览用（中栏编辑器仍吃服务端内容）。
            liveContent={overlays.merged ?? undefined}
            // 加粗也是"还没保存的改动"：不并进脏值，关制作台时会静默丢掉。
            richDirty={overlays.dirty}
            onDiscardRichText={overlays.clear}
            // 中栏草稿也要叠上加粗再送预览：草稿里没有 overlay，不合并就会"改了字、加粗消失"。
            mergeLive={overlays.merge}
            richEdit={richEdit}
            layoutStatus={layoutStatus}
            measure={measure}
            pdfDirectAvailable={pdfDirectAvailable}
            relayouting={relayouting}
            previewRef={previewRef}
            onLayoutStatus={setLayoutStatus}
            onMeasure={setMeasure}
            onApplyLayout={(next) => requestLayout(next)}
            // 制作台顶部「保存修改」要落库版式：把这条已有的 PATCH 链路直接交给它。
            // 底部那颗「保存」按钮仍在（定位不同：它只存版式，不动内容），两者共用本函数
            // 内部的 `layoutDirty / layoutSaving` 守卫，谁先点都不会发两次请求。
            onCommitLayout={saveLayout}
            // W02 条件写 + 409 冲突三选一：见 `documentPipeline`。
            documentPipeline={documentPipeline}
            onRemapPaths={handleRemapPaths}
            onDocumentSynced={handleDocumentSynced}
            // 草稿且什么都没脏时点「保存到简历中心」：见 `publishDraft`。
            onPublishDraft={publishDraft}
            // 版式 PATCH 在飞时制作台顶部的「保存修改」必须禁用：这条链路此刻返回 `false`
            // （同一时刻不许发两次 PATCH），若按钮还能点，用户会看到"点了、按钮还在、没有提示"，
            // 而内容其实一次都没存。
            layoutSaving={layoutSaving}
            onApplyFittedFormat={(formatConfig) =>
              // 「自动一页」也只写入当前草稿：同一条重排通道，不另开一份"正在重排"口径。
              requestLayout({ ...layout, format_config: formatConfig })
            }
            extraActions={
              layoutDirty ? (
                <Space size={8}>
                  <Button onClick={cancelLayout} disabled={relayouting || layoutSaving}>
                    {t("common.action.cancel")}
                  </Button>
                  <Button
                    type="primary"
                    loading={layoutSaving}
                    disabled={relayouting}
                    onClick={() => void saveLayout()}
                  >
                    {t("common.action.save")}
                  </Button>
                </Space>
              ) : null
            }
            onSaveEditedResume={(content) => saveEditedResume(content)}
            onResumeRevised={(updated) => applyRevisedDetail(updated)}
            suggestionsGenerated={suggestionsGenerated}
            suggestionsResetKey={suggestionsResetKey}
            onSuggestionsGenerated={() => setSuggestionsGenerated(true)}
          />
        </>
      )}
    </Modal>
  );
}
