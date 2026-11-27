// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页的一行（T11 的密钥行 + T12 的系统来源行，**同一份实现**）。
 *
 * ## 为什么只有一份
 *
 * 两组曾有几乎相同的实现（结构、就地编辑、保存/取消都一样，只有端点和清除语义不同），
 * 差异用 `variant` 表达就够了；两份实现迟早漂成两种行为。
 *
 * ## 一行一张卡（#8「卡片行」）
 *
 * 改造前只有三段文字 + 8px 圆点：状态只靠颜色、掩码用正文字体、未配置还写「DPAPI 加密」。
 * 现在：
 *
 * 1. 每行一张卡（`border` + 圆角 10 + `padding:10px 12px`，组内 `gap:8`），**去掉斑马底**
 *    （旧实现只给已保存行上灰底，看起来像"选中行"）；
 * 2. 状态**只由 chip 表达**（R16 删掉了贴左缘的 3px 彩条：它与 chip 说的是同一件事，
 *    同一条信息出现两次反而让人以为"条"和"chip"是两个状态）；
 * 3. 状态 **chip** 带文字：颜色不是唯一信号（色盲与英文界面同样读得出来）；
 * 4. 掩码等宽（`••••`），`connectionMaskedText` 的输出格式不变，只在这一层换字形；
 * 5. 存储形态变 chip，**未配置的行不渲染**；R19 起密钥行连这个 chip 也不渲染
 *    （DPAPI / 仅内存的说明挪进右侧 `ⓘ`，两行布局才够矮）；
 * 6. 未配置行的值位改成一句引导（「点「设置」填入后立即生效」），不再让「未配置」与
 *    「未填写」在同一行里说两遍；
 * 7. 右侧操作区**定宽**（`ⓘ` + 主按钮 + `⋯` 排在 150px 的同一列里，右边缘是一条竖线，
 *    不再随状态换形态排成锯齿）；
 * 8. 「用于」并进第二行（`Key •••• · 用于 …`，R19）；数据来自 `key_map[].used_by`，
 *    由 `ConnectionsCard` 按 id 传入，**不新增接口**。
 *
 * 布局是 `grid`（`minmax(0,1fr) 150px`）：动作列跨全部行、垂直居中，所以值行与输入框
 * 都是 26px 时，进编辑态整行高度不变（验收：行高差 ≤2px）。
 *
 * ## 按钮体系
 *
 * 主按钮**按状态变文案**（未配置 →「设置」；已保存/仅本次会话 →「更换」；系统来源 →
 * 「修改」），但**宽度不再变**：宽度跟着列走，右边缘因此是齐的。
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
import { copyConnectionSecret, resetSystemSource, saveSystemSource } from "../../api/connections";
import { useRowActionMenu } from "../../components/common/rowActionMenu";
import type { RowActionItem } from "../../components/common/rowActionMenu";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { HintDetail } from "../../components/common/HintDetail";
import type { ConnectionItem, ConnectionsPayload } from "../../types";
import { clearConnectionSecret, writeConnectionSecret } from "./connectionKeyWrite";
import { namedFailure } from "./settingsFailure";
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
  /**
   * 「用于」这一行的文案（来自 `key_map[].used_by`，由 `ConnectionsCard` 按 **id** 关联）。
   * 空串 = 不渲染这一行；`ConnectionItem` 自己没有这个字段，也不为此多发一次请求。
   */
  usedBy?: string;
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

/**
 * 掩码的**展示**字形：`****` → `••••`。
 *
 * 只在这一层替换：`connectionMaskedText` 的输出（协议值 / hint）一个字符都不动，
 * 写路径与断言仍然看到原来的星号。视觉上四颗星在正文字体里像乱码，点号在等宽字体里
 * 是一列整齐的方块。
 */
function maskedDisplay(text: string): string {
  return text.replace(/\*+/g, (run) => "•".repeat(run.length));
}

/**
 * 未配置行的值位：一句"接下来该做什么"。
 *
 * 会话 Key（`protection === "memory_only"`）与其它来源的写语义相反（留空=沿用），
 * 所以它拿另一句；判断依据是**协议值**而不是 id，新增一种内存型来源自动跟上。
 */
function emptyValueHint(item: ConnectionItem): string {
  if (item.protection === "memory_only") return t("settingsUi.connections.value.sessionHint");
  return t("settingsUi.connections.value.emptyHint");
}

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

