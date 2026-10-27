// SPDX-License-Identifier: Apache-2.0
/**
 * 台账条目的新建 / 编辑表单。
 *
 * 两个刻意的取舍：
 * 1. **日期用纯输入框**，不引 dayjs / DatePicker——项目其余部分（资料库的起止日期）
 *    就是纯文本 `YYYY-MM-DD`，格式由后端校验。多引一个日期库不值得。
 * 2. **列表型字段用「每行一条」的文本域或 tags 下拉**，而不是嵌套数组表单：证据来源
 *    有四个字段，用 Form.List 展开；而"决策 / 难点 / 验证"这种纯字符串列表，多行文本
 *    更快也更不容易点错。
 */
import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { App, Button, DatePicker, Form, Input, Select, Space, Switch, Typography } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { useEffect, useState } from "react";
import FormModal from "../common/FormModal";
import { useFormDraft } from "../../hooks/useFormDraft";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { createClaim, updateClaim } from "../../api/claims";
import type { Claim, ClaimPayload, ClaimSource, SourceType } from "../../types";
import { HintedTextArea } from "../common/MaxLengthHint";
import {
  CLAIM_CATEGORIES,
  RESPONSIBILITY_LEVELS,
  SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_HINTS,
  emptyClaim,
} from "../../types";

/**
 * 一句话讲清每个承担程度，用户不必猜"负责模块"和"主导交付"差在哪。
 *
 * i18n-ok: key 是协议值（中文枚举，直接提交后端并参与校验），翻译会写坏数据；
 * 说明文本本身待「枚举 code 化」那批统一处理。
 */
const RESPONSIBILITY_HINTS: Record<string, string> = {
  参与: "在他人安排下完成其中一部分工作",
  负责模块: "独立负责其中一个明确模块或方向",
  主导方案或交付: "方案由你定、交付由你推，其他人配合你",
  项目负责人: "对整个项目的结果负责",
};

const STATUS_OPTIONS = VERIFICATION_STATUSES.map((value) => ({
  value,
  label: `${value}——${VERIFICATION_STATUS_HINTS[value]}`,
}));

const RESPONSIBILITY_OPTIONS = RESPONSIBILITY_LEVELS.map((value) => ({
  value,
  label: `${value}——${RESPONSIBILITY_HINTS[value]}`,
}));

interface FormValues {
  title: string;
  category: string;
  subject: string;
  source_fact: string;
  candidate_wording: string;
  responsibility_level: string;
  verification_status: string;
  boundary: string;
  last_verified: string;
  allowed_uses: string[];
  risk_notes: string[];
  sources: ClaimSource[];
  decisions: string;
  difficulties: string;
  verification: string;
  result: string;
}

// i18n-ok: 下面三个中文值是协议值（提交后端并参与校验），不是显示文案。
const EMPTY_VALUES: FormValues = {
  title: "",
  category: "项目经历",
  subject: "",
  source_fact: "",
  candidate_wording: "",
  responsibility_level: "参与",
  verification_status: "待确认",
  boundary: "",
  last_verified: "",
  allowed_uses: [],
  risk_notes: [],
  sources: [],
  decisions: "",
  difficulties: "",
  verification: "",
  result: "",
};

/** 多行文本 ↔ 字符串数组。空行丢掉，顺序保留。 */
function linesToText(lines: string[] | undefined): string {
  return (lines ?? []).join("\n");
}

