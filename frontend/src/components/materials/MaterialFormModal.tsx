// SPDX-License-Identifier: Apache-2.0
/** 资料箱条目编辑：标题、分类、正文、链接、附件与备注。 */

import { DeleteOutlined, PaperClipOutlined } from "@ant-design/icons";
import { Alert, App, Button, Form, Image, Input, Select, Space, Typography, Upload } from "antd";
import { useEffect, useId, useRef, useState } from "react";
import { handleEditorSaveKey } from "../../utils/formKeyboard";
import type { Material, MaterialFile, MaterialPayload } from "../../types";
import { MATERIAL_CATEGORIES } from "../../types";
import FileDropZone from "../common/FileDropZone";
import FormModal from "../common/FormModal";
import {
  IMAGE_MIME_BY_EXTENSION,
  MATERIAL_ATTACHMENT_ACCEPT,
  MATERIAL_ATTACHMENT_SUFFIXES,
  MAX_ATTACHMENT_BYTES,
  canPreviewImage,
} from "../../utils/attachments";
import { uploadMaterialAttachment } from "../../api/material";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { materialCategoryLabel } from "../../i18n/enum/knowledge";

/** 与后端 MAX_MATERIAL_* 保持一致（服务端仍是权威校验）。 */
const MAX_FILES = 10;
const MAX_IMAGE_FILES = 4;

interface Props {
  open: boolean;
  /** 传入资料表示编辑，传 null 表示新建。 */
  material: Material | null;
  categories: string[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: MaterialPayload) => void;
}

function filesFromMaterial(material: Material | null): MaterialFile[] {
  if (!material) return [];
  return material.files.map((item) => ({ ...item }));
}

function suffixOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function imageCount(files: MaterialFile[]): number {
  return files.filter((item) => item.data_url).length;
}

