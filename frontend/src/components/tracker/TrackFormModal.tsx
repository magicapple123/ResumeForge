// SPDX-License-Identifier: Apache-2.0
/**
 * 进度记录的新建 / 编辑表单。
 *
 * 日期字段用 AntD ``DatePicker``（E12）：值在表单里是 Dayjs，提交时再转回 ``YYYY-MM-DD``。
 * 公司和岗位是必填：进度要按这两项合并，缺一个就无从判断该并到哪一条上。
 */
import { SaveOutlined } from "@ant-design/icons";
import { App, Button, DatePicker, Form, Input, Select } from "antd";
import FormModal from "../common/FormModal";
import { useFormDraft } from "../../hooks/useFormDraft";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { TRACK_CHANNEL_LABEL_KEYS, TRACK_STATUS_LABEL_KEYS } from "../../i18n/enum/tracker";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { useEffect, useState } from "react";
import { createTrack, getTrack, updateTrack } from "../../api/tracker";
import { useJobSearchSelect, useResumeSearchSelect } from "../../hooks/remoteSearchOptions";
import type { Track, TrackChannel, TrackPayload, TrackStatus } from "../../types";
import { TRACK_CHANNELS, TRACK_STATUSES, emptyTrack } from "../../types";
import { HintedTextArea } from "../common/MaxLengthHint";

const STATUS_OPTIONS = TRACK_STATUSES.map((value) => ({
  value,
  labelKey: TRACK_STATUS_LABEL_KEYS[value],
}));

const CHANNEL_OPTIONS = TRACK_CHANNELS.map((value) => ({
  value,
  labelKey: TRACK_CHANNEL_LABEL_KEYS[value],
}));

interface FormValues {
  company: string;
  title: string;
  status: TrackStatus;
  stage_note: string;
  applied_at: Dayjs | null;
  status_date: Dayjs | null;
  next_action: string;
  next_action_date: Dayjs | null;
  note: string;
  job_id: number | null;
  resume_id: number | null;
  channel: TrackChannel;
}

const EMPTY: FormValues = {
  company: "",
  title: "",
  status: "applied",
  stage_note: "",
  applied_at: null,
  status_date: null,
  next_action: "",
  next_action_date: null,
  note: "",
  job_id: null,
  resume_id: null,
  channel: "unknown",
};

function toValues(track: Track): FormValues {
  return {
    company: track.company,
    title: track.title,
    status: track.status,
    stage_note: track.stage_note,
    applied_at: track.applied_at ? dayjs(track.applied_at) : null,
    status_date: track.status_date ? dayjs(track.status_date) : null,
    next_action: track.next_action,
    next_action_date: track.next_action_date ? dayjs(track.next_action_date) : null,
    note: track.note,
    job_id: track.job_id,
    resume_id: track.resume_id,
    channel: track.channel,
  };
}

function toPayload(values: FormValues, track: Track | null): TrackPayload {
  return {
    ...emptyTrack(),
    company: values.company.trim(),
    title: values.title.trim(),
    status: values.status,
    stage_note: values.stage_note.trim(),
    applied_at: values.applied_at ? values.applied_at.format("YYYY-MM-DD") : "",
    status_date: values.status_date ? values.status_date.format("YYYY-MM-DD") : "",
    next_action: values.next_action.trim(),
    next_action_date: values.next_action_date ? values.next_action_date.format("YYYY-MM-DD") : "",
    note: values.note.trim(),
    // 证据是识别/投递台留下的痕迹，手编不碰；岗位与简历关联由本表单显式选择（选填）。
    evidence: track?.evidence ?? "",
    job_id: values.job_id ?? null,
    resume_id: values.resume_id ?? null,
    channel: values.channel,
  };
}

interface Props {
  open: boolean;
  track: Track | null;
  onClose: () => void;
  onSaved: (track: Track) => void;
}

