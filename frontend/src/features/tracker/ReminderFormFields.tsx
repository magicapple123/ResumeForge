// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒新建/编辑表单的字段区（T05；自 ReminderPanel 拆出，让主文件守住 500 行预算）。
 *
 * 五件事落在这里：
 * 1. 默认提醒时间是**未来**（1 小时后、抹到分钟），不是"此刻"——新建时默认值就是合法值；
 * 2. 新建时校验「提醒时间需要晚于当前时间」，**编辑时放行**（只改备注不该被卡）；
 * 3. 时间只显示到分钟（`YYYY-MM-DD HH:mm` / 时间面板 `HH:mm`），不再显示秒；
 * 4. 时间字段下方按总开关状态显示任务卡提示（到期会不会生成「准备：…」卡）；
 * 5. 进度 / 岗位 / 简历三个关联字段收进「关联（选填）」折叠区，默认收起，
 *    收起时标题旁显示「已关联 N 项」。`forceRender` 让折叠里的值仍参与表单校验与提交，
 *    展开/收起不会丢已选值。
 */
import { Collapse, DatePicker, Form, Input, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import type {
  useJobSearchSelect,
  useResumeSearchSelect,
  useTrackSearchSelect,
} from "../../hooks/remoteSearchOptions";
import { t } from "../../i18n";
import { REMINDER_KIND_LABEL_KEYS } from "../../i18n/enum/reminder";
import { useLocale } from "../../i18n/i18nContext";
import { REMINDER_KINDS } from "../../types";
import type { Reminder, ReminderKind } from "../../types";
import { defaultRemindAt } from "./reminderFormDefaults";

export interface ReminderForm {
  title: string;
  remind_at: Dayjs;
  kind: ReminderKind;
  note?: string;
  track_id?: number;
  job_id?: number;
  resume_id?: number;
}

interface Props {
  form: FormInstance<ReminderForm>;
  /** 非空 = 编辑态：过去时间放行（见 field.time 的 validator）。 */
  editing: Reminder | null;
  /** 任务卡总开关：null = 还没读到（先不提示，避免闪一条错文案）；false = 关闭。 */
  taskCardsEnabled: boolean | null;
  trackSelect: ReturnType<typeof useTrackSearchSelect>;
  jobSelect: ReturnType<typeof useJobSearchSelect>;
  resumeSelect: ReturnType<typeof useResumeSearchSelect>;
}

export default function ReminderFormFields({
  form,
  editing,
  taskCardsEnabled,
  trackSelect,
  jobSelect,
  resumeSelect,
}: Props) {
  useLocale();
  const [linkOpen, setLinkOpen] = useState(false);
  // 收起时标题旁的计数：直接读表单 store（打开编辑时 setFieldsValue 已写入；折叠后字段
  // 不在树上时 Form.useWatch 拿不到未注册字段，所以这里不能用 watch）。每次收起/展开
  // 都会重算一次，用户刚选的值在收起那一刻就能反映出来。
  const linkedCount = [
    form.getFieldValue("track_id"),
    form.getFieldValue("job_id"),
    form.getFieldValue("resume_id"),
  ].filter((value): value is number => typeof value === "number").length;

  const linkLabel = (
    <Space size={6}>
      <span>{t("reminder.field.linkSection")}</span>
      {!linkOpen && linkedCount > 0 ? (
        <Typography.Text type="secondary">
          {t("reminder.field.linkedCount", { count: linkedCount })}
        </Typography.Text>
      ) : null}
    </Space>
  );

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ kind: "other", remind_at: defaultRemindAt() }}
    >
      <Form.Item
        label={t("reminder.field.content")}
        name="title"
        rules={[{ required: true, message: t("reminder.required.content") }]}
      >
        <Input maxLength={200} placeholder={t("reminder.placeholder.content")} />
      </Form.Item>
      <Form.Item
        label={t("reminder.field.time")}
        name="remind_at"
        rules={[
          { required: true, message: t("reminder.required.time") },
          {
            validator: async (_rule, value: Dayjs | undefined) => {
              // 编辑态放行；空值交给 required 规则。
              if (editing || !value) return;
              if (!value.isAfter(dayjs())) {
                throw new Error(t("reminder.required.futureTime"));
              }
            },
          },
        ]}
      >
        <DatePicker
          showTime={{ format: "HH:mm" }}
          format="YYYY-MM-DD HH:mm"
          style={{ width: "100%" }}
        />
      </Form.Item>
      {taskCardsEnabled === null ? null : (
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          {t(taskCardsEnabled ? "reminder.hint.taskCardOn" : "reminder.hint.taskCardOff")}
        </Typography.Paragraph>
      )}
      <Form.Item label={t("reminder.field.kind")} name="kind">
        <Select
          options={REMINDER_KINDS.map((value) => ({
            value,
            label: t(REMINDER_KIND_LABEL_KEYS[value]),
          }))}
        />
      </Form.Item>
      <Collapse
        activeKey={linkOpen ? ["link"] : []}
        onChange={(keys) => setLinkOpen(keys.length > 0)}
        items={[
          {
            key: "link",
            label: linkLabel,
            children: (
              <>
                <Form.Item label={t("reminder.field.track")} name="track_id">
                  <Select
                    allowClear
                    placeholder={t("reminder.placeholder.track")}
                    {...trackSelect.selectProps}
                  />
                </Form.Item>
                <Form.Item label={t("reminder.field.job")} name="job_id">
                  <Select
                    allowClear
                    placeholder={t("reminder.placeholder.job")}
                    {...jobSelect.selectProps}
                  />
                </Form.Item>
                <Form.Item label={t("reminder.field.resume")} name="resume_id">
                  <Select
                    allowClear
                    placeholder={t("reminder.placeholder.resume")}
                    {...resumeSelect.selectProps}
                  />
                </Form.Item>
              </>
            ),
          },
        ]}
        style={{ marginBottom: 16 }}
      />
      <Form.Item label={t("reminder.field.note")} name="note">
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder={t("reminder.placeholder.note")}
        />
      </Form.Item>
    </Form>
  );
}
