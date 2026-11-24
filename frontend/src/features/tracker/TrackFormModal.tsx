// SPDX-License-Identifier: Apache-2.0
/**
 * 进度记录的新建 / 编辑表单。
 *
 * 日期字段用 AntD ``DatePicker``（E12）：值在表单里是 Dayjs，提交时再转回 ``YYYY-MM-DD``。
 * 公司和岗位是必填：进度要按这两项合并，缺一个就无从判断该并到哪一条上。
 *
 * 关联链接（``link``）取代了已删除的「申请状态回读」：用户在这一条上自己填入口地址
 * （招聘页 / 网申页 / 会议链接），列表行上给一个可点的图标。校验与岗位「投递链接」
 * 同一口径（见 ``./linkValidation.ts``）。选择关联岗位时，**链接还空着且是用户自己改的岗位**，
 * 自动带上该岗位的 ``source_url``——打开旧记录编辑不补，避免把历史记录写脏。
 */
import { SaveOutlined } from "@ant-design/icons";
import { App, Button, DatePicker, Form, Input, Select } from "antd";
import FormModal from "../../components/common/FormModal";
import { useFormDraft } from "../../hooks/useFormDraft";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { TRACK_CHANNEL_LABEL_KEYS, TRACK_STATUS_LABEL_KEYS } from "../../i18n/enum/tracker";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { useEffect, useRef, useState } from "react";
import { getJob } from "../../api/jobs";
import { createTrack, getTrack, updateTrack } from "../../api/tracker";
import { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import type { Track, TrackChannel, TrackPayload, TrackStatus } from "../../types";
import { TRACK_CHANNELS, TRACK_STATUSES, emptyTrack } from "../../types";
import { HintedTextArea } from "../../components/common/MaxLengthHint";
import { MAX_TRACK_LINK_CHARS, trackLinkError } from "./linkValidation";
import {
  parseResumeRef,
  trackResumeRef,
  useTrackResumeSelect,
} from "./useTrackResumeSelect";

const STATUS_OPTIONS = TRACK_STATUSES.map((value) => ({
  value,
  labelKey: TRACK_STATUS_LABEL_KEYS[value],
}));

const CHANNEL_OPTIONS = TRACK_CHANNELS.map((value) => ({
  value,
  labelKey: TRACK_CHANNEL_LABEL_KEYS[value],
}));

/**
 * 关联链接的长度上限（与后端列宽一致，见 `linkValidation.ts`）。
 */
const MAX_LINK_CHARS = MAX_TRACK_LINK_CHARS;

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
  /**
   * 「使用的简历」的复合值（T6）：`internal:<id>` / `external:<id>` / `null`。
   * 表单里只存这一个值，提交时才拆回两个字段（见 `toPayload`）——两张表 id 会撞号，
   * 用裸数字当表单值会在保存时拆错字段。
   */
  resume_ref: string | null;
  channel: TrackChannel;
  link: string;
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
  resume_ref: null,
  channel: "unknown",
  link: "",
};

/**
 * 关联链接的字段校验（口径实现见 `linkValidation.ts`，与后端同一份规则）。
 *
 * 抽成一层是为了让 antd 的 `rules` 只表达"怎么显示"：校验本身返回一句文案，
 * 这里用 reject 把它交给字段下方显示。
 */
function linkFieldValidator(_rule: unknown, value: string | undefined): Promise<void> {
  const error = trackLinkError(value);
  return error ? Promise.reject(new Error(error)) : Promise.resolve();
}

function toValues(track: TrackPayload): FormValues {
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
    // 两种来源在这里合成一个复合值；两个关联字段都为空 → null（合法状态）。
    resume_ref: trackResumeRef(track),
    channel: track.channel,
    // 旧记录 / 旧草稿里可能没有这个字段：空串是它的合法默认值。
    link: track.link ?? "",
  };
}

