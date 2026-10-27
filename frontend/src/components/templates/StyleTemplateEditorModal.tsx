// SPDX-License-Identifier: Apache-2.0
// 已下线：自制模板（2026-11）。保留文件仅为历史测试与可回滚，不再被引用。
/**
 * 模板编辑器：改 HTML/CSS，右侧实时看渲染效果。
 *
 * 两个刻意的设计：
 * 1. **从内置模板复制**是新建的默认入口：让用户从一份能用的模板开始改，比面对空白框强，
 *    也顺便保证了 `{% include "_resume_sections.j2" %}` 这类必要结构不会写漏。
 * 2. 预览走服务端渲染（`/api/resume-templates/preview`），所以看到的就是导出的效果；
 *    模板语法写错时错误信息直接显示在预览区，不会等到保存后才发现。
 */
import { Alert, App, Button, Form, Input, Modal, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { previewResumeTemplate } from "../../api/resumes";
import {
  createResumeTemplate,
  fetchResumeTemplate,
  updateResumeTemplate,
} from "../../api/resumeTemplates";
import type { ResumeFontScale, ResumeStyleField } from "../../types";
import A4PreviewFrame from "./A4PreviewFrame";
import TemplateStyleControls from "./TemplateStyleControls";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  open: boolean;
  /** 传入 id 表示编辑已有模板；否则新建。 */
  templateId?: number | null;
  /** 新建时的初始 HTML（通常是从某个内置模板复制的副本）。 */
  initialHtml?: string;
  initialName?: string;
  initialConfig?: Record<string, unknown>;
  fields?: ResumeStyleField[];
  fontScale?: ResumeFontScale;
  onClose: () => void;
  onSaved: () => void;
}

