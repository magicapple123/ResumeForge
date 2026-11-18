// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页的一行（T11 的密钥行 + T12 的系统来源行，**同一份实现**）。
 *
 * ## 为什么只有一份
 *
 * 之前 A/B 组（`ConnectionRow`）与 C 组（`SystemSourcesCard` 的内联 `SystemRow`）是
 * 两份几乎相同的代码：同样的三行结构、同样的就地编辑、同样的保存/取消，只是写的端点
 * 与"清除 vs 恢复默认"不同。差异用 `variant` 表达就够了，两份实现迟早漂成两种行为
 * （一边加了 loading、另一边忘了）。
 *
 * ## 三行结构（`styles/settings-connections.css`）
 *
 * 1. 名称 + **圆点 + 状态文字** + `ⓘ`。状态不再只用颜色：形状（实心/空心）与文字
 *    同时给，色盲用户与英文界面同样读得出来；
 * 2. 值（等宽单行 + ellipsis + `title` 全文）或编辑态输入框 + 操作列。值行与输入框
 *    都是 24px 高，所以进编辑态时操作列位置不动、行高也不跳；
 * 3. 存储形态（小字）。系统来源在值已偏离出厂值时额外补一句「出厂值 …」——
 *    默认值不再永远渲染一份与当前值相同的文本。
 *
 * ## 按钮体系
 *
 * 主按钮**按状态变**：未配置 →「设置」，已保存/仅本次会话 →「更换」，系统来源 →「修改」。
 * 「清除」「恢复默认」收进 `⋯` 菜单（`useRowActionMenu`，与列表行同一套二次确认）。
 * **「清除」不可逆**（旧 Key 不再保留），所以它在菜单里仍然带三段式确认
 * （动作 + 对象 + 后果）；撤销需要把密钥留在内存里，与"清除"的语义相反。
 *
 * ## 两条刷新路径不能统一
 *
 * - `variant="secret"`：三态与掩码都由后端算，改完调 `onChanged()` 重新取整页；
 * - `variant="value"`：端点回的是整页快照，只把**这一行**替换掉（`onApplied`），
 *   不整页重取，免得相邻行闪一下。
 */

import { MoreOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Input } from "antd";
import { useState } from "react";
import { resetSystemSource, saveSystemSource } from "../../api/connections";
import { useRowActionMenu } from "../../components/common/rowActionMenu";
import type { RowActionItem } from "../../components/common/rowActionMenu";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { HintDetail } from "../../components/common/HintDetail";
import type { ConnectionItem, ConnectionsPayload } from "../../types";
import { clearConnectionSecret, writeConnectionSecret } from "./connectionKeyWrite";
import {
  connectionItemHint,
  connectionItemLabel,
  connectionMaskedText,
  connectionProtectionLabel,
  connectionStatusLabel,
} from "./connectionLabels";

/** `secret` = 密钥行（A/B 组）；`value` = 系统来源行（C 组）。 */
export type ConnectionRowVariant = "secret" | "value";

export interface ConnectionListRowProps {
  item: ConnectionItem;
  variant: ConnectionRowVariant;
  /** 密钥行改完的动作：重新取整页（三态与掩码都由后端算，前端不猜）。 */
  onChanged?: () => void | Promise<void>;
  /** 系统来源行改完的动作：只用返回值替换这一行。 */
  onApplied?: (item: ConnectionItem) => void;
}

/** 从整页快照里挑出刚写的那一项（后端返回的是全量，不是单项）。 */
function pickItem(payload: ConnectionsPayload, itemId: string): ConnectionItem | undefined {
  for (const group of payload.groups) {
    const found = group.items.find((row) => row.id === itemId);
    if (found) return found;
  }
  return undefined;
}

/** 主按钮文案：未配置 →「设置」；已配置 →「更换」；系统来源 →「修改」。 */
function primaryLabel(item: ConnectionItem, variant: ConnectionRowVariant): string {
  if (variant === "value") return t("connections.action.primary.modify");
  if (item.status === "not_configured") return t("connections.action.primary.set");
  return t("connections.action.primary.change");
}