export function ConnectionListRow({
  item,
  variant,
  usedBy,
  onChanged,
  onApplied,
}: ConnectionListRowProps) {
  useLocale();
  const toast = useToast();
  const buildMenu = useRowActionMenu();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(variant === "value" ? item.value : "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const label = connectionItemLabel(item);
  /**
   * R19：这一行用的是「谁家的哪个模型」。两段都取**实际生效的配置**（后端算，前端不猜），
   * 任何一个为空就不显示——宁可少一行字，也不要把注册表里的名字当成"正在用的模型"。
   */
  const identity = [item.provider ?? "", item.model ?? ""]
    .filter((part) => part.trim() !== "")
    .join(" · ");
  const valueText = variant === "value" ? item.value : connectionMaskedText(item);
  const dirtyDraft = draft.trim() !== "";
  /** 掩码之外的值（系统来源）保持原样：等宽字体本来就对，不做字形替换。 */
  const shownValue = variant === "value" ? valueText : maskedDisplay(valueText);
  /** 凭据行没有可展示的值（未配置）时，值位交给引导文案，不再写「未填写」。 */
  const showEmptyGuidance = variant === "secret" && item.status === "not_configured";
  /** 未配置的行不谈存储方式：没配还写「DPAPI 加密」是自相矛盾。 */
  const showProtection =
    variant === "value" ? true : item.status !== "not_configured" && item.key_configured;
  const usedByText = (usedBy ?? "").trim();

  /** 后端 400 的说明里就带着"怎么改"（端口区间 / http 前缀 / owner/repo），原样保留原因。 */
  const fail = (err: unknown): void => {
    // T23：失败必须点名「哪一把 Key」；422 的结构化 loc 再补上「哪个字段」。
    setFailure(namedFailure(label, err, t("connections.loadFailed")));
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

  /**
   * CR-07：复制密钥。值只在后端手里（任何响应都不含明文），所以这里调接口让它写剪贴板，
   * 页面本身不碰密钥字符串。
   */
  const copySecret = async (): Promise<void> => {
    try {
      await copyConnectionSecret(item.id, item.target_id);
      toast.success(t("connections.toast.copied", { name: label }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("connections.toast.copyFailed"));
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
    if (item.key_configured) {
      // 已配置的才有东西可复制；未配置时菜单里不摆一条必然失败的项。
      moreItems.push({
        key: "copy",
        label: t("connections.action.copySecret"),
        disabled: busy || undefined,
        onClick: () => void copySecret(),
      });
    }
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
    <div
      // #9：锚点写在行上（后端 `ConnectionItem.anchor`），`/settings?tab=…#anchor`
      // 才能滚到这一行并高亮；没有锚点的行（C 组系统来源）不写 `id`，避免空 id。
      id={item.anchor || undefined}
      className="connection-row"
      data-status={item.status}
      data-variant={variant}
    >
      <div className="connection-row__head">
        <span className="connection-row__name">{label}</span>
        {/* R19：模型 chip。服务商 · 模型取自实际配置，读不到就整块不渲染。 */}
        {identity !== "" ? (
          <span className="connection-row__model" title={identity}>
            {identity}
          </span>
        ) : null}
        {/* 状态 chip：浅底 + 描边 + 小圆点，**文字必须保留**（色盲与英文界面同样可读）。 */}
        <span className="connection-row__chip" data-status={item.status}>
          <span className="connection-row__chip-dot" aria-hidden="true" />
          {connectionStatusLabel(item)}
        </span>
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
        ) : showEmptyGuidance ? (
          <span className="connection-row__value connection-row__value--empty">
            {emptyValueHint(item)}
          </span>
        ) : (
          <span
            className={`connection-row__value${variant === "secret" ? " connection-row__value--masked" : ""}`}
            title={valueText}
          >
            {shownValue}
          </span>
        )}
        {/* R19 的第二行：`Key •••• · 用于 …`。原来"用于"自己占一行、存储方式再占一行，
            四段堆叠把卡片撑到 ~120px，中间还留一段空白。现在挤成一行，存储方式收进 ⓘ。
            编辑态同样保留这三段（值位换控件、其余位置不动 → 整行不跳，见单测）。 */}
        {variant === "secret" && usedByText !== "" ? (
          <>
            <span className="connection-row__sep" aria-hidden="true">
              ·
            </span>
            <span className="connection-row__used-inline" title={usedByText}>
              {usedByText}
            </span>
          </>
        ) : null}
      </div>

      {showProtection && variant === "value" ? (
        <div className="connection-row__meta">
          <span className="connection-row__tag" title={item.protection_description || undefined}>
            {connectionProtectionLabel(item)}
          </span>
          {variant === "value" && !item.is_default ? (
            <span className="connection-row__tag-note" title={item.default_value}>
              {t("connections.system.factoryValue", { value: item.default_value })}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 「用于」：谁在用这把 Key。数据来自 key_map（按 id 关联），不新增接口。
          R19：密钥行（secret）的这一行已并进上面那行（`Key •••• · 用于 …`），
          只剩系统来源行还需要它独占一行。 */}
      {usedByText !== "" && variant === "value" ? (
        <div className="connection-row__used">
          <span className="connection-row__used-label">{t("settingsUi.connections.usedBy")}</span>
          <span className="connection-row__used-text" title={usedByText}>
            {usedByText}
          </span>
        </div>
      ) : null}

      <div className="connection-row__actions">
        <HintDetail
          className="connection-row__info"
          detail={rowHintText(item, variant)}
          label={t("connections.hint.aria", { name: label })}
        />
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

      {failure ? (
        <Alert className="connection-row__error" type="error" showIcon title={failure} />
      ) : null}
    </div>
  );
}

export default ConnectionListRow;
