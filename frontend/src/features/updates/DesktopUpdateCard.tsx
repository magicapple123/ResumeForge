// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面形态的「软件更新」卡片：**只复述壳层的结论**，不自己去问 GitHub。
 *
 * 后台检查、下载、校验、静默安装全在 `desktop/updater.js` 里，结论通过
 * `desktop:get-update-state` / `desktop:update-state` 送到页面（`useDesktopUpdateState`）。
 * 所以这张卡显示的就是「应用真的会不会升级」所依据的那一份——与启动弹窗同源。
 *
 * 这也是 B1 的落点：页内后端那条「检查更新」在 403 时会降级成"没有版本号"，界面原本
 * 把它渲染成「未提供」，而壳层同一时刻可能已经查到 2.3.0 并弹窗。这里一律以壳层为准，
 * 且壳层自己失败时说的是「本次未能确认」而不是「未提供」。
 */
import { CloudDownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { APP_VERSION } from "../../config";
import UpdateReleaseNotes from "../settings/UpdateReleaseNotes";
import { type InAppUpdateBridge, useDesktopUpdateState } from "./desktopUpdateBridge";

export default function DesktopUpdateCard({ bridge }: { bridge: InAppUpdateBridge }) {
  // 只为了让卡片自己的文案跟着切语言重译（说明块内部自己也订阅）。
  useLocale();
  const state = useDesktopUpdateState(bridge);
  const [error, setError] = useState(false);
  const latest = state?.latest ?? "";
  const notes = state?.notes ?? "";
  const active = state && ["downloading", "verifying", "installing"].includes(state.phase);
  // 壳层这次检查失败（限流 / 被拦 / 连不上）：它和"壳层还没查过"是两种处境，
  // 界面必须分开说。此前两者都落到「未提供」，而桌面壳的弹窗可能刚刚宣告
  // 「发现新版本 2.3.0」——同一件事在同一个应用里给出两个相反的结论。
  const failed = state?.phase === "failed" && !latest;
  // 还没查过 / 正在查（无结论可显示）时是「去检查」，查过了但壳层没给值时才轮到
  // 「未提供」——那一档是真的"上游没提供"，不是"我们没问到"。
  const pending = !state || state.phase === "idle" || state.phase === "checking";
  // 版本号 / 发布时间两列的占位在"没查过""查失败""上游没给"之间分叉，只在这里决定。
  const placeholder = failed
    ? t("update.value.unconfirmed")
    : pending
      ? t("update.value.checkFirst")
      : t("update.value.noDate");
  // 壳层的终态：有新版本 / 已是最新。两者都不该再让用户去猜结论。
  const available = state?.phase === "available" && Boolean(latest);
  const open = async () => {
    setError(false);
    try {
      if (!(await bridge.checkUpdate()).ok) setError(true);
    } catch {
      setError(true);
    }
  };
  return (
    <Card title={t("update.card.title")}>
      <Space orientation="vertical" size={12}>
        <Typography.Text>{t("update.inApp.restartHint")}</Typography.Text>
        {/* 下载/校验/安装中时同一个按钮变成「查看更新进度」：进度在启动弹窗里，
            这里不重复画一条进度条，也不自己再发一次检查（`open` 会打开壳层流程）。 */}
        <Button
          icon={<CloudDownloadOutlined />}
          aria-label={t(active ? "update.inApp.viewProgress" : "update.action.check")}
          onClick={() => void open()}
        >
          {t(active ? "update.inApp.viewProgress" : "update.action.check")}
        </Button>
        {error && <Alert type="error" showIcon title={t("update.error.check")} />}
      </Space>
      <div className="update-meta">
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.current")}</span>
          <strong>{state?.current || APP_VERSION}</strong>
        </div>
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.latest")}</span>
          {/* 壳层有结论时原样显示（它就是应用内更新所依据的那一份，与弹窗同源）。 */}
          <strong>{latest || placeholder}</strong>
        </div>
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.published")}</span>
          <strong>{state?.published?.slice(0, 10) || placeholder}</strong>
        </div>
      </div>
      {available && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          title={t("update.result.available", { version: latest })}
        />
      )}
      {state?.phase === "current" && (
        <Alert style={{ marginTop: 16 }} type="info" showIcon title={t("update.result.uptodate")} />
      )}
      {/* 发布说明也取壳层那一份（`notes` 是完整原文，语言段由 selectReleaseNotes 挑），
          这样卡片、启动弹窗、设置页讲的永远是同一条公告。 */}
      {available && notes ? <UpdateReleaseNotes notes={notes} /> : null}
      {failed && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          title={t("update.desktop.checkFailed")}
        />
      )}
    </Card>
  );
}
