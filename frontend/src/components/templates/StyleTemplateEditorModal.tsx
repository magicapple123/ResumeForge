/**
 * 样式模板编辑器：改 HTML/CSS，右侧实时看渲染效果。
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

const STARTER_HINT =
  "模板是一份完整的 HTML 页面，可用的变量：{{ resume.* }}（简历内容）、{{ page_limit }}（页数）、" +
  '{{ base_px }}（基准字号像素）、{{ csp_nonce }}。正文结构可以直接 include：{% include "_resume_sections.j2" %}';

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
      .catch((error) => message.error(error instanceof Error ? error.message : "读取模板失败"))
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
          setPreviewError(error instanceof Error ? error.message : "预览渲染失败");
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
      message.warning("请填写模板名称");
      return;
    }
    if (html.trim().length < 40) {
      message.warning("模板内容太短，请提供完整的 HTML");
      return;
    }
    setSaving(true);
    try {
      if (templateId) {
        await updateResumeTemplate(templateId, { name, description, html, config });
        message.success("模板已更新");
      } else {
        await createResumeTemplate({ name, description, html, config, kind: "style" });
        message.success("模板已创建，可以在生成简历时选用");
      }
      onSaved();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={templateId ? "编辑样式模板" : "自制样式模板"}
      open={open}
      onCancel={onClose}
      onOk={() => void save()}
      okText="保存模板"
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
            <Form.Item label="模板名称" required>
              <Input
                value={name}
                maxLength={40}
                placeholder="如：我的深蓝模板"
                onChange={(event) => setName(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="说明（选填）">
              <Input
                value={description}
                maxLength={255}
                placeholder="一句话说明它适合什么场景"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              title={STARTER_HINT}
              description="HTML 预览与 HTML 导出使用完整自制样式；PDF / Word 使用后端版式引擎，能沿用强调色、字号、行高和页边距等通用参数，但不会完整复现自定义双栏、装饰图或任意 CSS。"
              style={{ marginBottom: 12 }}
            />
            {fields.length > 0 ? (
              <Form.Item label="视觉与版式微调">
                <TemplateStyleControls fields={fields} values={config} onChange={setConfig} />
              </Form.Item>
            ) : null}
            <Form.Item label="模板 HTML">
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
                刷新预览
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                预览用的是内置示例简历；导入时脚本与外链会被自动去掉。
              </Typography.Text>
            </Space>
          </Form>
          <div className="style-template-preview">
            {previewError ? (
              <Alert type="error" showIcon title="模板渲染失败" description={previewError} />
            ) : previewing ? (
              <div className="style-template-preview-loading">
                <Spin />
              </div>
            ) : preview ? (
              <A4PreviewFrame html={preview} title="模板预览" maxHeight="66vh" />
            ) : (
              <Typography.Text type="secondary">还没有预览，点「刷新预览」试试。</Typography.Text>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
