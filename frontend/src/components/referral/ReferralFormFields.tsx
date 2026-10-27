// SPDX-License-Identifier: Apache-2.0
/** 内推表单的全部 Form.Items（含图片备注上传块）。
 *
 * 受控组件：form 实例与上传状态由 ReferralPanel 持有，beforeImageUpload（含 message 与
 * uploadReferralImage 调用）留在页面经 prop 传入。
 */
import { CloseOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, DatePicker, Form, Input, Progress, Select, Space, Upload } from "antd";
import type { FormInstance } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { useEffect } from "react";
import type { ReferralPayload, ReferralStatus } from "../../types";
import { referralImageUrl } from "../../types";
import { useJobSearchSelect, useTrackSearchSelect } from "../../hooks/remoteSearchOptions";
import { IMAGE_ACCEPT } from "../../utils/attachments";
import { t } from "../../i18n";
import { REFERRAL_STATUS_LABEL_KEYS } from "../../i18n/enum/referral";
import { useLocale } from "../../i18n/i18nContext";

/** 与后端 ``schemas/referral.MAX_NOTE_IMAGES`` 保持一致。 */
export const MAX_NOTE_IMAGES = 9;

interface Props {
  form: FormInstance<ReferralPayload>;
  /** 编辑时的已绑定岗位 id：打开表单后按 id 回查，保证已选值保显示（P0-1）。 */
  initialJobId?: number | null;
  /** 编辑时的已绑定漏斗 id：同上。 */
  initialTrackId?: number | null;
  noteImages: string[];
  uploadingImages: boolean;
  /** 备注图上传进度（0-100）；null 表示不在上传中。 */
  imageUploadPercent: number | null;
  beforeImageUpload: (file: File) => Promise<string | boolean> | string | boolean;
  removeImage: (path: string) => void;
}

