// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位表单（**抽屉内的一个视图**，不是弹窗）：受控组件——formState 所有权留在抽屉，
 * 经 props 双向联动；拒绝回调经 `onRejected` 由抽屉传入（本文件不新增 `App.useApp()` 调用点）。
 *
 * 本文件**不含按钮行**：取消/保存与 L2 内联确认条都在抽屉底部的 footer 里（同一条位置换态，
 * 层级不变、焦点不跳）。未保存的脏值由抽屉的 `useDiscardGuard` 判定。
 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Image, Input, Space, Typography, Upload } from "antd";
import FileDropZone from "../../common/FileDropZone";
import { MaxLengthHint } from "../../common/MaxLengthHint";
import { t } from "../../../i18n";
import { MAX_JOB_TEXT_CHARS } from "../../../config";
import type { FormState } from "./candidateShared";
import { MAX_CANDIDATE_IMAGES } from "./candidateShared";

interface Props {
  submitting: boolean;
  formState: FormState;
  onChange: (updater: (current: FormState) => FormState) => void;
  onAddImages: (file: File) => void;
  onRejected: () => void;
}

export function CandidateJobFormView({
  submitting,
  formState,
  onChange,
  onAddImages,
  onRejected,
}: Props) {
  const sourceLabel =
    formState.images.length > 0
      ? t("jobs.candidate.form.source-image")
      : t("jobs.candidate.form.source-text");
  const urlInvalid =
    Boolean(formState.sourceUrl.trim()) && !/^https?:\/\//i.test(formState.sourceUrl.trim());

  return (
    <Form layout="vertical">
      <Form.Item label={t("jobs.candidate.form.source-label")}>
        <Typography.Text type="secondary">
          {t("jobs.candidate.form.source-hint", { source: sourceLabel })}
        </Typography.Text>
      </Form.Item>
      <Form.Item label={t("jobs.candidate.form.title-label")}>
        <Input
          value={formState.title}
          maxLength={128}
          placeholder={t("jobs.candidate.form.title-placeholder")}
          onChange={(event) => onChange((c) => ({ ...c, title: event.target.value }))}
        />
      </Form.Item>
      <Form.Item label={t("jobs.candidate.form.company-label")}>
        <Input
          value={formState.company}
          maxLength={128}
          placeholder={t("jobs.candidate.form.company-placeholder")}
          onChange={(event) => onChange((c) => ({ ...c, company: event.target.value }))}
        />
      </Form.Item>
      <Form.Item
        label={t("jobs.candidate.form.url-label")}
        validateStatus={urlInvalid ? "warning" : undefined}
        help={urlInvalid ? t("jobs.candidate.form.url-warning") : undefined}
      >
        <Input
          value={formState.sourceUrl}
          maxLength={512}
          placeholder={t("jobs.candidate.form.url-placeholder")}
          onChange={(event) => onChange((c) => ({ ...c, sourceUrl: event.target.value }))}
        />
      </Form.Item>
      <Form.Item label={t("jobs.candidate.form.raw-label")}>
        {/* 硬上限与后端备选岗位 raw_text 的 max_length 对齐（50_000）；
            提示统一走 MaxLengthHint（全仓禁用 antd showCount）。 */}
        <Input.TextArea
          value={formState.rawText}
          maxLength={MAX_JOB_TEXT_CHARS}
          autoSize={{ minRows: 6, maxRows: 14 }}
          placeholder={t("jobs.candidate.form.raw-placeholder")}
          onChange={(event) => onChange((c) => ({ ...c, rawText: event.target.value }))}
        />
        <MaxLengthHint value={formState.rawText} maxLength={MAX_JOB_TEXT_CHARS} />
      </Form.Item>
      <Form.Item label={t("jobs.candidate.form.images-label", { count: MAX_CANDIDATE_IMAGES })}>
        <Space orientation="vertical" style={{ width: "100%" }}>
          <FileDropZone
            accept="image/jpeg,image/png,image/webp"
            disabled={submitting || formState.images.length >= MAX_CANDIDATE_IMAGES}
            hint={t("jobs.candidate.form.drop-hint")}
            onFiles={(dropped) => dropped.forEach((file) => void onAddImages(file))}
            onRejected={onRejected}
          >
            <Space wrap>
              <Upload
                accept="image/jpeg,image/png,image/webp"
                showUploadList={false}
                beforeUpload={(file) => {
                  void onAddImages(file as File);
                  return Upload.LIST_IGNORE;
                }}
              >
                <Button icon={<PlusOutlined />}>{t("jobs.candidate.form.add-image")}</Button>
              </Upload>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("jobs.candidate.form.drag-tip")}
              </Typography.Text>
            </Space>
          </FileDropZone>
          {formState.images.length > 0 ? (
            <Space wrap>
              {formState.images.map((source, index) => (
                <div key={`${index}-${source.slice(-16)}`} className="job-note-image-item">
                  <Image
                    src={source}
                    alt={t("jobs.candidate.form.image-alt", { index: index + 1 })}
                    width={96}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    aria-label={t("jobs.candidate.form.remove-image", { index: index + 1 })}
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      onChange((c) => ({ ...c, images: c.images.filter((_, i) => i !== index) }))
                    }
                  />
                </div>
              ))}
            </Space>
          ) : null}
        </Space>
      </Form.Item>
      <Form.Item label={t("jobs.candidate.form.note-label")} style={{ marginBottom: 0 }}>
        <Input.TextArea
          value={formState.note}
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder={t("jobs.candidate.form.note-placeholder")}
          onChange={(event) => onChange((c) => ({ ...c, note: event.target.value }))}
        />
      </Form.Item>
    </Form>
  );
}
