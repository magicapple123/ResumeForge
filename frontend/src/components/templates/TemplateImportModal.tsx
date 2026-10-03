/**
 * 「导入参考模板」：先识别出可编辑视觉草稿，再让用户预览、微调并保存为样式模板。
 *
 * 为什么需要它：用户手里常有"我就想要这种样子"的简历，但让他照着参考件重做版式不现实。
 * 这里先返回安全的视觉配置草稿，再让用户检查实际 A4 预览和手动微调。
 *
 * 两个如实说明：
 * 1. **图片会发给模型**（它没有可本地抽取的结构化文字），文档则在本地抽文字后再分析；
 * 2. 文档不会直接上传给模型；识别结果在用户确认前不落库，也不会生成模型编写的 HTML。
 */
import { InboxOutlined } from "@ant-design/icons";
import { App, Alert, Form, Input, Modal, Space, Tag, Typography, Upload } from "antd";
import type { UploadFile } from "antd";
import { useRef, useState } from "react";
import { analyzeTemplateFromFiles, createResumeTemplate } from "../../api/resumeTemplates";
import { previewResumeTemplate } from "../../api/resumes";
import type { ResumeStyleField, ResumeTemplateDetail, TemplateRecognitionDraft } from "../../types";
import A4PreviewFrame from "./A4PreviewFrame";
import TemplateStyleControls from "./TemplateStyleControls";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入成功：父组件刷新列表。 */
  onImported: (template: ResumeTemplateDetail) => void;
  styleFields?: ResumeStyleField[];
}

