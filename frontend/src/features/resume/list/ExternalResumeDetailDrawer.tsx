// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历详情弹层（R9-4 / R9-6 / R9-7 / R11 / R12 / R22）：原件、提取文本、文本检查、
 * 编辑、历史版本。
 *
 * ## 为什么是居中 Modal 而不是全宽 Drawer
 *
 * Drawer 从右侧拉满，宽 1080 的页面挤在左边、右边留一大片空白，看起来像"没画完"。
 * 改成 1080 × 86vh 的居中卡片后，页面在灰画布居中，标题下面一行说明取代了原来悬在
 * 右侧的提示（R9-4）。
 *
 * ## 「原件」页签为什么不再是 iframe
 *
 * iframe 里跑的是浏览器自带的 PDF 阅读器，画布与工具栏跟随浏览器/系统主题，CSS 进不去
 * ——暗色下它就是界面里的一块亮岛（R12）。现在换成 `pdf.js` 画到 canvas 上，配色、工具栏、
 * 打印都在自己手里（`ExternalOriginalPreview`），DOCX / TXT / MD 走 `ExternalDocumentPreview`。
 *
 * ## 契约（与 CONTRACT.md 第 1 节一致）
 *
 * `resumeId` / `open` / `onClose` / `onChanged` / `refreshKey`。`onChanged` 在**编辑 /
 * 恢复**成功后调用（无参数、幂等，列表侧只做 `reload()`），本组件不负责接线。
 *
 * 检查结果**没有总分**：只按条目渲染每类结论（占位符 / 量化 / 联系方式 / 长度 /
 * 弱表述 / 关键词），每条带行号与原文片段；未提取到文字时只给一条说明，绝不显示
 * "检查通过"。
 */
import { Alert, Button, Modal, Space, Tabs, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  getExternalResume,
  getExternalResumeAnalysis,
  getExternalResumeRevisionText,
} from "../../../api/externalResumes";
import type {
  ExternalResumeAnalysis,
  ExternalResumeDetail,
  ExternalResumeRevision,
} from "../../../api/externalResumes";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { ExternalResumeDetailActions } from "../../external-resume/ExternalResumeDetailActions";
import { fileKindBadge, fileKindOf } from "../../../utils/fileKind";
import { formatDateTime } from "../../../utils/format";
import { ExternalResumeCheckList } from "../external/ExternalResumeCheckList";
import { ExternalResumeEditTab } from "../external/ExternalResumeEditTab";
import { ExternalOriginalPreview } from "../external/ExternalOriginalPreview";
import { ExternalResumeRevisions } from "../external/ExternalResumeRevisions";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import "../external/externalPreview.css";

export type ExternalResumeDetailTab = "original" | "text" | "check" | "edit" | "revisions";

/*
 * 「文本检查」的呈现（六类结论、标签、占比文案）已搬到
 * `features/resume/external/ExternalResumeCheckList.tsx`：这里只留弹层骨架（Modal、
 * 五个页签、记录缓存、历史版本视图），再往下塞一百多行"占比怎么算"就过 500 行预算了。
 */

export interface ExternalResumeDetailDrawerProps {
  resumeId: number | null;
  /**
   * 是否显示。**不传时按 `resumeId !== null` 推断**——两个既有调用点
   * （简历中心列表、岗位图谱预览）都只传 `resumeId`，这样它们不用改也不会失效。
   */
  open?: boolean;
  onClose: () => void;
  /** 编辑 / 恢复 成功后调用；无参数、可重复调用（列表侧只做 `reload()`）。 */
  onChanged?: () => void;
  /** 外部变更信号（如 `record.file_id`）：进历史版本列表的依赖，用于编辑后立刻刷新。 */
  refreshKey?: string | number;
  /** 打开就落在哪个页签（列表「点文件名进文本页」这类深链用）。 */
  initialTab?: ExternalResumeDetailTab;
  /**
   * 打开就**看某一版历史版本**（T12）。
   *
   * 给了它，「原件」页签画的是那一版的文件、「文本」页签读的是那一版的正文，并在弹层
   * 顶部出一条"正在看历史版本"的提示——三条一起切，用户才不会把旧内容当成现在的。
   * 不给就是当前版本（既有调用点一个也不用改）。
   */
  revisionId?: number;
}