function toPayload(values: FormValues, track: Track | null): TrackPayload {
  // 解析失败按 null（**不抛**）：两个关联都是选填，表单里出现脏值的代价不该是保存不了。
  const resumeRef = parseResumeRef(values.resume_ref);
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
    // 两个关联字段**互斥**（后端 422 守着）：清空下拉 = 两个都是 null，
    // 标题快照由后端保留（"当时投的是哪一版"不该因为取消关联而消失）。
    resume_id: resumeRef?.kind === "internal" ? resumeRef.id : null,
    external_resume_id: resumeRef?.kind === "external" ? resumeRef.id : null,
    channel: values.channel,
    // 提交前 trim：`<a href=" https://…">` 里那个空格会被浏览器当成相对路径的一部分。
    link: (values.link ?? "").trim(),
  };
}

interface Props {
  open: boolean;
  track: Track | null;
  initial?: Partial<TrackPayload>;
  onClose: () => void;
  onSaved: (track: Track) => void;
}

export default function TrackFormModal({ open, track, initial, onClose, onSaved }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  // 岗位 / 简历下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量，
  // 第 101 条之后的历史记录也能通过关键词搜到。
  const jobSelect = useJobSearchSelect();
  // 简历下拉（T6）：候选随岗位收窄成「本岗位 + 通用」，内部/外部两组。
  // 岗位从表单里**实时**读（`Form.useWatch`），不从 props 猜——换岗位时必须立刻重拉，
  // 否则用户看到的是上一个岗位的候选（选错版本就是这么来的）。
  const watchedJobId = Form.useWatch<number | null>("job_id", form) ?? null;
  const resumeSelect = useTrackResumeSelect(watchedJobId);
  const [full, setFull] = useState<Track | null>(null);
  const editing = (full ?? track) !== null;
  // 脏值决定"关闭时要不要问一句"；换一条记录 / 重开弹窗都从干净态开始。
  const [dirty, setDirty] = useState(false);
  const toast = useToast();
  // 草稿按"新增 / 某条记录"分作用域：编辑 12 号时不该看到 13 号的内容。
  const watched = Form.useWatch<FormValues>([], form) as FormValues | undefined;
  const draft = useFormDraft({
    scope: `tracker.edit#${track?.id ?? (initial?.job_id ? `job-${initial.job_id}` : "new")}`,
    values: (watched ?? EMPTY) as unknown as Record<string, unknown>,
    open,
    isEmpty: (values) => !values.company && !values.title,
  });
  // —— 关联链接的自动带出 ——
  // 只在「用户自己改了岗位」且「链接仍为空」时补一次。打开编辑旧记录走的是
  // `setFieldsValue`（不触发 Select 的 onChange），所以历史记录不会被补写。
  const linkSeqRef = useRef(0);

  const handleJobChange = (value: number | null | undefined) => {
    const jobId = value ?? null;
    // 每次改动都递增序号：在途请求回来时序号已过期，结果直接丢弃（防乱序）。
    const seq = ++linkSeqRef.current;
    // 清空岗位**不动**链接：用户填过的地址不该被"取消关联"这个动作带走。
    if (jobId == null) return;
    // 链接里已经有内容 = 用户自己的东西，不覆盖。
    if (String(form.getFieldValue("link") ?? "").trim()) return;
    void getJob(jobId)
      .then((job) => {
        // 双复核：① 期间没有更晚的岗位改动；② 表单里的岗位仍是这次请求的那个。
        if (seq !== linkSeqRef.current) return;
        if ((form.getFieldValue("job_id") ?? null) !== jobId) return;
        // 请求在途时用户自己填了链接：以用户为准。
        if (String(form.getFieldValue("link") ?? "").trim()) return;
        const url = (job?.source_url ?? "").trim();
        // 岗位自己没填投递链接：留空，不替用户猜一个地址。
        if (!url) return;
        form.setFieldValue("link", url);
      })
      .catch(() => {
        // 回查失败就保持空：链接是选填，不为了自动带出拦住保存。
      });
  };

  useEffect(() => {
    if (!open) {
      // 关闭即丢弃详情缓存：随 open 变化的重置（Compiler 规范允许的同步重置模式）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFull(null);
      return;
    }
    // 已选值保显示（P0-1）：编辑时绑定的岗位往往不在第一页选项里，按 id 回查。
    void jobSelect.ensure(track?.job_id ?? initial?.job_id);
    void jobSelect.reload();
    // 简历候选的重拉与"已选值保显示"在下一个 effect 里（它跟着岗位走）。
    // 先用列表行乐观预填（公司/岗位/日期/状态都是全的），note 与依据可能被后端
    // 截断过，等下面的详情请求回来再覆盖。
    form.setFieldsValue(track ? toValues(track) : toValues({ ...emptyTrack(), ...initial }));
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
        // 详情里的关联比列表行更权威（brief 与 detail 共用同一份模型，但详情一定是全的）：
        // 按它的复合值再 ensure 一次，保证下拉显示的是名字而不是 `external:3`。
        void resumeSelect.ensure(trackResumeRef(detail), detail.resume_title);
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
  }, [open, track, initial, form]);

  /**
   * 岗位变化 → **重拉候选** + 对已选值重新 `ensure`（T6）。
   *
   * **不调用** `setFieldValue("resume_ref", null)`：换岗位只收窄候选，已选版本原样保留
   * （静默清空等于让用户重选，静默改选会把错误版本写进投递记录）；不再属于
   * 「本岗位 + 通用」的值由 hook 在 label 上追加「（不属于当前岗位）」。未选岗位 = 全库。
   */
  useEffect(() => {
    if (!open) return;
    void resumeSelect.reload();
    const current = form.getFieldValue("resume_ref") as string | null;
    if (current) {
      // 标题快照来自列表行/详情：404 时用它降级，别让用户看到裸 id。
      void resumeSelect.ensure(current, (full ?? track)?.resume_title ?? "");
    }
    // `resumeSelect` 的 reload/ensure 已按岗位变化重建，无需写进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, watchedJobId]);

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
      const saved = source ? await updateTrack(source.id, payload) : await createTrack(payload);
      draft.clear();
      if ("created" in saved && saved.created === false) {
        setFull(saved);
        form.setFieldsValue(toValues(saved));
        setDirty(false);
        message.info(t("trackerForm.toast.existing"));
        onSaved(saved);
        return;
      }
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
      onSubmit={submit}
      okText={t("trackerForm.action.save")}
      okIcon={<SaveOutlined />}
      dirty={dirty}
      hasDraft
      draftBar={
        draft.pending
          ? {
              savedAt: draft.pending.savedAt,
              fieldCount: Object.keys(draft.pending.values).length,
              onRestore: () => {
                const values = draft.adopt() as unknown as FormValues;
                // sessionStorage JSON turns Dayjs values into strings; DatePicker needs Dayjs.
                form.setFieldsValue({
                  ...values,
                  applied_at: values.applied_at ? dayjs(values.applied_at) : null,
                  status_date: values.status_date ? dayjs(values.status_date) : null,
                  next_action_date: values.next_action_date ? dayjs(values.next_action_date) : null,
                });
              },
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
            岗位详情页的「该岗位的投递进度」会把它收进来。
            onChange 兼做「关联链接自动带出」的触发点（见 handleJobChange）。 */}
        <Form.Item
          name="job_id"
          label={t("trackerForm.field.job")}
          extra={t("trackerForm.hint.job")}
        >
          <Select
            allowClear
            placeholder={t("trackerForm.placeholder.job")}
            {...jobSelect.selectProps}
            onChange={(value: number | null | undefined) => handleJobChange(value)}
          />
        </Form.Item>

        {/* 关联链接（取代已删除的「状态回读」）：选填。填了之后列表行给出一个
            新窗口打开的图标；地址只放行 http / https（校验见 linkError）。 */}
        <Form.Item
          name="link"
          label={t("trackerForm.field.link")}
          extra={t("trackerForm.hint.link")}
          rules={[{ validator: linkFieldValidator }]}
        >
          <Input placeholder={t("trackerForm.placeholder.link")} maxLength={MAX_LINK_CHARS} />
        </Form.Item>

        {/* 简历选择器（RF-17 / T6）：选填。一个下拉两组（内部 / 外部），值是复合串
            `internal:<id>` / `external:<id>`；候选随岗位收窄，换岗位不清空已选值。 */}
        <Form.Item
          name="resume_ref"
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