/** 与后端一致：图片与文档各取所需，其余类型在服务端会被拒。 */
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.pdf,.docx";
/** 后端上限 2MB（`MAX_ATTACHMENT_BYTES`），这里提前拦一次，省得用户等一次失败。 */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export default function TemplateImportModal({
  open,
  onClose,
  onImported,
  styleFields = [],
}: Props) {
  const { message } = App.useApp();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<TemplateRecognitionDraft | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const previewSequence = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedFileSizes = useRef(new Map<string, number>());

  const reset = () => {
    setFileList([]);
    selectedFileSizes.current.clear();
    setName("");
    setRunning(false);
    setDraft(null);
    setConfig({});
    setPreview("");
    setPreviewError("");
    previewSequence.current += 1;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
  };

  const renderDraft = async (
    nextDraft: TemplateRecognitionDraft,
    nextConfig: Record<string, unknown>,
  ) => {
    const sequence = ++previewSequence.current;
    setPreviewError("");
    try {
      const html = await previewResumeTemplate({ html: nextDraft.html, style_config: nextConfig });
      if (sequence === previewSequence.current) setPreview(html);
    } catch (error) {
      if (sequence === previewSequence.current) {
        setPreviewError(error instanceof Error ? error.message : "预览渲染失败");
      }
    }
  };

  const scheduleDraftPreview = (
    nextDraft: TemplateRecognitionDraft,
    nextConfig: Record<string, unknown>,
  ) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      void renderDraft(nextDraft, nextConfig);
    }, 180);
  };

  const submit = async () => {
    const files = fileList
      .map((item) => item.originFileObj)
      .filter((file): file is NonNullable<UploadFile["originFileObj"]> => Boolean(file));
    if (files.length === 0) {
      message.warning("先选一份参考模板文件");
      return;
    }
    setRunning(true);
    try {
      if (!draft) {
        const analyzed = await analyzeTemplateFromFiles(files, name);
        setDraft(analyzed);
        setName(analyzed.name);
        setConfig(analyzed.config);
        await renderDraft(analyzed, analyzed.config);
        message.success("识别完成，请检查右侧预览并微调后再保存");
      } else {
        const created = await createResumeTemplate({
          name: name.trim() || draft.name,
          description: draft.description,
          html: draft.html,
          config,
          kind: "style",
          source_name: draft.source_names.join("、"),
        });
        message.success("已保存样式模板「" + created.name + "」");
        onImported(created);
        reset();
        onClose();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入失败，请稍后重试");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      title={draft ? "微调导入模板" : "导入参考模板"}
      open={open}
      onCancel={() => {
        if (running) return;
        reset();
        onClose();
      }}
      okText={draft ? "保存为我的模板" : "识别并预览"}
      cancelText="取消"
      confirmLoading={running}
      okButtonProps={{ disabled: fileList.length === 0 }}
      onOk={() => void submit()}
      width={draft ? "min(1120px, 96vw)" : 680}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        上传你想照着做的简历截图或文档。识别结果会先进入编辑器，确认后才会保存；
        不会直接覆盖已有模板。
      </Typography.Paragraph>
      {!draft ? (
        <Upload.Dragger
          accept={ACCEPT}
          maxCount={8}
          multiple
          fileList={fileList}
          beforeUpload={(file) => {
            if (file.size > MAX_BYTES) {
              message.error("文件不能超过 " + MAX_BYTES / (1024 * 1024) + " MB，请压缩后再试");
              return Upload.LIST_IGNORE;
            }
            const existingBytes = [...selectedFileSizes.current.entries()]
              .filter(([uid]) => uid !== file.uid)
              .reduce((total, [, size]) => total + size, 0);
            if (existingBytes + file.size > MAX_TOTAL_BYTES) {
              message.error("参考模板文件合计不能超过 5 MB");
              return Upload.LIST_IGNORE;
            }
            selectedFileSizes.current.set(file.uid, file.size);
            setFileList((current) => [
              ...current.filter((item) => item.uid !== file.uid),
              {
                uid: file.uid,
                name: file.name,
                size: file.size,
                status: "done",
                originFileObj: file as UploadFile["originFileObj"],
              },
            ]);
            return false;
          }}
          onRemove={(file) => {
            selectedFileSizes.current.delete(file.uid);
            setFileList((current) => current.filter((item) => item.uid !== file.uid));
          }}
          style={{ marginBottom: 16 }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点这里选择，或把文件拖进来</p>
          <p className="ant-upload-hint">
            最多 8 份 PNG / JPG / WEBP 图片或 PDF / DOCX，单个 ≤ 2 MB、合计 ≤ 5 MB
          </p>
        </Upload.Dragger>
      ) : (
        <Alert
          type="success"
          showIcon
          title="已完成初步识别"
          description={
            <Space wrap>
              {draft.source_names.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </Space>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      <Form layout="vertical">
        <Form.Item label="模板名称（可留空，由模型起名）">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder="例如：深蓝简洁版式"
            aria-label="模板名称"
          />
        </Form.Item>
      </Form>

      {draft ? (
        <div className="template-recognition-editor">
          <div>
            <Alert
              type="info"
              showIcon
              title="识别依据"
              description={
                (draft.evidence.length ? draft.evidence.join("；") : "模型没有返回可解释依据") +
                (draft.warnings.length ? "。" + draft.warnings.join("；") : "")
              }
              style={{ marginBottom: 12 }}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              HTML 预览与 HTML 导出使用完整样式；PDF / Word
              会应用颜色、字号、行高和页边距等通用参数， 但不能完整复现自定义双栏、标签图片或任意
              CSS，建议导出后核对。
            </Typography.Paragraph>
            <div className="template-recognition-confidence" aria-label="识别置信度">
              <Typography.Text type="secondary">识别置信度：</Typography.Text>
              {Object.entries(draft.confidence).length ? (
                <Space wrap size={[4, 4]}>
                  {Object.entries(draft.confidence).map(([key, confidence]) => {
                    const label = styleFields.find((field) => field.key === key)?.label ?? key;
                    return (
                      <Tag key={key} color={confidence < 0.65 ? "orange" : "blue"}>
                        {label} {Math.round(confidence * 100)}%
                      </Tag>
                    );
                  })}
                </Space>
              ) : (
                <Typography.Text type="secondary">模型未提供</Typography.Text>
              )}
            </div>
            <TemplateStyleControls
              fields={styleFields}
              values={config}
              onChange={(next) => {
                setConfig(next);
                scheduleDraftPreview(draft, next);
              }}
            />
          </div>
          <div className="template-recognition-preview">
            {previewError ? (
              <Alert type="error" showIcon title="预览失败" description={previewError} />
            ) : preview ? (
              <A4PreviewFrame html={preview} title="导入模板预览" />
            ) : (
              <Typography.Text type="secondary">正在生成预览…</Typography.Text>
            )}
          </div>
        </div>
      ) : (
        <Alert
          type="info"
          showIcon
          title="识别需要已配置的大模型"
          description="参考图片会发给你配置的大模型；若含真实姓名、电话或邮箱，建议先遮挡。PDF / DOCX 原文留在本机，仅发送本地生成的脱敏结构统计。识别结果会先预览和微调，再保存为样式模板。"
        />
      )}
    </Modal>
  );
}