export function ExternalResumeDetailDrawer({
  resumeId,
  open: openProp,
  initialTab = "original",
  onClose,
  onChanged,
  refreshKey,
  revisionId,
}: ExternalResumeDetailDrawerProps) {
  useLocale();
  /**
   * 详情与检查结果都按**记录 id 缓存**（`{id, ...}`），渲染时只认"和当前 resumeId 匹配"
   * 的那份。这样切换/关闭时不需要在 effect 里同步清状态（那会触发 cascading render 的
   * lint 警告，也会让下一次打开先闪一眼上一份简历）。
   */
  const [detail, setDetail] = useState<{
    id: number;
    record: ExternalResumeDetail | null;
    error: string;
  } | null>(null);
  const [analysisState, setAnalysisState] = useState<{
    id: number;
    data: ExternalResumeAnalysis | null;
    error: string;
    loading: boolean;
  } | null>(null);
  const [tabState, setTabState] = useState<{
    id: number;
    tab: ExternalResumeDetailTab;
  } | null>(null);
  /**
   * 当前是否在"看某一版历史版本"（T12）。
   *
   * 与 `detail` / `tabState` 同一套缓存口径：带上 `resumeId`，换一份简历时天然失效，
   * 不需要在 effect 里清状态（那会多一轮渲染，也会先闪一眼上一份的版本）。
   * `at` 是那一版的时刻，用于提示条；深链只给了 id 时为空串，提示条就不写时间。
   */
  const [viewState, setViewState] = useState<{
    id: number;
    revisionId: number;
    at: string;
  } | null>(
    revisionId === undefined || resumeId === null ? null : { id: resumeId, revisionId, at: "" },
  );
  const open = openProp ?? resumeId !== null;
  const record = detail !== null && detail.id === resumeId ? detail.record : null;
  const detailError = detail !== null && detail.id === resumeId ? detail.error : "";
  const tab = tabState !== null && tabState.id === resumeId ? tabState.tab : initialTab;
  const viewing = viewState !== null && viewState.id === resumeId ? viewState : null;

  /**
   * 编辑 / 恢复之后换掉本弹层里的记录，并把文本检查的缓存作废。
   *
   * 换 `record` 的目的是让「原件」页签的地址跟着 `file_id` 变（否则改完还在看旧 PDF），
   * 也让成功条上的两个入口点进去就是新内容。作废检查结果是因为正文已经变了：不清的话
   * 切回「文本检查」会读到上一次的结论，而"检查通过了"这件事在新正文上可能并不成立。
   */
  const applyRecord = useCallback(
    (next: ExternalResumeDetail, keepView = false) => {
      setDetail((previous) =>
        previous !== null && previous.id === next.id ? { ...previous, record: next } : previous,
      );
      setAnalysisState(null);
      // 恢复 / 编辑都会产生**新版本**：提示条上那句"当前版本没有改变"已经不成立，收起来。
      // 收藏 / 备注 / 重命名（T28）不改版本，所以保持"正在看的那一版"不被踢掉。
      if (!keepView) setViewState(null);
      onChanged?.();
    },
    [onChanged],
  );

  /** 历史版本列表里点「预览」：把原件、文本与提示条一起切到那一版（T12）。 */
  const showRevision = useCallback(
    (revision: ExternalResumeRevision) => {
      if (resumeId === null) return;
      setViewState({ id: resumeId, revisionId: revision.id, at: revision.created_at });
    },
    [resumeId],
  );

  /**
   * 文本检查按需加载（只对"有文字"的简历有意义；空正文由界面直接说明）。
   *
   * 由**事件**触发（切到检查标签 / 详情带 initialTab=check 回来），不在 effect 里
   * 跟着状态跑：那会在 setState 后重跑 effect、把上一次请求的 cancelled 置真，
   * 表现是"永远转圈"。这里按记录 id 缓存结果，重复点同一标签不重复请求。
   */
  const loadAnalysis = useCallback((id: number, force = false) => {
    setAnalysisState((previous) => {
      if (!force && previous && previous.id === id && (previous.loading || previous.data)) {
        return previous;
      }
      return { id, data: null, error: "", loading: true };
    });
    void getExternalResumeAnalysis(id)
      .then((next) => {
        setAnalysisState((previous) =>
          previous && previous.id === id ? { id, data: next, error: "", loading: false } : previous,
        );
      })
      .catch((error: unknown) => {
        setAnalysisState((previous) =>
          previous && previous.id === id
            ? {
                id,
                data: null,
                error:
                  error instanceof Error ? error.message : t("resumesPage.external.checkFailed"),
                loading: false,
              }
            : previous,
        );
      });
  }, []);

  // 打开/切换记录：取详情（旧记录的数据靠渲染层的 id 匹配自然失效，不用先清空）。
  useEffect(() => {
    if (resumeId === null) return;
    let cancelled = false;
    void getExternalResume(resumeId)
      .then((next) => {
        if (cancelled) return;
        setDetail({ id: resumeId, record: next, error: "" });
        // 深链直接落在「文本检查」时，详情到手后再拉检查结果（有正文才值得拉）。
        if (initialTab === "check" && next.has_text) loadAnalysis(next.id);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetail({
          id: resumeId,
          record: null,
          error: error instanceof Error ? error.message : t("resumesPage.external.loadFailed"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, initialTab, loadAnalysis]);

  /** 成功条 / 深链用的页签切换。 */
  const goto = useCallback(
    (next: ExternalResumeDetailTab) => {
      if (resumeId === null) return;
      setTabState({ id: resumeId, tab: next });
      if (next === "check" && record !== null && record.has_text) loadAnalysis(record.id);
    },
    [resumeId, record, loadAnalysis],
  );

  const textView = () => {
    if (!record) return null;
    // 在看历史版本时，正文来自那一版自己的文件（历史表不存正文，按需提取）。
    if (viewing !== null) {
      return <RevisionTextView resumeId={record.id} revisionId={viewing.revisionId} />;
    }
    if (!record.has_text) {
      return <Alert type="warning" showIcon title={t("resumesPage.external.textEmpty")} />;
    }
    return (
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
          fontFamily: "inherit",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        {record.text}
      </pre>
    );
  };

  const checkView = () => {
    if (!record) return null;
    if (!record.has_text) {
      return (
        <Alert
          type="warning"
          showIcon
          title={t("resumesPage.external.textEmpty")}
          description={t("resumesPage.external.checkNoText")}
        />
      );
    }
    // 检查结果按记录缓存：打开时要么在加载、要么已有结果（由 loadAnalysis 维护）。
    const current = analysisState && analysisState.id === record.id ? analysisState : null;
    if (current === null || current.loading) {
      return <LoadingBlock tip={t("resumesPage.external.checkLoading")} />;
    }
    if (current.error) return <ErrorState description={current.error} />;
    if (current.data === null) {
      return <LoadingBlock tip={t("resumesPage.external.checkLoading")} />;
    }
    if (current.data.warnings.length > 0) {
      return <Alert type="warning" showIcon title={current.data.warnings[0]} />;
    }
    return <ExternalResumeCheckList analysis={current.data} />;
  };

  const badge = record === null ? null : fileKindBadge(fileKindOf(record.mime, record.name));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      // 1080 × 86vh：页面居中、右侧不再留空白列（R9-4）。
      width={1080}
      className="rf-ext-detail-modal"
      style={{ maxWidth: "96vw", maxHeight: "94vh" }}
      styles={{
        body: {
          height: "86vh",
          minHeight: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        },
      }}
      title={
        <div className="rf-ext-modal-head">
          <Space size={8} wrap>
            <Typography.Text strong>{t("resumesPage.external.detailTitle")}</Typography.Text>
            {record ? <Typography.Text>{record.name}</Typography.Text> : null}
            {badge ? <Tag>{badge}</Tag> : null}
          </Space>
          {/* 原来悬在右侧的提示改成标题下一行（R9-4）。 */}
          <Typography.Text type="secondary" className="rf-ext-modal-hint">
            {t("externalEdit.detail.hint")}
          </Typography.Text>
        </div>
      }
    >
      {detailError ? (
        <ErrorState description={detailError} />
      ) : record === null ? (
        <LoadingBlock />
      ) : (
        <>
          {viewing === null ? null : (
            // 三条一起切（原件 / 文本 / 这条提示）才算"在看那一版"：只切预览不切正文时，
            // 用户会在「文本」页签里读到当前版本的字，以为那一版就是这个内容。
            <Alert
              data-testid="external-viewing-revision"
              type="info"
              showIcon
              className="rf-ext-version-notice"
              title={
                viewing.at.length > 0
                  ? t("externalEdit.versionView.notice", { time: formatDateTime(viewing.at) })
                  : t("externalEdit.versionView.noticeNoTime")
              }
              action={
                <Button
                  size="small"
                  data-testid="external-view-current"
                  onClick={() => setViewState(null)}
                >
                  {t("externalEdit.versionView.back")}
                </Button>
              }
            />
          )}
          {/* P0 四项（T28）：收藏 / 备注 / 重命名 / 导出原件。挂在页签上方，切页签不丢；
            `revisionId` 传当前在看的那一版，所以"看哪一版就导出哪一版"。 */}
          <ExternalResumeDetailActions
            record={record}
            onRecordChange={(next) => applyRecord(next, true)}
            revisionId={viewing?.revisionId}
          />
          <Tabs
            activeKey={tab}
            // 占满弹层 body 的剩余高度；`minHeight: 0` 是 flex 子项能收缩、内部才能滚动的关键。
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
            styles={{
              body: { height: "100%", minHeight: 0 },
              content: { height: "100%", overflow: "auto" },
            }}
            onChange={(key) => goto(key as ExternalResumeDetailTab)}
            items={[
              {
                key: "original",
                label: t("resumesPage.external.tabOriginal"),
                // 原件页自己铺满（工具栏 + 灰画布），不加内边距。
                // 在看历史版本时画那一版的文件（后端 `GET /file?revision_id=` 早就支持）。
                children: (
                  <ExternalOriginalPreview record={record} revisionId={viewing?.revisionId} />
                ),
              },
              {
                key: "text",
                label: t("resumesPage.external.tabText"),
                children: <div style={{ padding: "12px 16px" }}>{textView()}</div>,
              },
              {
                key: "check",
                label: t("resumesPage.external.tabCheck"),
                children: <div style={{ padding: "12px 16px" }}>{checkView()}</div>,
              },
              {
                key: "edit",
                label: t("externalEdit.tab.edit"),
                // 页签内容按需挂载：`blocks` 要读整份文件并解析，切到这一页才值得付这个成本。
                children: (
                  <ExternalResumeEditTab
                    resumeId={record.id}
                    record={record}
                    onRecordChange={applyRecord}
                    onGotoTab={goto}
                  />
                ),
              },
              {
                key: "revisions",
                label: t("externalEdit.tab.revisions"),
                children: (
                  <div style={{ padding: "12px 16px" }}>
                    <ExternalResumeRevisions
                      resumeId={record.id}
                      record={record}
                      refreshKey={refreshKey ?? record.file_id}
                      onRestored={applyRecord}
                      onViewVersion={showRevision}
                    />
                  </div>
                ),
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}

/**
 * 「文本」页签在**看历史版本**时的内容（T12）。
 *
 * 历史版本表只存 `text_chars`，所以正文按需从那一版的文件提取一次。三种状态都要
 * 说清楚：还没取到 / 取失败 / 这一版本来就没有文字层（扫描件）——最后一种不能写
 * "加载中"，那会让人一直等一个不会来的结果。
 */
function RevisionTextView({ resumeId, revisionId }: { resumeId: number; revisionId: number }) {
  const [state, setState] = useState<{
    id: number;
    text: string;
    error: string;
    loading: boolean;
  }>({ id: revisionId, text: "", error: "", loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ id: revisionId, text: "", error: "", loading: true });
    void getExternalResumeRevisionText(resumeId, revisionId)
      .then((next) => {
        if (cancelled) return;
        setState({ id: revisionId, text: next.text, error: "", loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          id: revisionId,
          text: "",
          error: error instanceof Error ? error.message : t("externalEdit.versionView.textFailed"),
          loading: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, revisionId]);

  if (state.error) {
    return <ErrorState description={state.error} />;
  }
  if (state.loading) {
    return <LoadingBlock tip={t("externalEdit.versionView.textLoading")} />;
  }
  if (state.text.trim().length === 0) {
    return <Alert type="warning" showIcon title={t("externalEdit.versionView.noText")} />;
  }
  return (
    <pre
      data-testid="external-revision-text"
      style={{
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        fontFamily: "inherit",
        fontSize: 13,
        lineHeight: 1.7,
      }}
    >
      {state.text}
    </pre>
  );
}

export default ExternalResumeDetailDrawer;
