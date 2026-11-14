// SPDX-License-Identifier: Apache-2.0
/**
 * 「登录状态」抽屉（Q12 / F07）：来源一行一个，网申浏览器下再按站点逐项展开。
 *
 * 为什么入口在投递台而不是设置页：三处登录态服务的是投递/网申链路，用户是在这里撞到
 * 登录墙的（回读 0 条、投递失败）；放设置页要多跳一层。
 *
 * 五条硬约束（都是"体验会被做坏"的地方）：
 * 1. **打开面板只读缓存**，不发任何检测请求——浏览器类检测会真的弹窗并抢焦点；
 * 2. `unknown` 显示成「无法判断」，**绝不写成「已失效」**（误报会逼用户反复重登）；
 * 3. 「全部检测」**串行**：同时拉起两个浏览器会互相抢焦点，也更容易触发站点风控；
 * 4. 重新登录后**自动复检一次**，否则用户登完了面板还显示旧状态；
 * 5. 网申是按 **host 逐站点**检测的（F07）：一个站点掉线不能让整行笼统报"正常"。
 */
import { App, Button, Drawer, Input, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  checkLoginStatus,
  checkWebformSite,
  listLoginStatuses,
  listWebformSites,
  relogin,
  reloginWebformSite,
  saveTrackCookie,
  type LoginStatusRow,
  type LoginStatusSite,
  type LoginStatusValue,
  type WebFormSiteList,
} from "../../api/loginStatus";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

const STATUS_COLOR: Record<LoginStatusValue, string> = {
  ok: "success",
  expired: "error",
  unknown: "default",
  unchecked: "default",
};

/** 状态 → 文案 key 的映射写死成表：`t()` 的键是字面量联合类型，模板串拼出来的键过不了类型检查。 */
const STATUS_LABEL_KEY = {
  ok: "applyUi.loginStatus.status.ok",
  expired: "applyUi.loginStatus.status.expired",
  unknown: "applyUi.loginStatus.status.unknown",
  unchecked: "applyUi.loginStatus.status.unchecked",
} as const;

function statusLabel(status: LoginStatusValue): string {
  return t(STATUS_LABEL_KEY[status]);
}

/** 探测地址为空时按来源给"先去哪儿"的提示（F12）：检测/重登都无从下手，不能只置灰。 */
function noProbeHint(id: string): string {
  if (id === "webform_browser") return t("applyUi.loginStatus.noProbe.webform");
  if (id === "track_cookie") return t("applyUi.loginStatus.noProbe.track");
  return t("applyUi.loginStatus.noProbe.apply");
}

const EMPTY_SITES: WebFormSiteList = { items: [], total: 0, truncated: 0 };

