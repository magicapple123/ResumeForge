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
import { REFERRAL_STATUS_LABELS } from "../../types";

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
        <Form.Item label="公司" name="company" style={{ flex: 1 }}>
          <Input maxLength={128} placeholder="公司名" />
        </Form.Item>
        <Form.Item label="内推岗位" name="position" style={{ flex: 1 }}>
          <Input maxLength={128} placeholder="岗位名" />
        </Form.Item>
      </Space>
      <Form.Item label="内推人" name="referrer_name">
        <Input maxLength={128} placeholder="姓名 / 称呼" />
      </Form.Item>
      <Space style={{ display: "flex" }} align="start">
        <Form.Item label="联系方式" name="referrer_contact" style={{ flex: 1 }}>
          <Input maxLength={128} placeholder="微信 / 邮箱等" />
        </Form.Item>
        <Form.Item label="关系" name="relation" style={{ flex: 1 }}>
          <Input maxLength={64} placeholder="朋友 / 前同事 / 网友…" />
        </Form.Item>
      </Space>
      <Space style={{ display: "flex" }} align="start">
        <Form.Item label="渠道" name="channel" style={{ flex: 1 }}>
          <Input maxLength={32} placeholder="牛客 / 脉脉 / 熟人直递…" />
        </Form.Item>
        <Form.Item label="内推码" name="referral_code" style={{ flex: 1 }}>
          <Input maxLength={64} placeholder="官网内推码（选填）" />
        </Form.Item>
      </Space>
      <Form.Item label="状态" name="status">
        <Select options={REFERRAL_STATUS_LABELS_OPTIONS()} />
      </Form.Item>
      <Form.Item label="关联岗位（选填，删除岗位不影响内推）" name="job_id">
        <Select allowClear placeholder="输入关键词搜索岗位" {...jobSelect.selectProps} />
      </Form.Item>
      <Form.Item label="转化关联漏斗（选填，进入面试及以上即视为转化）" name="track_id">
        <Select allowClear placeholder="输入关键词搜索进度" {...trackSelect.selectProps} />
      </Form.Item>
      <Form.Item
        label="投递日期"
        name="submitted_at"
        extra="留空表示未知"
        getValueProps={(value: string) => ({ value: value ? dayjs(value) : null })}
        normalize={(value: Dayjs | null) => (value ? value.format("YYYY-MM-DD") : "")}
      >
        <DatePicker style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="图片备注（选填，最多 9 张）">
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
            上传备注图
          </Button>
        </Upload>
        {imageUploadPercent !== null && (
          <Progress
            aria-label="备注图上传进度"
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
                  alt={`备注图 ${index + 1}`}
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4 }}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  aria-label={`移除备注图 ${index + 1}`}
                  style={{ position: "absolute", top: -10, right: -10 }}
                  onClick={() => removeImage(path)}
                />
              </span>
            ))}
          </Space>
        )}
      </Form.Item>
      <Form.Item label="备注" name="note">
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="补充说明（选填）" />
      </Form.Item>
    </Form>
  );
}

/** 状态选项：分色在列表 Tag 上体现，这里只给标签。 */
export function REFERRAL_STATUS_LABELS_OPTIONS(): { value: ReferralStatus; label: string }[] {
  return (Object.keys(REFERRAL_STATUS_LABELS) as ReferralStatus[]).map((value) => ({
    value,
    label: REFERRAL_STATUS_LABELS[value],
  }));
}
