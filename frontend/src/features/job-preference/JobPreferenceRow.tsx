// SPDX-License-Identifier: Apache-2.0
/**
 * 一条求职偏好（T14）：类别 + 值 + 来源/更新时间 + 编辑/撤销/删除。
 *
 * 「撤销到上一版」只在 `has_previous=true` 时出现：没有上一版时显示按钮只会让用户点出
 * 一个 409。删除是软删（进回收站），撤销入口在 Toast 上（见 useJobPreferences）。
 */
import { Button, Space, Tag, Typography } from "antd";
import type { JobPreference } from "../../api/jobPreferences";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  KIND_LABEL_KEYS,
  SOURCE_LABEL_KEYS,
  formatPreferenceValue,
  isSessionOnlyPreference,
} from "./jobPreferenceView";

interface Props {
  pref: JobPreference;
  saving: boolean;
  onEdit: (pref: JobPreference) => void;
  onUndo: (pref: JobPreference) => void;
  onDelete: (pref: JobPreference) => void;
}

export default function JobPreferenceRow({ pref, saving, onEdit, onUndo, onDelete }: Props) {
  useLocale();
  const sourceKey = SOURCE_LABEL_KEYS[pref.source];
  const valueText = formatPreferenceValue(pref.kind, pref.value);
  return (
    <li className="job-preference-row" data-testid={`job-preference-${pref.pref_id}`}>
      <div className="job-preference-row-head">
        <Typography.Text strong>{t(KIND_LABEL_KEYS[pref.kind])}</Typography.Text>
        {isSessionOnlyPreference(pref) ? (
          <Tag color="processing">{t("jobPreference.tag.sessionOnly")}</Tag>
        ) : null}
        {valueText ? <Typography.Text>{valueText}</Typography.Text> : null}
      </div>
      {pref.note ? (
        <Typography.Text type="secondary" className="job-preference-row-note">
          {pref.note}
        </Typography.Text>
      ) : null}
      <div className="job-preference-row-meta">
        <Typography.Text type="secondary">
          {sourceKey ? t(sourceKey) : pref.source} ·{" "}
          {t("jobPreference.updatedAt", { date: formatDateTime(pref.updated_at) })}
        </Typography.Text>
        <Space size={0} wrap>
          <Button
            size="small"
            type="link"
            onClick={() => onEdit(pref)}
            data-testid={`job-preference-edit-${pref.pref_id}`}
          >
            {t("jobPreference.action.edit")}
          </Button>
          {pref.has_previous ? (
            <Button
              size="small"
              type="link"
              disabled={saving}
              onClick={() => onUndo(pref)}
              data-testid={`job-preference-undo-${pref.pref_id}`}
            >
              {t("jobPreference.action.undo")}
            </Button>
          ) : null}
          <Button
            size="small"
            type="link"
            danger
            disabled={saving}
            onClick={() => onDelete(pref)}
            data-testid={`job-preference-delete-${pref.pref_id}`}
          >
            {t("jobPreference.action.delete")}
          </Button>
        </Space>
      </div>
    </li>
  );
}