export default function TrackFormModal({ open, track, onClose, onSaved }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  // 岗位 / 简历下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量，
  // 第 101 条之后的历史记录也能通过关键词搜到。
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeSearchSelect();
  const [full, setFull] = useState<Track | null>(null);
  const editing = track !== null;
  // 脏值决定"关闭时要不要问一句"；换一条记录 / 重开弹窗都从干净态开始。
  const [dirty, setDirty] = useState(false);
  const toast = useToast();
  // 草稿按"新增 / 某条记录"分作用域：编辑 12 号时不该看到 13 号的内容。
  const watched = Form.useWatch<FormValues>([], form) as FormValues | undefined;
  const draft = useFormDraft({
    scope: `tracker.edit#${track?.id ?? "new"}`,
    values: (watched ?? EMPTY) as unknown as Record<string, unknown>,
    open,
    isEmpty: (values) => !values.company && !values.position,
  });

  useEffect(() => {
    if (!open) {
      // 关闭即丢弃详情缓存：随 open 变化的重置（Compiler 规范允许的同步重置模式）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFull(null);
      return;
    }
    // 已选值保显示（P0-1）：编辑时绑定的岗位/简历往往不在第一页选项里，按 id 回查。
    void jobSelect.ensure(track?.job_id);
    void resumeSelect.ensure(track?.resume_id);
    void jobSelect.reload();
    void resumeSelect.reload();
    // 先用列表行乐观预填（公司/岗位/日期/状态都是全的），note 与依据可能被后端
    // 截断过，等下面的详情请求回来再覆盖。
    form.setFieldsValue(track ? toValues(track) : EMPTY);
    setDirty(false);
    if (!track) return;
    // 列表接口的 note/evidence 是**预览**（超长截断加省略号，见后端 _track_brief）：
    // 编辑必须回详情拿全文——否则保存（PUT 是整体替换）会把截断文本写回库。
    let cancelled = false;
    getTrack(track.id)
      .then((detail) => {
        if (cancelled) return;
        setFull(detail);
        form.setFieldsValue(toValues(detail));
      })
      .catch(() => {
        // 详情拿不到（后端短暂不可用）就退回预览预填：基本字段仍可编辑，
        // note 若真被截断，用户保存前的 TextArea 里能看到省略号，不至于无感丢字。
      });
    return () => {
      cancelled = true;
    };
    // hook 的回调引用稳定，只需跟随打开状态与编辑目标变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, track, form]);

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败时 antd 已在字段旁给出提示
    }
    // 回传 evidence / 关联 id 用详情全量（full），拿不到才退回列表行。
    const source = full ?? track;
    const payload = toPayload(values, source);
    try {
      const saved = track ? await updateTrack(track.id, payload) : await createTrack(payload);
      draft.clear();
      message.success(editing ? t("trackerForm.toast.saved") : t("trackerForm.toast.added"));
      onSaved(saved);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("trackerForm.error.saveFailed"));
    }
  };

  return (
    <FormModal
      open={open}
      title={editing ? t("trackerForm.title.edit") : t("trackerForm.title.create")}
      onCancel={() => {
        if (dirty) toast.info(t("draft.kept"));
        onClose();
      }}
      onSubmit={() => void submit()}
      okText={t("trackerForm.action.save")}
      okIcon={<SaveOutlined />}
      dirty={dirty}
      hasDraft
      draftBar={
        draft.pending
          ? {
              savedAt: draft.pending.savedAt,
              fieldCount: Object.keys(draft.pending.values).length,
              onRestore: () => form.setFieldsValue(draft.adopt() as unknown as FormValues),
              onDiscard: draft.discard,
            }
          : null
      }
      width={720}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={EMPTY}
        onValuesChange={() => setDirty(true)}
      >
        {/* 用普通 flex 而不是 antd 的 Space：Space 会给每个子项再包一层，
            flex 宽度落不到真正的 flex 子项上。 */}
        <div className="track-form-row">
          <Form.Item
            name="company"
            label={t("trackerForm.field.company")}
            className="track-form-grow"
            rules={[{ required: true, message: t("trackerForm.required.company") }]}
          >
            <Input placeholder={t("trackerForm.placeholder.company")} maxLength={128} />
          </Form.Item>
          <Form.Item
            name="title"
            label={t("trackerForm.field.title")}
            className="track-form-grow"
            rules={[{ required: true, message: t("trackerForm.required.title") }]}
          >
            <Input placeholder={t("trackerForm.placeholder.title")} maxLength={128} />
          </Form.Item>
        </div>

        <div className="track-form-row">
          <Form.Item
            name="status"
            label={t("trackerForm.field.status")}
            className="track-form-grow"
          >
            <Select
              options={STATUS_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="stage_note"
            label={t("trackerForm.field.stageNote")}
            className="track-form-grow"
            extra={t("trackerForm.hint.stageNote")}
          >
            <Input maxLength={64} />
          </Form.Item>
        </div>

        <div className="track-form-row">
          <Form.Item
            name="applied_at"
            label={t("trackerForm.field.appliedAt")}
            className="track-form-grow"
            // 说清留空的代价。此前只写「YYYY-MM-DD」，留空是阻力最小的路径，而后果
            // （该记录不进投递趋势与周内分布）用户看不到——统计页那张空图就是这么来的。
            // **刻意不预填今天**：投递台的自动记录知道日期（刚投出去的就是今天），
            // 手工录入不知道（可能是三周后照着通知补录），预填会把记录钉在错误的月份上，
            // 在趋势图里造出一个从未发生过的尖峰。给一键填入，让用户自己确认。
            extra={
              <>
                {t("trackerForm.hint.appliedAt")}
                <Button
                  type="link"
                  size="small"
                  onClick={() => form.setFieldValue("applied_at", dayjs())}
                >
                  {t("trackerForm.action.fillToday")}
                </Button>
              </>
            }
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="status_date"
            label={t("trackerForm.field.statusDate")}
            className="track-form-grow"
            extra={t("trackerForm.hint.statusDate")}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </div>

        <div className="track-form-row">
          <Form.Item
            name="next_action"
            label={t("trackerForm.field.nextAction")}
            className="track-form-grow"
          >
            <Input placeholder={t("trackerForm.placeholder.nextAction")} maxLength={255} />
          </Form.Item>
          <Form.Item
            name="next_action_date"
            label={t("trackerForm.field.nextActionDate")}
            className="track-form-date"
            extra={t("trackerForm.hint.nextActionDate")}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </div>

        {/* 渠道选择（RF-18）：用户自选"这份工作从哪来的"，默认未知。
            与记录来源（这一行怎么进系统的）是两回事，界面措辞刻意分开。 */}
        <Form.Item
          name="channel"
          label={t("trackerForm.field.channel")}
          extra={t("trackerForm.hint.channel")}
        >
          <Select
            options={CHANNEL_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </Form.Item>

        {/* 岗位关联（RF-18）：选填。把这条进度挂到资料库里的一个岗位，
            岗位详情页的「该岗位的投递进度」会把它收进来。 */}
        <Form.Item
          name="job_id"
          label={t("trackerForm.field.job")}
          extra={t("trackerForm.hint.job")}
        >
          <Select
            allowClear
            placeholder={t("trackerForm.placeholder.job")}
            {...jobSelect.selectProps}
          />
        </Form.Item>

        {/* 简历选择器（RF-17）：选填。显式关联后后端冻结一份投递快照，
            回答"这一版投给了谁"；清掉关联不影响已有快照。 */}
        <Form.Item
          name="resume_id"
          label={t("trackerForm.field.resume")}
          extra={t("trackerForm.hint.resume")}
        >
          <Select
            allowClear
            placeholder={t("trackerForm.placeholder.resume")}
            {...resumeSelect.selectProps}
          />
        </Form.Item>

        {/* showCount 已移除（统一用 MaxLengthHint 模式）：只有顶到 4000 字上限时，
            才在输入框下方出现一行小号红字提醒。 */}
        <Form.Item name="note" label={t("trackerForm.field.note")}>
          <HintedTextArea rows={3} maxLength={4000} />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
