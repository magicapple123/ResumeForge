// SPDX-License-Identifier: Apache-2.0
/**
 * 上传外部简历（第 21 条）：拖拽/选择文件 + 显示名称 + 可选关联岗位。
 *
 * 三条取舍写在结构里：
 * - **客户端先挡**格式 / 空文件 / 10 MB：等文件传完一圈再由服务端拒绝是最差反馈；
 * - **上传即解析**：服务端在本机提取正文（不调视觉模型），返回的 `warnings` 原样提示
 *   ——扫描件会带"没有文字层"的警告，界面不把它当成失败；
 * - **可提交的弹层禁蒙层关闭**（有提交动作），提交中 Esc 与 × 都停掉。
 */
import { InboxOutlined } from "@ant-design/icons";
import { App, Form, Input, Modal, Select, Typography, Upload } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useJobSearchSelect } from "../../../hooks/remoteSearchOptions";

/** 与后端 MAX_EXTERNAL_RESUME_BYTES 同一个数；两处不一致时前端会放行一个后端必拒的文件。 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** 与后端 MATERIAL_TEXT_SUFFIXES（第 21 条只收这五种）同一份清单。 */
const ACCEPT = ".pdf,.txt,.md,.markdown,.docx";

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

export interface ExternalResumeUploadPresetJob {
  id: number;
  title: string;
}

export function ExternalResumeUploadModal({
  open,
  uploading,
  onClose,
  onSubmit,
  presetJob,
}: {
  open: boolean;
  uploading: boolean;
  onClose: () => void;
  /** 返回 true 才关闭弹窗（上传失败时留在原地让用户重试）。 */
  onSubmit: (file: File, options: { name: string; jobId: number | null }) => Promise<boolean>;
  /**
   * 预设关联岗位（从岗位广场某一行右键进来的「添加外部简历」）。
   *
   * 有值时：**不渲染岗位选择器**（岗位已经由入口定好，再让人选一遍只会选错）、
   * **不请求候选项**、提交固定用它的 `id`，关闭时把状态重置回它的 `id`。
   * 不传时行为与改造前逐字一致。
   */
  presetJob?: ExternalResumeUploadPresetJob;
}) {
  useLocale();
  const { message } = App.useApp();
  const jobSelect = useJobSearchSelect();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  // 预设岗位的 id 就是初值：这样即使有人手快先点了提交，提交的也是那一行岗位。
  const [jobId, setJobId] = useState<number | null>(presetJob?.id ?? null);
  const [dragError, setDragError] = useState("");

  // 打开时拉一次岗位候选；hook 的回调引用稳定，只跟随 open。
  // 预设岗位时**一次都不请求**：选择器都不渲染，拉了也没人用。
  useEffect(() => {
    if (!open || presetJob) return;
    void jobSelect.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetJob?.id]);

  /**
   * 关闭时清空（而不是打开时重置）：上传失败要留在原地让用户重试，把"清空"绑在
   * 关闭动作上既不会把失败状态洗掉，也不需要在 effect 里同步 setState。
   */
  const close = (): void => {
    setFile(null);
    setName("");
    // 预设岗位：重置回它而不是 null，下次打开仍是同一个岗位。
    setJobId(presetJob?.id ?? null);
    setDragError("");
    onClose();
  };

  const pick = (picked: File): void => {
    if (picked.size === 0) {
      setFile(null);
      setDragError(t("resumesPage.external.uploadRequired"));
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setDragError(t("resumesPage.external.uploadHint"));
      return;
    }
    if (!ACCEPT.split(",").includes(extensionOf(picked.name))) {
      setFile(null);
      setDragError(t("resumesPage.external.uploadUnsupported"));
      return;
    }
    setDragError("");
    setFile(picked);
    if (!name.trim()) setName(picked.name.slice(0, picked.name.lastIndexOf(".")));
  };

  const submit = async (): Promise<void> => {
    if (!file) {
      message.error(t("resumesPage.external.uploadRequired"));
      return;
    }
    const ok = await onSubmit(file, { name: name.trim(), jobId: presetJob ? presetJob.id : jobId });
    if (ok) close();
  };

  return (
    <Modal
      open={open}
      title={t("resumesPage.external.uploadTitle")}
      // 有提交动作：蒙层点击与 Esc 都不关闭，避免"传到一半手滑点掉"。
      mask={{ closable: false }}
      closable={!uploading}
      keyboard={!uploading}
      confirmLoading={uploading}
      okText={t("resumesPage.external.upload")}
      cancelText={t("common.action.cancel")}
      onOk={() => void submit()}
      onCancel={() => {
        if (!uploading) close();
      }}
      destroyOnHidden
    >
      <Form layout="vertical" disabled={uploading}>
        <Form.Item extra={dragError || t("resumesPage.external.uploadHint")}>
          <Upload.Dragger
            accept={ACCEPT}
            multiple={false}
            showUploadList={false}
            disabled={uploading}
            beforeUpload={(picked) => {
              pick(picked as File);
              // 与仓库其它上传一致：本地读完自己提交，不走 antd 的上传通道。
              return Upload.LIST_IGNORE;
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{t("resumesPage.external.uploadDrop")}</p>
          </Upload.Dragger>
          {file ? (
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              {file.name}
            </Typography.Text>
          ) : null}
        </Form.Item>
        <Form.Item label={t("resumesPage.external.uploadName")}>
          <Input
            maxLength={256}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("resumesPage.external.uploadNamePlaceholder")}
          />
        </Form.Item>
        {presetJob ? (
          // 预设岗位：只读展示"这份简历会关联到哪个岗位"，替代选择器。
          <Form.Item label={t("resumesPage.external.uploadJob")}>
            <Typography.Text data-testid="external-resume-preset-job">
              {presetJob.title}
            </Typography.Text>
          </Form.Item>
        ) : (
          <Form.Item label={t("resumesPage.external.uploadJob")}>
            <Select
              allowClear
              value={jobId ?? undefined}
              onChange={(value) => setJobId(value ?? null)}
              placeholder={t("resumesPage.external.uploadJobPlaceholder")}
              {...jobSelect.selectProps}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

export default ExternalResumeUploadModal;
