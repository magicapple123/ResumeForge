// SPDX-License-Identifier: Apache-2.0
/**
 * 新增 / 编辑一条求职偏好（T14）。
 *
 * 表单按 kind 的 value_kind 换控件：list 用多值输入，结构化 scalar（薪资/篇幅）拆成
 * 子输入框再拼回对象，枚举型 scalar 的选项**只用本地语言包**（后端 label 是中文，
 * 不能拿来做英文界面）。提交按钮在内容未填时禁用，但后端仍会做完整校验（422 兜底）。
 *
 * 这是一个**有提交动作的弹层**：按弹层规范禁掉蒙层关闭（`mask={{ closable: false }}`），
 * 取消仍走 footer 的取消按钮与 ×（关闭无损，草稿不保留）。
 */
import { Input, InputNumber, Modal, Select, Space, Typography } from "antd";
import { useState } from "react";
import type {
  JobPreference,
  JobPreferenceCatalogItem,
  JobPreferenceKind,
} from "../../api/jobPreferences";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  KIND_LABEL_KEYS,
  buildPreferenceValue,
  emptyFormState,
  enumOptionsFor,
  formStateForPreference,
  isFormComplete,
  type JobPreferenceFormState,
} from "./jobPreferenceView";

const LIST_KINDS: ReadonlySet<JobPreferenceKind> = new Set([
  "target_role_family",
  "target_city",
  "exclude_company",
  "exclude_industry",
  "redline_banned_word",
]);

/**
 * 列表型偏好的输入分隔符：全角逗号与顿号是**解析用协议字符**（用户按中文习惯输入时用来
 * 拆分条目），不会作为文案展示给用户——所以不进语言包。
 */
// i18n-ok: 输入分隔符（全角逗号/顿号）是解析用协议字符，不展示给用户
const LIST_TOKEN_SEPARATORS = [",", "，", "、"];

const ENUM_KINDS: ReadonlySet<JobPreferenceKind> = new Set([
  "work_mode",
  "overtime",
  "redline_tone",
]);

