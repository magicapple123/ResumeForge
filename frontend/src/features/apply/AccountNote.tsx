// SPDX-License-Identifier: Apache-2.0
/**
 * 账号备注（原条目 8 A1）：站点行 / 投递浏览器行上的「账号备注 · <值>」+ 一支铅笔。
 *
 * 为什么叫「账号备注」而不是「当前账号」：这里存的是**用户自己填的一行文字**，应用并不知道
 * 用户后来有没有换账号。把它显示成「当前账号」等于用一条可能过期的备注冒充实时事实——
 * 站点行上明明写着「正常」，用户会以为自己登的还是备注里那个号。
 *
 * 四条约束：
 * 1. **不记日志**：备注可能含邮箱 / 手机号，前端只在界面上显示它；
 * 2. **上限 64 字符**：输入框先挡（`maxLength`），服务端仍是最终裁判（返回落库后的值）；
 * 3. **空串 = 清除**：留空保存就把那一行删掉，不是存一条空备注；
 * 4. **没有 host 就不渲染**：备注按 host 存，没有键就没有入口（不做"猜一个 host"）。
 */
import { EditOutlined } from "@ant-design/icons";
import { App, Button, Input, Tooltip, Typography } from "antd";
import { useState } from "react";
import { saveAccountNote } from "../../api/loginStatus";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 与服务端 `login_status.MAX_ACCOUNT_NOTE` 一致（输入框先挡，服务端兜底）。 */
export const MAX_ACCOUNT_NOTE = 64;

export default function AccountNote({
  host,
  note,
  onSaved,
}: {
  /** 备注的键（小写 host）。空串表示这一行没有可用的 host。 */
  host: string;
  /** 当前备注；空串 = 未填写。 */
  note: string;
  /** 保存成功后回传**落库后的值**：调用方直接刷新显示，不要自己再截一次。 */
  onSaved: (host: string, note: string) => void;
}) {
  useLocale();
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);

  if (!host) return null;

  const startEdit = () => {
    setDraft(note);
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveAccountNote(host, draft);
      onSaved(saved.host, saved.note);
      setEditing(false);
      message.success(t("applyUi.loginStatus.accountLabel.saved"));
    } catch (error) {
      // 单行失败只报这一行：备注存不上不影响检测结果，不要把整块面板打成错误态。
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span
        className="login-status-account"
        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <Tooltip title={t("applyUi.loginStatus.accountLabel.hint")}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("applyUi.loginStatus.accountLabel")} ·{" "}
            {note || t("applyUi.loginStatus.accountLabel.empty")}
          </Typography.Text>
        </Tooltip>
        <Tooltip title={t("applyUi.loginStatus.accountLabel.edit")}>
          <Button
            type="text"
            size="small"
            aria-label={t("applyUi.loginStatus.accountLabel.edit")}
            icon={<EditOutlined />}
            onClick={startEdit}
          />
        </Tooltip>
      </span>
    );
  }

  return (
    <span
      className="login-status-account-editing"
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <Input
        autoFocus
        size="small"
        value={draft}
        maxLength={MAX_ACCOUNT_NOTE}
        aria-label={t("applyUi.loginStatus.accountLabel")}
        placeholder={t("applyUi.loginStatus.accountLabel.empty")}
        style={{ width: 150 }}
        onChange={(event) => setDraft(event.target.value)}
        onPressEnter={() => void commit()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Esc 在这里是"放弃这一行的编辑"，不该连整个抽屉一起关掉。
          event.stopPropagation();
          setEditing(false);
        }}
      />
      <Button size="small" loading={saving} onClick={() => void commit()}>
        {t("applyUi.loginStatus.accountLabel.save")}
      </Button>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("applyUi.loginStatus.accountLabel.hint")}
      </Typography.Text>
    </span>
  );
}
