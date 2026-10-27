// SPDX-License-Identifier: Apache-2.0
// 已下线：自制模板（2026-11）。保留文件仅为历史测试与可回滚，不再被引用。
/**
 * 「导入参考模板」：先识别出可编辑视觉草稿，再让用户预览、微调并保存为模板。
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
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

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
/** 一次最多几份：与上传器 `maxCount` 同源，提示文案里的数字也从这里取。 */
const MAX_FILES = 8;

export default function TemplateImportModal({
  open,
  onClose,
  onImported,
  styleFields = [],
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹窗文案不重渲染。
  useLocale();
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
        setPreviewError(
          error instanceof Error ? error.message : t("templateImport.error.previewFailed"),
        );
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
      message.warning(t("templateImport.toast.needFile"));
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
        message.success(t("templateImport.toast.analyzed"));
      } else {
        const created = await createResumeTemplate({
          name: name.trim() || draft.name,
          description: draft.description,
          html: draft.html,
          config,
          kind: "style",
          // i18n-ok: 顿号是写进模板 source_name 字段的分隔符，随模板落库并长期回显，不随界面语言变
          source_name: draft.source_names.join("、"),
        });
        message.success(t("templateImport.toast.saved", { name: created.name }));
        onImported(created);
        reset();
        onClose();
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("templateImport.error.importFailed"),
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      title={draft ? t("templateImport.title.edit") : t("templateImport.title.import")}
      open={open}
      onCancel={() => {
        if (running) return;
        reset();
        onClose();
      }}
      okText={draft ? t("templateImport.action.saveAsMine") : t("templateImport.action.analyze")}
      cancelText={t("common.action.cancel")}
      mask={{ closable: false }}
      confirmLoading={running}
      okButtonProps={{ disabled: fileList.length === 0 }}
      onOk={() => void submit()}
      width={draft ? "min(1120px, 96vw)" : 680}
      // 微调阶段的 A4 预览接近满高：限高让超长内容只滚弹窗内部。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("templateImport.intro")}
      </Typography.Paragraph>
      {!draft ? (
        <Upload.Dragger
          accept={ACCEPT}
          maxCount={MAX_FILES}
          multiple
          fileList={fileList}
          beforeUpload={(file) => {
            if (file.size > MAX_BYTES) {
              message.error(
                t("templateImport.error.fileTooLarge", { size: MAX_BYTES / (1024 * 1024) }),
              );
              return Upload.LIST_IGNORE;
            }
            const existingBytes = [...selectedFileSizes.current.entries()]
              .filter(([uid]) => uid !== file.uid)
              .reduce((total, [, size]) => total + size, 0);
            if (existingBytes + file.size > MAX_TOTAL_BYTES) {
              message.error(
                t("templateImport.error.totalTooLarge", { size: MAX_TOTAL_BYTES / (1024 * 1024) }),
              );
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
          <p className="ant-upload-text">{t("templateImport.upload.text")}</p>
          <p className="ant-upload-hint">
            {t("templateImport.upload.hint", {
              count: MAX_FILES,
              single: MAX_BYTES / (1024 * 1024),
              total: MAX_TOTAL_BYTES / (1024 * 1024),
            })}
          </p>
        </Upload.Dragger>
      ) : (
        <Alert
          type="success"
          showIcon
          title={t("templateImport.draft.recognized")}
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
        <Form.Item label={t("templateImport.field.name")}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder={t("templateImport.placeholder.name")}
            aria-label={t("templateImport.aria.name")}
          />
        </Form.Item>
      </Form>

      {draft ? (
        <div className="template-recognition-editor">
          <div>
            <Alert
              type="info"
              showIcon
              title={t("templateImport.draft.evidenceTitle")}
              description={
                (draft.evidence.length
                  ? draft.evidence.join(t("templateImport.separator.item"))
                  : t("templateImport.draft.noEvidence")) +
                (draft.warnings.length
                  ? t("templateImport.separator.period") +
                    draft.warnings.join(t("templateImport.separator.item"))
                  : "")
              }
              style={{ marginBottom: 12 }}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t("templateImport.draft.exportNote")}
            </Typography.Paragraph>
            <div
              className="template-recognition-confidence"
              aria-label={t("templateImport.aria.confidence")}
            >
              <Typography.Text type="secondary">
                {t("templateImport.draft.confidenceTitle")}
              </Typography.Text>
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
                <Typography.Text type="secondary">
                  {t("templateImport.draft.noConfidence")}
                </Typography.Text>
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
              <Alert
                type="error"
                showIcon
                title={t("templateImport.draft.previewFailedTitle")}
                description={previewError}
              />
            ) : preview ? (
              <A4PreviewFrame html={preview} title={t("templateImport.draft.previewTitle")} />
            ) : (
              <Typography.Text type="secondary">
                {t("templateImport.draft.previewing")}
              </Typography.Text>
            )}
          </div>
        </div>
      ) : (
        <Alert
          type="info"
          showIcon
          title={t("templateImport.model.title")}
          description={t("templateImport.model.body")}
        />
      )}
    </Modal>
  );
}
