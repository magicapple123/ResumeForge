// SPDX-License-Identifier: Apache-2.0
/** 面经的新增/编辑表单弹窗（从 InterviewExperiencePanel 拆出：面板顶着 500 行预算）。
 *
 * 表单实例由面板持有（openCreate/openEdit 需要预填字段），jobSelect 由面板传入——
 * 详情抽屉的「关联岗位」名称回查用的是同一个候选池，拆成两份会出现两套搜索状态。
 */
import { DatePicker, Form, Input, Select, Space } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { FormInstance } from "antd";
import { useState } from "react";
import type { InterviewExperience, InterviewExperiencePayload } from "../../types";
import { EXPERIENCE_ROUND_TYPES, EXPERIENCE_SOURCES, EXPERIENCE_SOURCE_LABELS } from "../../types";
import type { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import FormModal from "../common/FormModal";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  open: boolean;
  /** 编辑目标（null = 新增）。 */
  editing: InterviewExperience | null;
  form: FormInstance<InterviewExperiencePayload>;
  saving: boolean;
  jobSelect: ReturnType<typeof useJobSearchSelect>;
  onCancel: () => void;
  onOk: () => void;
}

export default function InterviewExperienceFormModal({
  open,
  editing,
  form,
  saving,
  jobSelect,
  onCancel,
  onOk,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹窗文案不更新。
  useLocale();
  // 脏值只用来决定"关闭时要不要问一句"：第一次改动之后就一直为真（关掉弹窗即重置）。
  const [dirty, setDirty] = useState(false);
  return (
    <FormModal
      title={
        editing
          ? t("interview.experienceForm.title.edit")
          : t("interview.experienceForm.title.create")
      }
      open={open}
      onCancel={onCancel}
      onSubmit={onOk}
      submitting={saving}
      okText={t("interview.experienceForm.action.save")}
      dirty={dirty}
      width={720}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ source: "self" }}
        onValuesChange={() => setDirty(true)}
      >
        <Form.Item label={t("interview.experienceForm.field.title")} name="title">
          <Input maxLength={200} placeholder={t("interview.experienceForm.placeholder.title")} />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item
            label={t("interview.experienceForm.field.company")}
            name="company"
            style={{ flex: 1 }}
          >
            <Input
              maxLength={128}
              placeholder={t("interview.experienceForm.placeholder.company")}
            />
          </Form.Item>
          <Form.Item
            label={t("interview.experienceForm.field.position")}
            name="position"
            style={{ flex: 1 }}
          >
            <Input
              maxLength={128}
              placeholder={t("interview.experienceForm.placeholder.position")}
            />
          </Form.Item>
        </Space>
        <Form.Item label={t("interview.experienceForm.field.job")} name="job_id">
          <Select
            allowClear
            placeholder={t("interview.experienceForm.placeholder.job")}
            {...jobSelect.selectProps}
          />
        </Form.Item>
        <Form.Item label={t("interview.experienceForm.field.content")} name="content">
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder={t("interview.experienceForm.placeholder.content")}
          />
        </Form.Item>
        <Form.Item
          label={t("interview.experienceForm.field.questions")}
          name="questions"
          extra={t("interview.experienceForm.hint.questions")}
        >
          <Select
            mode="tags"
            placeholder={t("interview.experienceForm.placeholder.questions")}
            open={false}
            suffixIcon={null}
          />
        </Form.Item>
        <Form.Item label={t("interview.experienceForm.field.tags")} name="tags">
          <Select
            mode="tags"
            placeholder={t("interview.experienceForm.placeholder.tags")}
            open={false}
            suffixIcon={null}
          />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item
            label={t("interview.experienceForm.field.source")}
            name="source"
            style={{ flex: 1 }}
          >
            <Select
              options={EXPERIENCE_SOURCES.map((value) => ({
                value,
                label: EXPERIENCE_SOURCE_LABELS[value],
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("interview.experienceForm.field.difficulty")}
            name="difficulty"
            style={{ flex: 1 }}
          >
            <Input
              maxLength={16}
              placeholder={t("interview.experienceForm.placeholder.difficulty")}
            />
          </Form.Item>
        </Space>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item
            label={t("interview.experienceForm.field.round")}
            name="round_type"
            style={{ flex: 1 }}
          >
            <Select
              allowClear
              placeholder={t("interview.experienceForm.placeholder.round")}
              options={EXPERIENCE_ROUND_TYPES.map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item
            label={t("interview.experienceForm.field.date")}
            name="interview_date"
            style={{ flex: 1 }}
            getValueProps={(value: string) => ({ value: value ? dayjs(value) : null })}
            normalize={(value: Dayjs | null) => (value ? value.format("YYYY-MM-DD") : "")}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </Space>
      </Form>
    </FormModal>
  );
}