export default function StyleTemplateEditorModal({
  open,
  templateId,
  initialHtml = "",
  initialName = "",
  initialConfig = {},
  fields = [],
  fontScale = "standard",
  onClose,
  onSaved,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹窗文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [html, setHtml] = useState(initialHtml);
  const [config, setConfig] = useState<Record<string, unknown>>(initialConfig);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const previewSequence = useRef(0);

  // 打开时回填（新建时给空白），编辑既有模板时再拉详情。
  // Compiler 规范：随 open/templateId 变化的回填用渲染期守卫；取数留在 effect。
  const [prevSync, setPrevSync] = useState<{
    open: boolean;
    templateId: number | null | undefined;
    initialName: string;
    initialHtml: string;
    initialConfig: Record<string, unknown>;
  } | null>(null);
  if (
    prevSync === null ||
    prevSync.open !== open ||
    prevSync.templateId !== templateId ||
    prevSync.initialName !== initialName ||
    prevSync.initialHtml !== initialHtml ||
    prevSync.initialConfig !== initialConfig
  ) {
    setPrevSync({ open, templateId, initialName, initialHtml, initialConfig });
    if (open) {
      setName(initialName);
      setHtml(initialHtml);
      setConfig(initialConfig);
      setDescription("");
      setPreview("");
      setPreviewError("");
      if (templateId) setLoading(true);
    }
  }

  useEffect(() => {
    if (!open || !templateId) return;
    void fetchResumeTemplate(templateId)
      .then((detail) => {
        setName(detail.name);
        setDescription(detail.description);
        setHtml(detail.html);
        setConfig(detail.config);
      })
      .catch((error) =>
        message.error(error instanceof Error ? error.message : t("styleTemplateEditor.error.load")),
      )
      .finally(() => setLoading(false));
  }, [open, templateId, message]);

  const runPreview = useCallback(
    async (source: string) => {
      if (!source.trim()) return;
      const sequence = ++previewSequence.current;
      setPreviewing(true);
      setPreviewError("");
      try {
        const rendered = await previewResumeTemplate({
          html: source,
          style_config: config,
          font_scale: fontScale,
        });
        if (sequence === previewSequence.current) setPreview(rendered);
      } catch (error) {
        if (sequence === previewSequence.current) {
          setPreview("");
          setPreviewError(
            error instanceof Error ? error.message : t("styleTemplateEditor.error.preview"),
          );
        }
      } finally {
        if (sequence === previewSequence.current) setPreviewing(false);
      }
    },
    [config, fontScale],
  );

  // 首次打开及微调后自动预览；短暂停顿合并连续输入，避免每次按键都发请求。
  useEffect(() => {
    if (!open || !html.trim()) return;
    const timer = setTimeout(() => void runPreview(html), 180);
    return () => {
      clearTimeout(timer);
      previewSequence.current += 1;
    };
  }, [open, html, config, runPreview]);

  const save = async () => {
    if (!name.trim()) {
      message.warning(t("styleTemplateEditor.toast.needName"));
      return;
    }
    if (html.trim().length < 40) {
      message.warning(t("styleTemplateEditor.toast.htmlTooShort"));
      return;
    }
    setSaving(true);
    try {
      if (templateId) {
        await updateResumeTemplate(templateId, { name, description, html, config });
        message.success(t("styleTemplateEditor.toast.updated"));
      } else {
        await createResumeTemplate({ name, description, html, config, kind: "style" });
        message.success(t("styleTemplateEditor.toast.created"));
      }
      onSaved();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("styleTemplateEditor.error.save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        templateId ? t("styleTemplateEditor.title.edit") : t("styleTemplateEditor.title.create")
      }
      open={open}
      onCancel={onClose}
      onOk={() => void save()}
      okText={t("styleTemplateEditor.action.save")}
      mask={{ closable: false }}
      confirmLoading={saving}
      width="min(1120px, 96vw)"
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {loading ? (
        <Spin />
      ) : (
        <div className="style-template-editor">
          <Form layout="vertical" className="style-template-form">
            <Form.Item label={t("styleTemplateEditor.field.name")} required>
              <Input
                value={name}
                maxLength={40}
                placeholder={t("styleTemplateEditor.placeholder.name")}
                onChange={(event) => setName(event.target.value)}
              />
            </Form.Item>
            <Form.Item label={t("styleTemplateEditor.field.description")}>
              <Input
                value={description}
                maxLength={255}
                placeholder={t("styleTemplateEditor.placeholder.description")}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              title={t("styleTemplateEditor.hint.starter")}
              description={t("styleTemplateEditor.hint.export")}
              style={{ marginBottom: 12 }}
            />
            {fields.length > 0 ? (
              <Form.Item label={t("styleTemplateEditor.field.styleControls")}>
                <TemplateStyleControls fields={fields} values={config} onChange={setConfig} />
              </Form.Item>
            ) : null}
            <Form.Item label={t("styleTemplateEditor.field.html")}>
              <Input.TextArea
                value={html}
                onChange={(event) => setHtml(event.target.value)}
                autoSize={{ minRows: 18, maxRows: 26 }}
                spellCheck={false}
                className="style-template-code"
              />
            </Form.Item>
            <Space wrap>
              <Button loading={previewing} onClick={() => void runPreview(html)}>
                {t("styleTemplateEditor.action.refreshPreview")}
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("styleTemplateEditor.hint.sampleResume")}
              </Typography.Text>
            </Space>
          </Form>
          <div className="style-template-preview">
            {previewError ? (
              <Alert
                type="error"
                showIcon
                title={t("styleTemplateEditor.error.renderTitle")}
                description={previewError}
              />
            ) : previewing ? (
              <div className="style-template-preview-loading">
                <Spin />
              </div>
            ) : preview ? (
              <A4PreviewFrame
                html={preview}
                title={t("styleTemplateEditor.preview.title")}
                maxHeight="66vh"
              />
            ) : (
              <Typography.Text type="secondary">
                {t("styleTemplateEditor.preview.empty")}
              </Typography.Text>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
