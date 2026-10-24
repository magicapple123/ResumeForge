// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲的**最小属性区**（W06 范围：选择状态 + 该对象适用的设置；完整对象属性面板归 W07）。
 *
 * 三类对象各自"适用的设置"不同，这一层替用户做减法：
 * - 条目：可见性（隐藏/显示）+ 内容/排版锁 + 复制；
 * - 要点：只读展示要点文本与所属条目**（要点没有自己的 hidden/lock 字段，锁在条目上）**；
 * - 个人信息：不重复造一套表单，只说明编辑入口在中栏。
 *
 * 锁定/复制的解释走 Tooltip（有键盘等价：触发元素本身可聚焦）；被拒绝时由
 * `useOutlineActions` 统一播报"先解除哪把锁"，不在这里各写一份文案。
 */
import { CopyOutlined, LockOutlined } from "@ant-design/icons";
import { Button, Switch, Tooltip } from "antd";
import { t } from "../../../i18n";
import { canCloneEntry } from "../../../features/resume-outline/commands";
import type { OutlineEntry, OutlinePoint } from "../../../features/resume-outline/model";
import type { OutlineSelection } from "../../../features/resume-outline/types";

export interface OutlineInspectorProps {
  selection: OutlineSelection | null;
  entry: OutlineEntry | null;
  point: OutlinePoint | null;
  /** 要点选择时它的所属条目（用于展示父级锁定状态与名字）。 */
  parentEntry: OutlineEntry | null;
  readOnly: boolean;
  onSetHidden: (entry: OutlineEntry, hidden: boolean) => void;
  onSetLock: (entry: OutlineEntry, lock: "content" | "layout", value: boolean) => void;
  onClone: (entry: OutlineEntry) => void;
}

function entryName(entry: OutlineEntry | null): string {
  return entry && entry.title ? entry.title : t("outline.entry.untitled");
}

function Badges({ entry }: { entry: OutlineEntry }) {
  return (
    <span className="resume-outline-inspector-badges">
      {entry.hidden ? (
        <span className="resume-outline-badge is-hidden">{t("outline.hidden.badge")}</span>
      ) : null}
      {entry.lockContent ? (
        <span className="resume-outline-badge">{t("outline.lock.content.badge")}</span>
      ) : null}
      {entry.lockLayout ? (
        <span className="resume-outline-badge">{t("outline.lock.layout.badge")}</span>
      ) : null}
    </span>
  );
}

export default function OutlineInspector({
  selection,
  entry,
  point,
  parentEntry,
  readOnly,
  onSetHidden,
  onSetLock,
  onClone,
}: OutlineInspectorProps) {
  // 禁用语义只传 true/undefined（显式 false 会短路 ConfigProvider 的 componentDisabled）。
  const disabled = readOnly || undefined;
  return (
    <section className="resume-outline-inspector" aria-label={t("outline.inspector.title")}>
      <div className="resume-outline-inspector-head">{t("outline.inspector.title")}</div>
      {!selection ? (
        <p className="resume-outline-hint">{t("outline.inspector.empty")}</p>
      ) : selection.kind === "personal" ? (
        <>
          <div className="resume-outline-inspector-kind">
            {t("outline.inspector.kind.personal")}
          </div>
          <p className="resume-outline-hint">{t("outline.inspector.personalHint")}</p>
        </>
      ) : point ? (
        <>
          <div className="resume-outline-inspector-kind">{t("outline.inspector.kind.point")}</div>
          <p className="resume-outline-inspector-text">{point.text || t("outline.point.empty")}</p>
          {parentEntry ? (
            <>
              <p className="resume-outline-hint">
                {t("outline.inspector.parentEntry", { name: entryName(parentEntry) })}
              </p>
              <Badges entry={parentEntry} />
            </>
          ) : null}
        </>
      ) : entry ? (
        <>
          <div className="resume-outline-inspector-kind">{t("outline.inspector.kind.entry")}</div>
          <div className="resume-outline-inspector-title">{entryName(entry)}</div>
          <Badges entry={entry} />
          <div
            className="resume-outline-inspector-group"
            role="group"
            aria-label={t("outline.inspector.visibility")}
          >
            <span className="resume-outline-inspector-label">
              {t("outline.inspector.visibility")}
            </span>
            <Tooltip title={t("outline.hidden.hint")}>
              <Switch
                size="small"
                checked={entry.hidden}
                disabled={disabled}
                aria-label={t("outline.inspector.toggleHidden")}
                onChange={(checked) => onSetHidden(entry, checked)}
              />
            </Tooltip>
          </div>
          {entry.hidden ? <p className="resume-outline-hint">{t("outline.hidden.hint")}</p> : null}
          <div
            className="resume-outline-inspector-group"
            role="group"
            aria-label={t("outline.inspector.locks")}
          >
            <span className="resume-outline-inspector-label">{t("outline.inspector.locks")}</span>
            <span className="resume-outline-inspector-lock">
              <LockOutlined aria-hidden="true" />
              <span>{t("outline.inspector.toggleContent")}</span>
              <Tooltip title={t("outline.lock.content.hint")}>
                <Switch
                  size="small"
                  checked={entry.lockContent}
                  disabled={disabled}
                  aria-label={t("outline.inspector.toggleContent")}
                  onChange={(checked) => onSetLock(entry, "content", checked)}
                />
              </Tooltip>
            </span>
            <span className="resume-outline-inspector-lock">
              <LockOutlined aria-hidden="true" />
              <span>{t("outline.inspector.toggleLayout")}</span>
              <Tooltip title={t("outline.lock.layout.hint")}>
                <Switch
                  size="small"
                  checked={entry.lockLayout}
                  disabled={disabled}
                  aria-label={t("outline.inspector.toggleLayout")}
                  onChange={(checked) => onSetLock(entry, "layout", checked)}
                />
              </Tooltip>
            </span>
          </div>
          <div
            className="resume-outline-inspector-group"
            role="group"
            aria-label={t("outline.inspector.actions")}
          >
            <span className="resume-outline-inspector-label">{t("outline.inspector.actions")}</span>
            <Tooltip title={canCloneEntry(entry) ? "" : t("outline.blocked.locked-content")}>
              <Button
                size="small"
                icon={<CopyOutlined />}
                disabled={disabled}
                // 锁正文时不 disabled：点下去由 actions 播报"先解除哪把锁"（Tooltip 已说明原因），
                // 键盘用户也能拿到这条说明，而不是面对一颗不响的灰按钮。
                onClick={() => onClone(entry)}
              >
                {t("outline.action.clone")}
              </Button>
            </Tooltip>
          </div>
        </>
      ) : (
        <p className="resume-outline-hint">{t("outline.inspector.empty")}</p>
      )}
    </section>
  );
}