export default function ReferralFormFields({
  form,
  initialJobId = null,
  initialTrackId = null,
  noteImages,
  uploadingImages,
  imageUploadPercent,
  beforeImageUpload,
  removeImage,
}: Props) {
  // 本文件用模块级 t()：必须订阅语言变化，否则切语言后表单文案不重渲染。
  useLocale();
  // 关联岗位 / 漏斗下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();
  const trackSelect = useTrackSearchSelect();

  // 已选值保显示（P0-1）：编辑时绑定的岗位/漏斗往往不在第一页选项里，按 id 回查补进候选；
  // 打开表单时同时预拉第一页候选（与旧"页面预拉 100 条"的首屏体验对齐）。
  useEffect(() => {
    void jobSelect.ensure(initialJobId);
    void trackSelect.ensure(initialTrackId);
    void jobSelect.reload();
    void trackSelect.reload();
    // hook 的回调引用稳定，只跟随初始绑定变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId, initialTrackId]);

  return (
    <Form form={form} layout="vertical" initialValues={{ status: "active" }}>
      <Space style={{ display: "flex" }} align="start">
        <Form.Item label={t("referralForm.field.company")} name="company" style={{ flex: 1 }}>
          <Input maxLength={128} placeholder={t("referralForm.placeholder.company")} />
        </Form.Item>
        <Form.Item label={t("referralForm.field.position")} name="position" style={{ flex: 1 }}>
          <Input maxLength={128} placeholder={t("referralForm.placeholder.position")} />
        </Form.Item>
      </Space>
      <Form.Item label={t("referralForm.field.referrer")} name="referrer_name">
        <Input maxLength={128} placeholder={t("referralForm.placeholder.referrer")} />
      </Form.Item>
      <Space style={{ display: "flex" }} align="start">
        <Form.Item
          label={t("referralForm.field.contact")}
          name="referrer_contact"
          style={{ flex: 1 }}
        >
          <Input maxLength={128} placeholder={t("referralForm.placeholder.contact")} />
        </Form.Item>
        <Form.Item label={t("referralForm.field.relation")} name="relation" style={{ flex: 1 }}>
          <Input maxLength={64} placeholder={t("referralForm.placeholder.relation")} />
        </Form.Item>
      </Space>
      <Space style={{ display: "flex" }} align="start">
        <Form.Item label={t("referralForm.field.channel")} name="channel" style={{ flex: 1 }}>
          <Input maxLength={32} placeholder={t("referralForm.placeholder.channel")} />
        </Form.Item>
        <Form.Item label={t("referralForm.field.code")} name="referral_code" style={{ flex: 1 }}>
          <Input maxLength={64} placeholder={t("referralForm.placeholder.code")} />
        </Form.Item>
      </Space>
      <Form.Item label={t("referralForm.field.status")} name="status">
        <Select options={REFERRAL_STATUS_LABELS_OPTIONS()} />
      </Form.Item>
      <Form.Item label={t("referralForm.field.job")} name="job_id">
        <Select
          allowClear
          placeholder={t("referralForm.placeholder.job")}
          {...jobSelect.selectProps}
        />
      </Form.Item>
      <Form.Item label={t("referralForm.field.track")} name="track_id">
        <Select
          allowClear
          placeholder={t("referralForm.placeholder.track")}
          {...trackSelect.selectProps}
        />
      </Form.Item>
      <Form.Item
        label={t("referralForm.field.submittedAt")}
        name="submitted_at"
        extra={t("referralForm.hint.submittedAt")}
        getValueProps={(value: string) => ({ value: value ? dayjs(value) : null })}
        normalize={(value: Dayjs | null) => (value ? value.format("YYYY-MM-DD") : "")}
      >
        <DatePicker style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label={t("referralForm.field.images", { count: MAX_NOTE_IMAGES })}>
        <Upload
          accept={IMAGE_ACCEPT}
          multiple
          showUploadList={false}
          beforeUpload={beforeImageUpload}
          disabled={uploadingImages}
        >
          <Button
            icon={<UploadOutlined />}
            loading={uploadingImages}
            disabled={noteImages.length >= MAX_NOTE_IMAGES}
          >
            {t("referralForm.action.uploadImage")}
          </Button>
        </Upload>
        {imageUploadPercent !== null && (
          <Progress
            aria-label={t("referralForm.aria.uploadProgress")}
            percent={imageUploadPercent}
            size="small"
            status={imageUploadPercent >= 100 ? "success" : "active"}
            style={{ marginTop: 4 }}
          />
        )}
        {noteImages.length > 0 && (
          <Space wrap size={4} style={{ marginTop: 8 }}>
            {noteImages.map((path, index) => (
              <span
                key={path}
                style={{ position: "relative", display: "inline-block", lineHeight: 0 }}
              >
                <img
                  src={referralImageUrl(path)}
                  alt={t("referralForm.imageAlt", { index: index + 1 })}
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4 }}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  aria-label={t("referralForm.removeImage", { index: index + 1 })}
                  style={{ position: "absolute", top: -10, right: -10 }}
                  onClick={() => removeImage(path)}
                />
              </span>
            ))}
          </Space>
        )}
      </Form.Item>
      <Form.Item label={t("referralForm.field.note")} name="note">
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder={t("referralForm.placeholder.note")}
        />
      </Form.Item>
    </Form>
  );
}

/** 状态选项：分色在列表 Tag 上体现，这里只给标签（运行期 `t()`，随语言变化）。
 *  协议值 → key 的表在 `i18n/enum/referral.ts`，与列表行、详情抽屉共用同一张。 */
export function REFERRAL_STATUS_LABELS_OPTIONS(): { value: ReferralStatus; label: string }[] {
  return (Object.keys(REFERRAL_STATUS_LABEL_KEYS) as ReferralStatus[]).map((value) => ({
    value,
    label: t(REFERRAL_STATUS_LABEL_KEYS[value]),
  }));
}