interface Props {
  /** null = 新增；非 null = 编辑这一条（kind 锁定）。 */
  initial: JobPreference | null;
  catalog: JobPreferenceCatalogItem[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (kind: JobPreferenceKind, value: unknown, note: string) => Promise<void>;
}

function kindOptionList(catalog: JobPreferenceCatalogItem[]) {
  if (catalog.length > 0) {
    return catalog.map((item) => ({ value: item.kind, label: t(KIND_LABEL_KEYS[item.kind]) }));
  }
  // 目录还没加载出来时的兜底：至少能选 13 类（展示名仍在语言包）。
  return (Object.keys(KIND_LABEL_KEYS) as JobPreferenceKind[]).map((kind) => ({
    value: kind,
    label: t(KIND_LABEL_KEYS[kind]),
  }));
}

export default function JobPreferenceFormModal({
  initial,
  catalog,
  saving,
  onCancel,
  onSubmit,
}: Props) {
  useLocale();
  const editing = initial !== null;
  const [form, setForm] = useState<JobPreferenceFormState>(() =>
    initial ? formStateForPreference(initial) : emptyFormState(catalog[0]?.kind ?? "target_city"),
  );
  const complete = isFormComplete(form);
  const catalogItem = catalog.find((item) => item.kind === form.kind);

  /** 只更新一个字段：避免每处都手写 `setForm((prev) => ({ ...prev, ... }))`。 */
  const update = <K extends keyof JobPreferenceFormState>(
    key: K,
    value: JobPreferenceFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const changeKind = (kind: JobPreferenceKind) => {
    if (editing) return;
    setForm(emptyFormState(kind));
  };

  const submit = async () => {
    if (!complete || saving) return;
    await onSubmit(form.kind, buildPreferenceValue(form), form.note.trim());
  };

  return (
    <Modal
      open
      title={editing ? t("jobPreference.form.titleEdit") : t("jobPreference.form.titleCreate")}
      okText={t("jobPreference.form.save")}
      cancelText={t("common.action.cancel")}
      confirmLoading={saving}
      okButtonProps={{ disabled: !complete }}
      onOk={() => void submit()}
      onCancel={onCancel}
      mask={{ closable: false }}
    >
      <div className="job-preference-form">
        <div className="job-preference-field">
          <Typography.Text strong>{t("jobPreference.form.kind")}</Typography.Text>
          <Select
            value={form.kind}
            disabled={editing}
            options={kindOptionList(catalog)}
            onChange={(value) => changeKind(value as JobPreferenceKind)}
            aria-label={t("jobPreference.form.kind")}
          />
          {editing ? (
            <Typography.Text type="secondary">{t("jobPreference.form.kindLocked")}</Typography.Text>
          ) : null}
        </div>

        {LIST_KINDS.has(form.kind) ? (
          <div className="job-preference-field">
            <Typography.Text strong>{t("jobPreference.form.value")}</Typography.Text>
            <Select
              mode="tags"
              value={form.listValues}
              onChange={(values: string[]) => update("listValues", values)}
              placeholder={t("jobPreference.form.listPlaceholder")}
              tokenSeparators={LIST_TOKEN_SEPARATORS}
              aria-label={t("jobPreference.form.value")}
            />
          </div>
        ) : form.kind === "salary_floor" ? (
          <div className="job-preference-field">
            <Typography.Text strong>{t("jobPreference.form.value")}</Typography.Text>
            <Space wrap>
              <InputNumber
                min={1}
                step={1000}
                value={form.amount}
                onChange={(value) => update("amount", typeof value === "number" ? value : null)}
                placeholder={t("jobPreference.form.salaryAmount")}
                aria-label={t("jobPreference.form.salaryAmount")}
              />
              <Select
                value={form.salaryUnit}
                onChange={(value) => update("salaryUnit", value as "month" | "year")}
                options={[
                  { value: "month", label: t("jobPreference.form.salaryUnit.month") },
                  { value: "year", label: t("jobPreference.form.salaryUnit.year") },
                ]}
                aria-label={t("jobPreference.form.salaryUnit")}
                style={{ width: 110 }}
              />
            </Space>
          </div>
        ) : form.kind === "redline_length" ? (
          <div className="job-preference-field">
            <Typography.Text strong>{t("jobPreference.form.maxPages")}</Typography.Text>
            <InputNumber
              min={1}
              max={10}
              value={form.maxPages}
              onChange={(value) => update("maxPages", typeof value === "number" ? value : null)}
              aria-label={t("jobPreference.form.maxPages")}
            />
          </div>
        ) : ENUM_KINDS.has(form.kind) ? (
          <div className="job-preference-field">
            <Typography.Text strong>{t("jobPreference.form.value")}</Typography.Text>
            <Select
              value={form.enumValue || undefined}
              options={enumOptionsFor(form.kind, catalogItem?.options ?? [])}
              onChange={(value) => update("enumValue", String(value))}
              placeholder={t("jobPreference.form.enumPlaceholder")}
              aria-label={t("jobPreference.form.value")}
            />
          </div>
        ) : form.kind === "available_from" ? (
          <div className="job-preference-field">
            <Typography.Text strong>{t("jobPreference.form.value")}</Typography.Text>
            <Input
              value={form.dateText}
              onChange={(event) => update("dateText", event.target.value)}
              placeholder={t("jobPreference.form.datePlaceholder")}
              aria-label={t("jobPreference.form.value")}
            />
          </div>
        ) : (
          <div className="job-preference-field">
            <Typography.Text strong>{t("jobPreference.form.value")}</Typography.Text>
            <Input.TextArea
              rows={3}
              value={form.text}
              onChange={(event) => update("text", event.target.value)}
              placeholder={t("jobPreference.form.sessionNotePlaceholder")}
              aria-label={t("jobPreference.form.value")}
            />
          </div>
        )}

        <div className="job-preference-field">
          <Typography.Text strong>{t("jobPreference.form.note")}</Typography.Text>
          <Input
            value={form.note}
            onChange={(event) => update("note", event.target.value)}
            placeholder={t("jobPreference.form.notePlaceholder")}
            aria-label={t("jobPreference.form.note")}
          />
        </div>
        {!complete ? (
          <Typography.Text type="danger">{t("jobPreference.form.needValue")}</Typography.Text>
        ) : null}
      </div>
    </Modal>
  );
}