export default function LoginStatusDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useLocale();
  const { message } = App.useApp();
  const [rows, setRows] = useState<LoginStatusRow[]>([]);
  const [sites, setSites] = useState<WebFormSiteList>(EMPTY_SITES);
  const [loading, setLoading] = useState(false);
  /** 正在跑的单个动作：`<source>` 或 `site:<host>`。 */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cookie, setCookie] = useState("");
  const [cookieOpen, setCookieOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 两个都是只读缓存：打开面板绝不能顺手发 check（浏览器类检测会弹窗）。
      const [statuses, webformSites] = await Promise.all([listLoginStatuses(), listWebformSites()]);
      setRows(statuses);
      setSites(webformSites);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const replaceRow = (next: LoginStatusRow) => {
    setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
  };

  const replaceSite = (next: LoginStatusSite) => {
    setSites((current) => ({
      ...current,
      items: current.items.map((site) => (site.host === next.host ? next : site)),
    }));
    // 父行的汇总/状态由后端算：站点变了就重取一次来源列表，避免两处各算一份。
    void listLoginStatuses()
      .then(setRows)
      .catch(() => undefined);
  };

  const runCheck = async (id: string) => {
    setBusyKey(id);
    try {
      replaceRow(await checkLoginStatus(id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  };

  const runSiteCheck = async (host: string) => {
    setBusyKey(`site:${host}`);
    try {
      replaceSite(await checkWebformSite(host));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  };

  const runRelogin = async (row: LoginStatusRow) => {
    if (row.id === "track_cookie") {
      setCookieOpen(true);
      return;
    }
    setBusyKey(row.id);
    try {
      const result = await relogin(row.id);
      if (result.action === "opened") {
        message.info(t("applyUi.loginStatus.opened"));
        // 用户关掉登录窗口后由他自己再点一次检测；这里不假装成功。
        await load();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  };

  const runSiteRelogin = async (site: LoginStatusSite) => {
    setBusyKey(`site:${site.host}`);
    try {
      const result = await reloginWebformSite(site.host);
      if (result.action === "opened") {
        message.info(t("applyUi.loginStatus.opened"));
        await load();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * 全部检测：**串行**跑（不是 Promise.all）。
   *
   * 顺序是「投递浏览器 → 各站点 → 门户 Cookie」：浏览器类先跑完，用户能看着它逐个出结果；
   * 有站点清单时**跳过网申父行**（它只汇总，探测交给站点，F07）。
   */
  const checkAll = async () => {
    const hasSites = sites.items.length > 0;
    // 先排投递浏览器，再排各站点，最后才是 Cookie 与其它来源：一条平铺的任务队列，
    // 顺序就是用户看到的执行顺序。
    const sources = rows.filter((row) => row.id !== "webform_browser" || !hasSites);
    const ordered: Array<
      { kind: "source"; row: LoginStatusRow } | { kind: "site"; site: LoginStatusSite }
    > = [
      ...sources
        .filter((row) => row.id === "apply_browser")
        .map((row) => ({ kind: "source" as const, row })),
      ...sites.items.map((site) => ({ kind: "site" as const, site })),
      ...sources
        .filter((row) => row.id !== "apply_browser")
        .map((row) => ({ kind: "source" as const, row })),
    ];
    setCheckingAll(true);
    setProgress({ done: 0, total: ordered.length });
    try {
      for (const [index, task] of ordered.entries()) {
        // 每跑完一条就报进度（`正在检测 3/8`）。
        setProgress({ done: index + 1, total: ordered.length });
        try {
          if (task.kind === "site") {
            replaceSite(await checkWebformSite(task.site.host));
          } else {
            replaceRow(await checkLoginStatus(task.row.id));
          }
        } catch (error) {
          // 单行失败只报这一行，不中断整轮（F07）。
          message.error(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      setCheckingAll(false);
      setProgress(null);
    }
  };

  const submitCookie = async () => {
    setBusyKey("track_cookie");
    try {
      replaceRow(await saveTrackCookie(cookie));
      message.success(t("applyUi.loginStatus.cookieSaved"));
      setCookieOpen(false);
      setCookie("");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  };

  const renderSite = (site: LoginStatusSite) => (
    <div key={site.host} className="login-status-site">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Typography.Text>{site.label}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {site.host}
        </Typography.Text>
        <Tag color={STATUS_COLOR[site.status]}>{statusLabel(site.status)}</Tag>
        <span style={{ marginLeft: "auto" }} />
        <Button
          size="small"
          loading={busyKey === `site:${site.host}`}
          disabled={!site.probe_url}
          onClick={() => void runSiteCheck(site.host)}
        >
          {t("applyUi.loginStatus.site.check")}
        </Button>
        <Button size="small" disabled={!site.probe_url} onClick={() => void runSiteRelogin(site)}>
          {t("applyUi.loginStatus.site.relogin")}
        </Button>
      </div>
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 4, fontSize: 12 }}>
        {site.checked_at
          ? t("applyUi.loginStatus.checkedAt", { time: site.checked_at.replace("T", " ") })
          : t("applyUi.loginStatus.never")}
        {site.detail ? ` · ${site.detail}` : ""}
      </Typography.Text>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="large"
      title={t("applyUi.loginStatus.title")}
      extra={
        <Button loading={checkingAll} onClick={() => void checkAll()}>
          {progress
            ? t("applyUi.loginStatus.progress", { done: progress.done, total: progress.total })
            : t("applyUi.loginStatus.action.checkAll")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">{t("applyUi.loginStatus.intro")}</Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t("applyUi.loginStatus.probeHint")}
      </Typography.Paragraph>

      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {(loading && rows.length === 0 ? [] : rows).map((row) => (
          <div
            key={row.id}
            style={{
              border: "1px solid var(--rf-border)",
              borderRadius: 8,
              padding: "12px 14px",
              background: "var(--rf-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Typography.Text strong>{row.label}</Typography.Text>
              <Tag color={STATUS_COLOR[row.status]}>{statusLabel(row.status)}</Tag>
              <span style={{ marginLeft: "auto" }} />
              {row.id === "webform_browser" && sites.items.length > 0 ? null : (
                <>
                  <Button
                    size="small"
                    loading={busyKey === row.id}
                    disabled={!row.probe_url}
                    title={row.probe_url ? undefined : noProbeHint(row.id)}
                    onClick={() => void runCheck(row.id)}
                  >
                    {t("applyUi.loginStatus.action.check")}
                  </Button>
                  <Button
                    size="small"
                    disabled={!row.probe_url}
                    title={row.probe_url ? undefined : noProbeHint(row.id)}
                    onClick={() => void runRelogin(row)}
                  >
                    {t("applyUi.loginStatus.action.relogin")}
                  </Button>
                </>
              )}
            </div>
            <Typography.Text
              type="secondary"
              style={{ display: "block", marginTop: 6, fontSize: 12 }}
            >
              {row.checked_at
                ? t("applyUi.loginStatus.checkedAt", { time: row.checked_at.replace("T", " ") })
                : t("applyUi.loginStatus.never")}
              {row.detail ? ` · ${row.detail}` : ""}
            </Typography.Text>
            {row.status === "unknown" ? (
              <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                {t("applyUi.loginStatus.unknownHint")}
              </Typography.Text>
            ) : null}
            {row.probe_url ? null : (
              <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                {noProbeHint(row.id)}
              </Typography.Text>
            )}
            {row.id === "webform_browser" && sites.items.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                  {t("applyUi.loginStatus.siteHint")}
                </Typography.Text>
                <Space orientation="vertical" size={8} style={{ width: "100%", marginTop: 6 }}>
                  {sites.items.map(renderSite)}
                </Space>
                {sites.truncated > 0 ? (
                  <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                    {t("applyUi.loginStatus.siteTruncated", { count: sites.truncated })}
                  </Typography.Text>
                ) : null}
              </div>
            ) : null}
            {row.id === "track_cookie" && cookieOpen ? (
              <div style={{ marginTop: 10 }}>
                <Input.TextArea
                  value={cookie}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  placeholder={t("applyUi.loginStatus.cookiePlaceholder")}
                  onChange={(event) => setCookie(event.target.value)}
                />
                <Button
                  type="primary"
                  size="small"
                  style={{ marginTop: 8 }}
                  loading={busyKey === "track_cookie"}
                  onClick={() => void submitCookie()}
                >
                  {t("applyUi.loginStatus.cookieSave")}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        {t("applyUi.loginStatus.checkAllHint")}
      </Typography.Paragraph>
    </Drawer>
  );
}
