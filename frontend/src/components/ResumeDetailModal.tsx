/** 简历记录预览弹窗（历史记录用）：加载详情、调整版式、渲染 HTML 后展示。
 *
 * 预览主体已抽到 ``components/resume/ResumeDetailPreview``（B3）：本弹窗只负责
 * 加载 detail/html、错误与骨架屏，以及把「换版式 / 自动一页 / 保存编辑」这些会改
 * 数据与重渲染的动作准备好，交给共享组件渲染。
 */
import type { ResumeFormatConfig } from "../types/resumeFormat";
import { Alert, App, Button, Modal, Skeleton, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  fetchResumeHtml,
  fetchResumeTemplates,
  getResume,
  renderResume,
  updateResume,
  updateResumeLayout,
} from "../api/resumes";
import type { ResumeContent, ResumeDetail, ResumeLayout } from "../types";
import type { LayoutMeasure } from "../utils/resumeLayoutMeasure";
import ResumeDetailPreview from "./resume/ResumeDetailPreview";
import type { ResumePreviewHandle } from "./ResumePreview";

interface Props {
  recordId: number | null;
  onClose: () => void;
}

const DEFAULT_LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
};

export default function ResumeDetailModal({ recordId, onClose }: Props) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<ResumeDetail | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<ResumeLayout>(DEFAULT_LAYOUT);
  const [savedLayout, setSavedLayout] = useState<ResumeLayout>(DEFAULT_LAYOUT);
  const [layoutStatus, setLayoutStatus] = useState<{
    pages: number;
    scale: number;
    overflow: boolean;
  } | null>(null);
  const [pdfDirectAvailable, setPdfDirectAvailable] = useState(true);
  const [relayouting, setRelayouting] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  // 预览量到的实测高度：只有浏览器能量准，所以由预览上报、这里转交给诊断面板。
  const [measure, setMeasure] = useState<LayoutMeasure | null>(null);
  const previewRef = useRef<ResumePreviewHandle>(null);
  const [suggestionsGenerated, setSuggestionsGenerated] = useState(false);
  const [suggestionsResetKey, setSuggestionsResetKey] = useState(0);
  const loadedRecordId = useRef<number | null>(null);
  const requestVersion = useRef(0);
  const saveRequestVersion = useRef(0);
  const layoutDirty = JSON.stringify(layout) !== JSON.stringify(savedLayout);

  useEffect(() => {
    const currentRequest = ++requestVersion.current;
    if (!recordId) return;
    setDetail(null);
    setHtml("");
    setError("");
    setLayoutStatus(null);
    if (loadedRecordId.current !== recordId) {
      loadedRecordId.current = recordId;
      setSuggestionsGenerated(false);
      setSuggestionsResetKey((value) => value + 1);
    }
    void Promise.all([getResume(recordId), fetchResumeHtml(recordId)])
      .then(([data, rendered]) => {
        if (currentRequest !== requestVersion.current) return;
        setDetail(data);
        setHtml(rendered);
        // 版式跟着记录走：上次用的是哪套，这次打开还是哪套。
        const nextLayout = {
          template: data.template || DEFAULT_LAYOUT.template,
          format_name: data.format_name ?? DEFAULT_LAYOUT.format_name,
          // 必须带上按简历的覆盖：后面每次重渲染都从这份 layout 出发，
          // 漏了它就会出现"导出用新方案、预览用旧方案"这种最难看的不一致。
          format_config: data.format_config ?? {},
          page_limit: data.page_limit || DEFAULT_LAYOUT.page_limit,
          font_scale: data.font_scale || DEFAULT_LAYOUT.font_scale,
        } satisfies ResumeLayout;
        setLayout(nextLayout);
        setSavedLayout(nextLayout);
      })
      .catch((err) => {
        if (currentRequest === requestVersion.current) {
          setError(err instanceof Error ? err.message : "加载失败");
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

  const saveEditedResume = async (content: ResumeContent) => {
    if (!detail) return;
    const requestAtStart = requestVersion.current;
    const saveAtStart = ++saveRequestVersion.current;
    const updated = await updateResume(detail.id, content);
    if (requestAtStart !== requestVersion.current || saveAtStart !== saveRequestVersion.current) {
      return;
    }
    const rendered = await renderResume(updated.content, layout);
    if (requestAtStart !== requestVersion.current || saveAtStart !== saveRequestVersion.current) {
      return;
    }
    setDetail(updated);
    setHtml(rendered);
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
    message.success("简历修改已保存");
  };

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

  /** 换模板 / 加页数 / 改字号：先改本地草稿并重新渲染，不立即写回记录。 */
  const applyLayout = async (next: ResumeLayout) => {
    if (!detail || relayouting) return;
    setRelayouting(true);
    setLayout(next);
    try {
      setHtml(await renderResume(detail.content, next));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "按新版式渲染失败");
    } finally {
      setRelayouting(false);
    }
  };

  /** 「自动一页」也只写入当前草稿，用户确认后再保存。 */
  const applyFittedFormat = async (formatConfig: ResumeFormatConfig) => {
    if (!detail) return;
    const next: ResumeLayout = { ...layout, format_config: formatConfig };
    setLayout(next);
    setRelayouting(true);
    try {
      setHtml(await renderResume(detail.content, next));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "按新版式渲染失败");
    } finally {
      setRelayouting(false);
    }
  };

  const saveLayout = async () => {
    if (!detail || !layoutDirty || layoutSaving) return;
    setLayoutSaving(true);
    try {
      const updated = await updateResumeLayout(detail.id, layout);
      const nextLayout: ResumeLayout = {
        template: updated.template || layout.template,
        format_name: updated.format_name ?? layout.format_name,
        format_config: updated.format_config ?? layout.format_config ?? {},
        page_limit: updated.page_limit || layout.page_limit,
        font_scale: updated.font_scale || layout.font_scale,
      };
      setDetail(updated);
      setLayout(nextLayout);
      setSavedLayout(nextLayout);
      setHtml(await renderResume(updated.content, nextLayout));
      message.success("简历版式修改已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存版式修改失败");
    } finally {
      setLayoutSaving(false);
    }
  };

  const cancelLayout = async () => {
    if (!detail || !layoutDirty || relayouting || layoutSaving) return;
    setRelayouting(true);
    setLayout(savedLayout);
    try {
      setHtml(await renderResume(detail.content, savedLayout));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "恢复已保存版式失败");
    } finally {
      setRelayouting(false);
    }
  };

  return (
    <Modal
      title={detail?.title ?? "简历预览"}
      open={!!recordId}
      onCancel={onClose}
      width="min(960px, 96vw)"
      footer={null}
      // 弹窗自身滚动：预览区高度已经与上方内容解耦（见 ResumePreview 的固定预算），
      // 内容再长也只是让这里滚动，不去压缩预览。
      styles={{
        body: { maxHeight: "calc(100vh - 200px)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {error ? (
        <Alert type="error" showIcon message={error} />
      ) : !detail || !html ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <ResumeDetailPreview
          detail={detail}
          html={html}
          layout={layout}
          layoutStatus={layoutStatus}
          measure={measure}
          pdfDirectAvailable={pdfDirectAvailable}
          relayouting={relayouting}
          previewRef={previewRef}
          onLayoutStatus={setLayoutStatus}
          onMeasure={setMeasure}
          onApplyLayout={(next) => void applyLayout(next)}
          onApplyFittedFormat={(formatConfig) => void applyFittedFormat(formatConfig)}
          extraActions={
            layoutDirty ? (
              <Space size={8}>
                <Button onClick={() => void cancelLayout()} disabled={relayouting || layoutSaving}>
                  取消修改
                </Button>
                <Button
                  type="primary"
                  loading={layoutSaving}
                  disabled={relayouting}
                  onClick={() => void saveLayout()}
                >
                  保存修改
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
      )}
    </Modal>
  );
}
