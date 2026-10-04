/** 内推表单的全部 Form.Items（含图片备注上传块）。
 *
 * 受控组件：form 实例与上传状态由 ReferralPanel 持有，beforeImageUpload（含 message 与
 * uploadReferralImage 调用）留在页面经 prop 传入。
 */
import { CloseOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, DatePicker, Form, Input, Select, Space, Upload } from "antd";
import type { FormInstance } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { ReferralPayload, ReferralStatus } from "../../types";
import { referralImageUrl } from "../../types";
import { IMAGE_ACCEPT } from "../../utils/attachments";
import { REFERRAL_STATUS_LABELS } from "../../types";

/** 与后端 ``schemas/referral.MAX_NOTE_IMAGES`` 保持一致。 */
export const MAX_NOTE_IMAGES = 9;

interface Option {
  value: number;
  label: string;
}

interface Props {
  form: FormInstance<ReferralPayload>;
  jobOptions: Option[];
  trackOptions: Option[];
  noteImages: string[];
  uploadingImages: boolean;
  beforeImageUpload: (file: File) => Promise<string | boolean> | string | boolean;
  removeImage: (path: string) => void;
}

export default function ReferralFormFields({
  form,
  jobOptions,
  trackOptions,
  noteImages,
  uploadingImages,
  beforeImageUpload,
  removeImage,
}: Props) {
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
        <Select allowClear showSearch optionFilterProp="label" options={jobOptions} />
      </Form.Item>
      <Form.Item label="转化关联漏斗（选填，进入面试及以上即视为转化）" name="track_id">
        <Select allowClear showSearch optionFilterProp="label" options={trackOptions} />
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
