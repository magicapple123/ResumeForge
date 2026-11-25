// SPDX-License-Identifier: Apache-2.0
/**
 * 简历收藏星标按钮（CR-33 抽出）。
 *
 * 表格单版本行与「展开后的版本行」必须长得一样、无障碍名一样——两处各写一份迟早会
 * 漂移（其中一处忘了 `disabled` 或忘了禁用态去色）。这里是唯一实现。
 */
import { StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeBrief } from "../../types";

interface Props {
  record: ResumeBrief;
  /** 这一条的收藏请求在飞（按钮转圈）。 */
  loading: boolean;
  /** 有别的收藏请求在飞，或处于批量选择态：本按钮一并禁用。 */
  disabled: boolean;
  onToggle: (record: ResumeBrief) => void;
}

export default function ResumeFavoriteButton({ record, loading, disabled, onToggle }: Props) {
  // 模块级 `t()` 不会跟着语言切换重渲染：这里订阅一次 locale（本仓其它卡片同做法）。
  useLocale();
  const label = record.favorite ? t("resumes.list.favoriteRemove") : t("resumes.list.favoriteAdd");
  return (
    <Tooltip title={record.favorite ? t("resumes.list.unfavorite") : t("resumes.list.favoriteAdd")}>
      <Button
        type="text"
        aria-label={label}
        loading={loading}
        disabled={disabled}
        icon={
          record.favorite ? (
            <StarFilled
              style={{
                // 禁用态不保留强调色：按钮变灰、星还是金黄色，看着仍然像可以点。
                color: disabled ? undefined : "var(--rf-favorite)",
              }}
            />
          ) : (
            <StarOutlined />
          )
        }
        onClick={() => onToggle(record)}
      />
    </Tooltip>
  );
}
