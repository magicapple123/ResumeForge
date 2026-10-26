// SPDX-License-Identifier: Apache-2.0
/**
 * 草稿恢复条：表单弹窗 body 顶部的一条提示，**永不自动应用草稿**。
 *
 * 自动填充会把"上次没填完的内容"变成"这次打开就是它"，用户会以为自己新建的表单里
 * 已经填过东西——所以恢复必须是一次明确的点击。
 *
 * ## 「查看差异」这一支（2026-10-23 用户要求）
 *
 * 光说"有一条 15:42 的草稿"不足以让人做决定：用户真正想知道的是"恢复会把现在的内容
 * 改成什么"。所以给一个可展开的差异清单（`changes` 由宿主算好，本组件只负责渲染与
 * 展开/收起）：每行一个变化分组，`当前 → 上次未提交` 并列，恢复之前一眼能看出代价。
 *
 * **入口只看"有没有草稿"，不看"差异有几条"**（2026-10-24 修正）。以前 `changes` 为空
 * 就不渲染按钮，于是出现一种说不通的状态：界面明明说"有草稿"，却找不到「查看差异」——
 * 要么草稿与当前内容一致，要么差异字段不在 diff 的覆盖范围内（例如只有照片变了）。
 * 现在只要宿主传了 `changes`（非 null = 有草稿）就渲染入口，展开后没有差异行时给一句
 * 「草稿与当前内容一致」——那本身就是用户要的答案。
 */
import { Button, Space, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { DraftDiffEntry } from "../../utils/draftDiff";

export interface FormDraftBarState {
  /** 草稿保存时间（ms），用于渲染「保存于 HH:mm」。 */
  savedAt: number;
  /** 草稿里有没有被剔除的字段（图片等），需要在文案里说明。 */
  droppedFields?: number;
  /** 草稿里的字段数；拿不到时正文退化成只讲时刻的简版。 */
  fieldCount?: number;
}

export interface DraftRestoreBarProps extends FormDraftBarState {
  onRestore: () => void;
  onDiscard: () => void;
  /**
   * 草稿与当前内容的差异。
   *
   * `null` / 不传 = **没有草稿**（或宿主还没算出差异）：不渲染「查看差异」入口。
   * 空数组 = **有草稿但内容一致**：入口照旧渲染，展开后给一行「草稿与当前内容一致」。
   */
  changes?: DraftDiffEntry[] | null;
}

/** `HH:mm`（本地时区）。草稿只在同一标签页内有效，不需要日期。 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export default function DraftRestoreBar({
  savedAt,
  droppedFields = 0,
  fieldCount,
  onRestore,
  onDiscard,
  changes,
}: DraftRestoreBarProps) {
  useLocale();
  const [showDiff, setShowDiff] = useState(false);
  const time = formatTime(savedAt);
  // 有草稿就有入口：`[]` 是"草稿与现在一样"，那也值得点开确认一次（见文件头）。
  const hasDraft = changes != null;
  return (
    <div className="rf-draft-bar" role="status">
      <div className="rf-draft-bar-text">
        <Typography.Text strong>{t("draft.restore.title")}</Typography.Text>
        <Typography.Text type="secondary" className="rf-draft-bar-meta">
          {fieldCount === undefined
            ? t("draft.restore.body-plain", { time })
            : t("draft.restore.body", { time, count: fieldCount })}
          {droppedFields > 0 ? ` · ${t("draft.dropped-fields", { count: droppedFields })}` : ""}
        </Typography.Text>
      </div>
      <Space size={8}>
        {hasDraft ? (
          <Button size="small" type="text" onClick={() => setShowDiff((value) => !value)}>
            {showDiff ? t("draft.diff.hide") : t("draft.diff.show")}
          </Button>
        ) : null}
        <Button size="small" onClick={onDiscard}>
          {t("draft.discard.action")}
        </Button>
        <Button size="small" type="primary" onClick={onRestore}>
          {t("draft.restore.action")}
        </Button>
      </Space>
      {showDiff && changes ? (
        changes.length === 0 ? (
          // 有草稿但一行差异都没有：说清"恢复不会改任何东西"，而不是给一张空表。
          <p className="rf-draft-bar-diff-empty">{t("draft.diff.same")}</p>
        ) : (
          <ul className="rf-draft-bar-diff">
            {changes.map((change) => (
              <li key={change.label}>
                <span className="rf-draft-bar-diff-label">{change.label}</span>
                <span className="rf-draft-bar-diff-pair">
                  <span className="rf-draft-bar-diff-side">{t("draft.diff.before")}</span>
                  <span className="rf-draft-bar-diff-value">{change.before}</span>
                  <span className="rf-draft-bar-diff-arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="rf-draft-bar-diff-side">{t("draft.diff.after")}</span>
                  <span className="rf-draft-bar-diff-value">{change.after}</span>
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
