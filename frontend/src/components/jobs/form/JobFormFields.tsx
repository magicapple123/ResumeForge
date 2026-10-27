// SPDX-License-Identifier: Apache-2.0
/** 岗位表单的静态字段（岗位名称 → 备注）。
 *
 * 零 props：Form.Item 经 Form context 注册到 JobFormModal 持有的同一个 form 实例。
 */
import { DatePicker, Form, Input, Select } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { t } from "../../../i18n";
import { JOB_STATUS_LABEL_KEYS, JOB_TYPE_LABEL_KEYS } from "../../../i18n/enum/jobs";
import { useLocale } from "../../../i18n/i18nContext";
import { HintedTextArea } from "../../common/MaxLengthHint";

export default function JobFormFields() {
  useLocale();
  // 下拉的 value 仍是落库的协议值（types/job.ts 的选项表），只有展示名在渲染期取：
  // 放模块作用域会让切语言后停在旧文案。
  const jobTypeOptions = Object.entries(JOB_TYPE_LABEL_KEYS).map(([value, key]) => ({
    value,
    label: t(key),
  }));
  const statusOptions = Object.entries(JOB_STATUS_LABEL_KEYS).map(([value, key]) => ({
    value,
    label: t(key),
  }));
  return (
    <>
      <Form.Item
        name="title"
        label={t("jobForm.field.title")}
        rules={[{ required: true, message: t("jobForm.required.title") }]}
      >
        <Input placeholder={t("jobForm.placeholder.title")} />
      </Form.Item>
      <Form.Item name="company" label={t("jobForm.field.company")}>
        <Input placeholder={t("jobForm.placeholder.company")} />
      </Form.Item>
      <Form.Item name="location" label={t("jobForm.field.location")}>
        <Input placeholder={t("jobForm.placeholder.location")} />
      </Form.Item>
      <Form.Item name="salary" label={t("jobForm.field.salary")}>
        <Input placeholder={t("jobForm.placeholder.salary")} />
      </Form.Item>
      <Form.Item name="job_type" label={t("jobForm.field.jobType")}>
        <Select options={jobTypeOptions} />
      </Form.Item>
      <Form.Item name="status" label={t("jobForm.field.status")}>
        <Select options={statusOptions} />
      </Form.Item>
      <Form.Item
        name="source_url"
        label={t("jobForm.field.sourceUrl")}
        rules={[{ type: "url", message: t("jobForm.required.url") }]}
      >
        <Input placeholder={t("jobForm.placeholder.sourceUrl")} />
      </Form.Item>
      <Form.Item
        name="posted_at"
        label={t("jobForm.field.postedAt")}
        // DatePicker 值走 Dayjs，但 JobPayload.posted_at 是字符串：getValueProps 把存的
        // 字符串转成 Dayjs 给控件，normalize 再把 Dayjs 转回 YYYY-MM-DD 存进表单。
        getValueProps={(value: string) => ({ value: value ? dayjs(value) : null })}
        normalize={(value: Dayjs | null) => (value ? value.format("YYYY-MM-DD") : "")}
      >
        <DatePicker style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item
        name="description"
        label={t("jobForm.field.description")}
        rules={[{ required: true, message: t("jobForm.required.description") }]}
      >
        <HintedTextArea
          rows={7}
          maxLength={20000}
          placeholder={t("jobForm.placeholder.description")}
        />
      </Form.Item>
      <Form.Item name="requirements" label={t("jobForm.field.requirements")}>
        <Input.TextArea rows={3} placeholder={t("jobForm.placeholder.requirements")} />
      </Form.Item>
      <Form.Item name="additional_info" label={t("jobForm.field.additionalInfo")}>
        <Input.TextArea rows={4} placeholder={t("jobForm.placeholder.additionalInfo")} />
      </Form.Item>
      <Form.Item name="note" label={t("jobForm.field.note")}>
        <HintedTextArea rows={3} maxLength={2000} placeholder={t("jobForm.placeholder.note")} />
      </Form.Item>
    </>
  );
}