function textToLines(text: string | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function toValues(claim: Claim): FormValues {
  const details = claim.interview_details ?? {};
  return {
    ...EMPTY_VALUES,
    title: claim.title,
    category: claim.category,
    subject: claim.subject,
    source_fact: claim.source_fact,
    candidate_wording: claim.candidate_wording,
    responsibility_level: claim.responsibility_level,
    verification_status: claim.verification_status,
    boundary: claim.boundary,
    last_verified: claim.last_verified,
    allowed_uses: claim.allowed_uses,
    risk_notes: claim.risk_notes,
    sources: claim.sources,
    decisions: linesToText(details.decisions),
    difficulties: linesToText(details.difficulties),
    verification: linesToText(details.verification),
    result: details.result ?? "",
  };
}

function toPayload(values: FormValues): ClaimPayload {
  return {
    ...emptyClaim(),
    title: values.title.trim(),
    category: values.category as ClaimPayload["category"],
    subject: values.subject.trim(),
    source_fact: values.source_fact.trim(),
    candidate_wording: values.candidate_wording.trim(),
    responsibility_level: values.responsibility_level as ClaimPayload["responsibility_level"],
    verification_status: values.verification_status as ClaimPayload["verification_status"],
    boundary: values.boundary.trim(),
    last_verified: values.last_verified.trim(),
    allowed_uses: values.allowed_uses ?? [],
    risk_notes: values.risk_notes ?? [],
    sources: (values.sources ?? []).map((source) => ({
      type: source.type,
      location: (source.location ?? "").trim(),
      public: Boolean(source.public),
      note: (source.note ?? "").trim(),
    })),
    interview_details: {
      decisions: textToLines(values.decisions),
      difficulties: textToLines(values.difficulties),
      verification: textToLines(values.verification),
      result: values.result.trim() || null,
    },
  };
}

interface Props {
  open: boolean;
  claim: Claim | null;
  onClose: () => void;
  onSaved: (claim: Claim) => void;
}

export default function ClaimFormModal({ open, claim, onClose, onSaved }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const editing = claim !== null;
  const [dirty, setDirty] = useState(false);
  const toast = useToast();
  // 草稿只进 sessionStorage，且按"编辑对象"分作用域（12 号与 13 号各一份）。
  const watched = Form.useWatch<FormValues>([], form) as FormValues | undefined;
  const draft = useFormDraft({
    scope: `claims.edit#${claim?.id ?? "new"}`,
    values: (watched ?? EMPTY_VALUES) as unknown as Record<string, unknown>,
    open,
    isEmpty: (values) => !values.title && !values.source_fact,
  });

  // 打开时把表单回填成"正在编辑的那一条"或空白。
  // `dirty` 不在这里重置：它说的是"本次打开期间用户改过没"，收掉的正确时机是关闭
  // （见 `onCancel` 与保存成功两处）。在这里 setState 属于 effect 内同步改状态，
  // 会触发级联渲染（`react-hooks/set-state-in-effect`），而且它本来也不是回填的一部分。
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(claim ? toValues(claim) : EMPTY_VALUES);
  }, [open, claim, form]);

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败时 antd 已在字段旁给出提示
    }
    const payload = toPayload(values);
    try {
      const saved = editing ? await updateClaim(claim.id, payload) : await createClaim(payload);
      // 提交成功才清草稿：清早了等于"保存失败也把内容扔了"。
      draft.clear();
      message.success(editing ? t("claimForm.toast.saved") : t("claimForm.toast.created"));
      onSaved(saved);
      // 保存成功同样是"一次编辑结束"：标记清掉，别把下次打开的弹窗说成有未保存修改。
      setDirty(false);
      onClose();
    } catch (error) {
      // 「已确认却还留着【待补】」这类自相矛盾由后端挡下，原样把中文原因显示出来，
      // 否则用户只会看到一个说得不清不楚的 422。
      message.error(error instanceof Error ? error.message : t("claimForm.toast.saveFailed"));
    }
  };

  return (
    <FormModal
      open={open}
      title={editing ? t("claimForm.title.edit") : t("claimForm.title.create")}
      onCancel={() => {
        // L1：有草稿时关闭无损，只告知一句（短、不打断）。
        if (dirty) toast.info(t("draft.kept"));
        // 闭即清"脏"标记：下次打开是一张干净的弹窗（回填在 effect 里，与它无关）。
        setDirty(false);
        onClose();
      }}
      onSubmit={() => void submit()}
      okText={t("claimForm.action.save")}
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
      width={760}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={EMPTY_VALUES}
        onValuesChange={() => setDirty(true)}
      >
        {/* 这里刻意用普通 div 而不是 antd 的 Space：Space 会给每个子项再包一层
            `.ant-space-item`，flex 宽度落在内层 Form.Item 上、管不到真正的 flex 子项，
            结果就是窄列被挤成一条竖排文字。 */}
        <div className="claim-form-row">
          <Form.Item name="title" label={t("claimForm.field.title")} className="claim-form-grow">
            <Input placeholder={t("claimForm.placeholder.title")} maxLength={200} />
          </Form.Item>
          <Form.Item name="category" label={t("claimForm.field.category")} className="claim-form-fixed">
            <Select options={CLAIM_CATEGORIES.map((value) => ({ value, label: value }))} />
          </Form.Item>
        </div>

        <Form.Item
          name="subject"
          label={t("claimForm.field.subject")}
          extra={t("claimForm.hint.subject")}
        >
          <Input placeholder={t("claimForm.placeholder.subject")} maxLength={200} />
        </Form.Item>

        <Form.Item
          name="source_fact"
          label={t("claimForm.field.sourceFact")}
          extra={t("claimForm.hint.sourceFact")}
          rules={[{ required: true, message: t("claimForm.required.sourceFact") }]}
        >
          {/* showCount 已移除（统一用 MaxLengthHint 模式）：只有顶到 8000 字上限时，
              才在输入框下方出现一行小号红字提醒。 */}
          <HintedTextArea rows={3} maxLength={8000} placeholder={t("claimForm.placeholder.sourceFact")} />
        </Form.Item>

        <Form.Item
          name="candidate_wording"
          label={t("claimForm.field.wording")}
          extra={t("claimForm.hint.wording")}
        >
          <Input.TextArea rows={2} maxLength={8000} placeholder={t("claimForm.placeholder.wording")} />
        </Form.Item>

        <div className="claim-form-row">
          <Form.Item name="responsibility_level" label={t("claimForm.field.responsibility")} className="claim-form-grow">
            <Select options={RESPONSIBILITY_OPTIONS} />
          </Form.Item>
          <Form.Item name="verification_status" label={t("claimForm.field.verification")} className="claim-form-grow">
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
          {/* 日期用固定宽度；DatePicker 值走 Dayjs，表单里仍存 YYYY-MM-DD 字符串（E12）。 */}
          <Form.Item
            name="last_verified"
            label={t("claimForm.field.lastVerified")}
            className="claim-form-date"
            getValueProps={(value: string) => ({ value: value ? dayjs(value) : null })}
            normalize={(value: Dayjs | null) => (value ? value.format("YYYY-MM-DD") : "")}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </div>

        <Form.Item
          name="boundary"
          label={t("claimForm.field.boundary")}
          extra={t("claimForm.hint.boundary")}
        >
          <Input.TextArea
            rows={2}
            maxLength={1000}
            placeholder={t("claimForm.placeholder.boundary")}
          />
        </Form.Item>

        <Form.Item name="allowed_uses" label={t("claimForm.field.allowedUses")}>
          <Select
            mode="tags"
            placeholder={t("claimForm.placeholder.allowedUses")}
            open={false}
            suffixIcon={null}
          />
        </Form.Item>

        <Typography.Text type="secondary" className="claim-form-section">
          {t("claimForm.evidence.title")}
        </Typography.Text>
        <Form.List name="sources">
          {(fields, { add, remove }) => (
            <div className="claim-source-list">
              {fields.map((field) => (
                <Space key={field.key} size={8} align="start" className="claim-source-row">
                  <Form.Item name={[field.name, "type"]} initialValue="link" noStyle>
                    <Select
                      className="claim-source-type"
                      options={SOURCE_TYPES.map((value: SourceType) => ({
                        value,
                        label: SOURCE_TYPE_LABELS[value],
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "location"]} noStyle>
                    <Input
                      className="claim-source-location"
                      placeholder={t("claimForm.placeholder.evidence")}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "public"]}
                    valuePropName="checked"
                    initialValue={false}
                    noStyle
                  >
                    <Switch checkedChildren={t("claimForm.evidence.public")} unCheckedChildren={t("claimForm.evidence.private")} />
                  </Form.Item>
                  <Button
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => remove(field.name)}
                    aria-label={t("claimForm.evidence.removeAria")}
                  />
                </Space>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add({ type: "link", public: false })}
              >
                {t("claimForm.evidence.add")}
              </Button>
            </div>
          )}
        </Form.List>

        <Typography.Text type="secondary" className="claim-form-section">
          {t("claimForm.interview.title")}
        </Typography.Text>
        <div className="claim-form-row">
          <Form.Item
            name="decisions"
            label={t("claimForm.field.decisions")}
            className="claim-form-grow"
            extra={t("claimForm.hint.onePerLine")}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="difficulties" label={t("claimForm.field.difficulties")} className="claim-form-grow" extra={t("claimForm.hint.onePerLine")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </div>
        <div className="claim-form-row">
          <Form.Item
            name="verification"
            label={t("claimForm.field.howVerified")}
            className="claim-form-grow"
            extra={t("claimForm.hint.onePerLine")}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="result" label={t("claimForm.field.result")} className="claim-form-grow">
            <Input.TextArea rows={3} placeholder={t("claimForm.placeholder.result")} />
          </Form.Item>
        </div>

        <Form.Item name="risk_notes" label={t("claimForm.field.riskNotes")} extra={t("claimForm.hint.riskNotes")}>
          <Select
            mode="tags"
            placeholder={t("claimForm.placeholder.riskNotes")}
            open={false}
            suffixIcon={null}
          />
        </Form.Item>
      </Form>
    </FormModal>
  );
}