/** `ⓘ` 展开的内容：一句"怎么改" + 存储形态 + （系统来源）出厂值。 */
/**
 * 一行连接的全部说明（I-28）：原来是一个 `Popover` + 自绘 `RowDetails`，现在拼成一段
 * 带换行的纯文本交给 `HintDetail`——默认仍是"点开看"，但提示模式下会原地展开。
 * 三段原文一字不改；`pre-line` 让换行符保持换行，视觉上与原来的三行一致。
 */
function rowHintText(item: ConnectionItem, variant: ConnectionRowVariant): string {
  const protection = connectionProtectionLabel(item);
  return [
    connectionItemHint(item),
    `${t("connections.hint.storage", { label: protection })}${
      item.protection_description ? ` · ${item.protection_description}` : ""
    }`,
    variant === "value" ? t("connections.system.factoryValue", { value: item.default_value }) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function ConnectionListRow({ item, variant, onChanged, onApplied }: ConnectionListRowProps) {
  useLocale();
  const toast = useToast();
  const buildMenu = useRowActionMenu();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(variant === "value" ? item.value : "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const label = connectionItemLabel(item);
  const valueText = variant === "value" ? item.value : connectionMaskedText(item);
  const dirtyDraft = draft.trim() !== "";

  /** 后端 400 的说明里就带着"怎么改"（端口区间 / http 前缀 / owner/repo），原样显示。 */
  const fail = (err: unknown): void => {
    setFailure(err instanceof Error ? err.message : t("connections.loadFailed"));
  };

  const startEdit = (): void => {
    setDraft(variant === "value" ? item.value : "");
    setFailure("");
    setEditing(true);
  };

  const cancelEdit = (): void => {
    setEditing(false);
    setDraft(variant === "value" ? item.value : "");
    setFailure("");
  };

  const commitSecret = async (): Promise<void> => {
    await writeConnectionSecret(item, draft);
    setEditing(false);
    setDraft("");
    toast.success(t("connections.toast.saved", { name: label }));
    // 三态/掩码由后端算：重新取一次整页，不在这里猜"现在是不是已保存"。
    await onChanged?.();
  };

  const commitValue = async (): Promise<void> => {
    const payload = await saveSystemSource(item.id, draft.trim());
    const updated = pickItem(payload, item.id);
    if (updated) onApplied?.(updated);
    setEditing(false);
    toast.success(t("connections.toast.saved", { name: label }));
  };

  const commit = async (): Promise<void> => {
    if (busy || !dirtyDraft) return;
    setBusy(true);
    setFailure("");
    try {
      if (variant === "value") await commitValue();
      else await commitSecret();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  /** 真清除（会话密钥走 DELETE），不是往 PUT 里塞空串。 */
  const clear = async (): Promise<void> => {
    setBusy(true);
    setFailure("");
    try {
      await clearConnectionSecret(item);
      toast.success(t("connections.toast.cleared", { name: label }));
      await onChanged?.();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  /** 恢复出厂值：后端删掉覆盖值（`DELETE`），不是写一条"默认值"进去。 */
  const reset = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      const payload = await resetSystemSource(item.id);
      const updated = pickItem(payload, item.id);
      if (updated) onApplied?.(updated);
      toast.success(t("connections.toast.reset", { name: label }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  /** 值被 ellipsis 截断时，唯一能拿到全文的途径就是复制。 */
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(item.value);
      toast.success(t("connections.toast.copied", { name: label }));
    } catch {
      toast.error(t("connections.toast.copyFailed"));
    }
  };

  const moreItems: RowActionItem[] = [];
  if (variant === "value") {
    // 出厂值行没有"恢复默认"可点（它已经是默认值），但 `⋯` 不该因此变成死按钮。
    moreItems.push({
      key: "copy",
      label: t("connections.action.copy"),
      onClick: () => void copy(),
    });
    if (!item.is_default) {
      moreItems.push({
        key: "reset",
        label: t("connections.action.reset"),
        disabled: busy || undefined,
        onClick: () => void reset(),
      });
    }
  } else if (item.editable) {
    moreItems.push({
      key: "clear",
      label: t("connections.action.clear"),
      danger: true,
      disabled: busy || undefined,
      // 清除不可逆：菜单项仍然走三段式确认（动作 + 对象 + 后果）。
      confirm: t("connections.clear.title"),
      confirmBody: t("connections.clear.body"),
      confirmOkText: t("connections.clear.title"),
      confirmCancelText: t("connections.action.cancel"),
      onClick: () => void clear(),
    });
  }
  // `MenuProps["items"]` 是可选的：兜底成空数组，下面的长度判断才不必再收窄一次。
  const menuItems = buildMenu(moreItems) ?? [];

  return (
    <div className="connection-row" data-status={item.status} data-variant={variant}>
      <div className="connection-row__head">
        <span className="connection-row__name">{label}</span>
        <span className="connection-row__status">
          <span className="connection-row__dot" aria-hidden="true" />
          {connectionStatusLabel(item)}
        </span>
        <HintDetail
          className="connection-row__info"
          detail={rowHintText(item, variant)}
          label={t("connections.hint.aria", { name: label })}
        />
      </div>

      <div className="connection-row__main">
        {editing ? (
          <span className="connection-row__editor">
            {variant === "value" ? (
              <Input
                size="small"
                aria-label={label}
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onPressEnter={() => void commit()}
              />
            ) : (
              <Input.Password
                size="small"
                aria-label={t("connections.input.label", { name: label })}
                placeholder={t("connections.input.placeholder")}
                value={draft}
                autoComplete="off"
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onPressEnter={() => void commit()}
              />
            )}
          </span>
        ) : (
          <span className="connection-row__value" title={valueText}>
            {valueText}
          </span>
        )}

        <div className="connection-row__actions">
          {editing ? (
            <>
              <Button
                type="primary"
                size="small"
                loading={busy}
                disabled={!dirtyDraft || undefined}
                // 一页七行同样的按钮：无障碍名必须带上是哪一条（antd 会给两个汉字的
                // 按钮插空格，读屏念成"保 存"，所以显式给 aria-label）。
                aria-label={
                  variant === "value"
                    ? t("connections.action.saveValue", { name: label })
                    : t("connections.action.saveAria", { name: label })
                }
                onClick={() => void commit()}
              >
                {t("connections.action.save")}
              </Button>
              <Button size="small" disabled={busy || undefined} onClick={cancelEdit}>
                {t("connections.action.cancel")}
              </Button>
            </>
          ) : (
            <>
              {item.editable ? (
                <Button
                  size="small"
                  type={item.status === "not_configured" ? "primary" : "default"}
                  disabled={busy || undefined}
                  aria-label={
                    variant === "value"
                      ? t("connections.action.editValue", { name: label })
                      : t("connections.action.editAria", { name: label })
                  }
                  onClick={startEdit}
                >
                  {primaryLabel(item, variant)}
                </Button>
              ) : null}
              {menuItems.length > 0 ? (
                <Dropdown menu={{ items: menuItems }} trigger={["click"]} placement="bottomRight">
                  <Button
                    type="text"
                    size="small"
                    disabled={busy || undefined}
                    aria-label={t("connections.action.more", { name: label })}
                    icon={<MoreOutlined />}
                  />
                </Dropdown>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="connection-row__meta">
        <span title={item.protection_description || undefined}>
          {connectionProtectionLabel(item)}
        </span>
        {variant === "value" && !item.is_default ? (
          <span title={item.default_value}>
            {t("connections.system.factoryValue", { value: item.default_value })}
          </span>
        ) : null}
      </div>

      {failure ? <Alert type="error" showIcon title={failure} /> : null}
    </div>
  );
}

export default ConnectionListRow;