export default function MaterialFormModal({
  open,
  material,
  categories,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const fieldId = useId();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("其他"); // i18n-ok: 分类兜底值是提交后端的协议值
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<MaterialFile[]>([]);
  // 附件列表的同步镜像：多文件一次选中时上传是**串行 await** 的，上限检查必须读到
  // 前一个文件落下的结果。只读 state 闭包会让"一次选 5 张图"全部通过（清单 §24.7）。
  const filesRef = useRef<MaterialFile[]>([]);
  // 提取不到文字的常驻提示（扫描件 PDF 等）：仍允许加入，用户至少能另存为。
  const [fileWarnings, setFileWarnings] = useState<string[]>([]);
  // 串行上传队列：一次多选多个文件时按选择顺序逐个上传与检查。
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());

  const replaceFiles = (next: MaterialFile[]) => {
    // 只在事件/异步回调里写 ref（渲染期写 ref 会被 react-hooks/refs 判违规）。
    filesRef.current = next;
    setFiles(next);
  };

  // 列表状态变化后把镜像 ref 同步过来：打开弹窗的回填是在渲染期 setState 完成的，
  // 这里在提交阶段之后补一次同步，保证第一次交互时 ref 已经是最新列表。
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // 打开时用条目内容（或空值）回填表单。Compiler 规范：随 prop 变化的重置用
  // 渲染期守卫式调整（key = open + material 引用，与原 deps 同源）。
  const [prevSync, setPrevSync] = useState<{ open: boolean; material: Material | null } | null>(
    null,
  );
  if (prevSync === null || prevSync.open !== open || prevSync.material !== material) {
    setPrevSync({ open, material });
    if (open) {
      setTitle(material?.title ?? "");
      setCategory(material?.category || "其他"); // i18n-ok: 分类兜底值是提交后端的协议值
      setContent(material?.content ?? "");
      setUrl(material?.url ?? "");
      setNote(material?.note ?? "");
      setFileWarnings([]);
      setFiles(filesFromMaterial(material));
    }
  }

  const options = Array.from(new Set([...categories, ...MATERIAL_CATEGORIES]));

  /** 单个附件：本地先判类型与上限，再交给后端存原件 + 提取内容。 */
  const addAttachment = async (file: File) => {
    const suffix = suffixOf(file.name);
    // .doc 在选文件这一秒就说清怎么转（与面试材料同一文案口径），不等上传完再报错。
    if (suffix === "doc") {
      message.error(t("materialForm.error.legacyDoc"));
      return;
    }
    if (!MATERIAL_ATTACHMENT_SUFFIXES.has(suffix)) {
      message.error(t("materialForm.error.unsupported"));
      return;
    }
    if (filesRef.current.length >= MAX_FILES) {
      message.warning(t("materialForm.error.maxFiles", { count: MAX_FILES }));
      return;
    }
    const isImage = Boolean(IMAGE_MIME_BY_EXTENSION[suffix]);
    if (isImage) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        message.error(t("materialForm.error.imageTooLarge"));
        return;
      }
      if (imageCount(filesRef.current) >= MAX_IMAGE_FILES) {
        message.warning(t("materialForm.error.maxImages", { count: MAX_IMAGE_FILES }));
        return;
      }
    }
    try {
      const uploaded = await uploadMaterialAttachment(file);
      // await 之后再查一次：串行队列保证前面文件已落库，但上限仍以最新列表为准。
      if (filesRef.current.length >= MAX_FILES) {
        message.warning(t("materialForm.error.maxFiles", { count: MAX_FILES }));
        return;
      }
      if (isImage && imageCount(filesRef.current) >= MAX_IMAGE_FILES) {
        message.warning(t("materialForm.error.maxImages", { count: MAX_IMAGE_FILES }));
        return;
      }
      replaceFiles([
        ...filesRef.current,
        {
          name: uploaded.name,
          mime_type: uploaded.mime_type,
          size_bytes: uploaded.size_bytes,
          text: uploaded.text,
          data_url: uploaded.data_url,
          file_id: uploaded.file_id,
        },
      ]);
      if (uploaded.warnings.length > 0) {
        setFileWarnings((current) => [
          ...current,
          ...uploaded.warnings.map((warning) =>
            t("materialForm.warning.attachment", { name: uploaded.name, warning }),
          ),
        ]);
      }
    } catch (error) {
      // 后端 422 的 detail 是面向用户的原因（超限 / 格式 / 解析失败），原样展示。
      message.error(error instanceof Error ? error.message : t("materialForm.error.uploadFailed"));
    }
  };

  /** 串行入队：多个文件一次选中时逐个上传，上限检查读到的始终是最新列表。 */
  const enqueueAttachment = (file: File) => {
    uploadQueue.current = uploadQueue.current
      .then(() => addAttachment(file))
      .catch(() => undefined);
  };

  const submit = () => {
    if (submitting) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle && !content.trim() && !url.trim() && files.length === 0) {
      message.warning(t("materialForm.warning.needContent"));
      return;
    }
    onSubmit({
      title: trimmedTitle,
      category: category.trim() || "其他", // i18n-ok: 分类兜底值是提交后端的协议值
      content,
      url: url.trim(),
      note,
      files,
    });
  };

  return (
    <FormModal
      title={material ? t("materialForm.title.edit") : t("materialForm.title.create")}
      open={open}
      width={720}
      onCancel={onCancel}
      submitting={submitting}
      onSubmit={submit}
      okText={t("materialForm.action.save")}
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={t("materialForm.intro")} />
      <Typography.Paragraph type="secondary">
        {t("materialForm.hint.shortcut")}
      </Typography.Paragraph>
      <Form
        layout="vertical"
        disabled={submitting}
        onKeyDown={(event) => handleEditorSaveKey(event, submit)}
      >
        <Form.Item label={t("materialForm.label.title")} htmlFor={fieldId + "-title"}>
          <Input
            id={fieldId + "-title"}
            showCount
            value={title}
            maxLength={256}
            placeholder={t("materialForm.placeholder.title")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Form.Item>
        <Form.Item label={t("materialForm.label.category")} htmlFor={fieldId + "-category"}>
          <Select
            id={fieldId + "-category"}
            // tags 模式的取值是数组，这里始终只放一项，对外仍当单个字符串用。
            value={category ? [category] : []}
            showSearch
            options={options.map((item) => ({ value: item, label: materialCategoryLabel(item) }))}
            // 允许输入新分类：资料类型很个人化，固定的那几个只能算起点。
            // 不加 maxCount={1}：antd 在已选数达到 maxCount 时会把下拉里所有
            // 未选中项置灰禁用，导致编辑时改选不了其他分类；onChange 只取
            // 最后一位，多选的一瞬间也会收敛回单个分类。
            mode="tags"
            // i18n-ok: 分类兜底值是提交后端的协议值
            onChange={(values: string[]) => setCategory(values[values.length - 1] ?? "其他")}
            placeholder={t("materialForm.placeholder.category")}
          />
        </Form.Item>
        <Form.Item label={t("materialForm.label.content")} htmlFor={fieldId + "-content"}>
          <Input.TextArea
            id={fieldId + "-content"}
            value={content}
            autoSize={{ minRows: 4, maxRows: 12 }}
            placeholder={t("materialForm.placeholder.content")}
            onChange={(event) => setContent(event.target.value)}
          />
        </Form.Item>
        <Form.Item label={t("materialForm.label.url")} htmlFor={fieldId + "-url"}>
          <Input
            id={fieldId + "-url"}
            value={url}
            placeholder={t("materialForm.placeholder.url")}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Form.Item>
        <Form.Item
          label={t("materialForm.label.attachments", {
            count: MAX_FILES,
            images: MAX_IMAGE_FILES,
          })}
        >
          {fileWarnings.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              closable
              onClose={() => setFileWarnings([])}
              title={t("materialForm.warning.attachmentTitle")}
              description={
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {fileWarnings.map((warning, index) => (
                    <li key={warning + index}>{warning}</li>
                  ))}
                </ul>
              }
              style={{ marginBottom: 12 }}
            />
          ) : null}
          {/* 一个入口、一份 accept：按钮与拖拽区共用 MATERIAL_ATTACHMENT_ACCEPT，
              不再按"图片 / 文本文件"拆成两个按钮（清单 §24）。 */}
          <FileDropZone
            accept={MATERIAL_ATTACHMENT_ACCEPT}
            disabled={files.length >= MAX_FILES}
            hint={t("materialForm.hint.drop")}
            onFiles={(dropped) => dropped.forEach(enqueueAttachment)}
            onRejected={(_count, rejected) => {
              // .doc 单独说"另存为 .docx"（与面试材料同一口径），其余不支持的格式也给提示。
              const legacyDoc = rejected.some((file) => suffixOf(file.name) === "doc");
              message.error(
                legacyDoc ? t("materialForm.error.legacyDoc") : t("materialForm.error.unsupported"),
              );
            }}
          >
            <Space wrap>
              <Upload
                accept={MATERIAL_ATTACHMENT_ACCEPT}
                showUploadList={false}
                multiple
                disabled={files.length >= MAX_FILES}
                beforeUpload={(file) => {
                  enqueueAttachment(file as File);
                  return Upload.LIST_IGNORE;
                }}
              >
                <Button
                  icon={<PaperClipOutlined />}
                  // 图标自带 role=img + aria-label，按钮的可访问名会变成「paper-clip 添加附件」；
                  // 显式 aria-label 让读屏与测试都拿到干净的「添加附件」。
                  aria-label={t("materialForm.action.addAttachment")}
                >
                  {t("materialForm.action.addAttachment")}
                </Button>
              </Upload>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("materialForm.hint.dropNote")}
              </Typography.Text>
            </Space>
          </FileDropZone>
          {files.length > 0 && (
            <div className="material-file-list">
              {files.map((item, index) => {
                const hasText = Boolean((item.text ?? "").trim());
                const metaText = item.data_url
                  ? t("materialForm.file.image", {
                      size: Math.round(item.size_bytes / 1024),
                    })
                  : hasText
                    ? t("materialForm.file.text", { count: item.text.length })
                    : t("materialForm.file.originalOnly");
                return (
                  <div key={item.file_id ?? item.name + index} className="material-file-item">
                    {item.data_url && canPreviewImage(item.mime_type) ? (
                      <Image src={item.data_url} alt={item.name} width={64} />
                    ) : (
                      <PaperClipOutlined className="material-file-icon" />
                    )}
                    <div className="material-file-meta">
                      <Typography.Text ellipsis={{ tooltip: item.name }}>
                        {item.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {metaText}
                      </Typography.Text>
                    </div>
                    <Button
                      type="text"
                      size="small"
                      danger
                      aria-label={t("materialForm.aria.removeFile", { name: item.name })}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        replaceFiles(filesRef.current.filter((_, itemIndex) => itemIndex !== index))
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </Form.Item>
        <Form.Item
          label={t("materialForm.label.note")}
          htmlFor={fieldId + "-note"}
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            id={fieldId + "-note"}
            value={note}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder={t("materialForm.placeholder.note")}
            onChange={(event) => setNote(event.target.value)}
          />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
