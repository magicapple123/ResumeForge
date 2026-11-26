// SPDX-License-Identifier: Apache-2.0
/**
 * 「登录状态」抽屉（Q12 / F07）：来源一行一个，网申浏览器下再按站点逐项展开。
 *
 * 为什么入口在投递台而不是设置页：两处登录态服务的是投递/网申链路，用户是在这里撞到
 * 登录墙的（投递失败）；放设置页要多跳一层。
 *
 * 五条硬约束（都是"体验会被做坏"的地方）：
 * 1. **打开面板只读缓存**，不发任何检测请求——浏览器类检测会真的弹窗并抢焦点；
 * 2. `unknown` 显示成「无法判断」，**绝不写成「已失效」**（误报会逼用户反复重登）；
 * 3. 「全部检测」**串行**：同时拉起两个浏览器会互相抢焦点，也更容易触发站点风控；
 * 4. 重新登录后**自动复检一次**，否则用户登完了面板还显示旧状态；
 * 5. 网申是按 **host 逐站点**检测的（F07）：一个站点掉线不能让整行笼统报"正常"。
 *
 * ## 整改 #16：这页"太乱"的三件事
 *
 * 1. **同一句说两遍**：`localOnlyHint`（"登录状态只保存在本机…"）与顶部蓝色 Alert 的
 *    `keepSessionNotice` 是同一件事。整改后**不再渲染** `localOnlyHint`（键留在语言包里）；
 *    `probeHint` 与 `siteHint` 合成一句 `probeAndSiteHint`（两者都在解释"检测怎么跑"）。
 * 2. **每行 7 个元素**：站点区改成四列表格（见 `LoginStatusSiteTable.tsx`），每行只剩
 *    站点名 + 备注文字按钮 + 状态 + `时间 · 原因` + 「检测」+ `⋯`。
 * 3. **「重新登录」抢注意力**：它只在确认掉线后才该点，收进 `⋯`（与「检测」同一组动作）。
 *
 * 另外 `unknown` 一定要带**原因**：后端在 `detail` 里给一句人话，界面照原样显示；
 * 面板上还有一条固定的 `unknownHint` 说明"为什么可能判不出来 + 能怎么做"。
 */
import { Alert, App, Button, Drawer, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  ackKeepSessionNotice,
  checkLoginStatus,
  checkWebformSite,
  getKeepSessionNotice,
  listLoginStatuses,
  listWebformSites,
  relogin,
  reloginWebformSite,
  type KeepSessionNotice,
  type LoginStatusRow,
  type LoginStatusSite,
  type WebFormSiteList,
} from "../../api/loginStatus";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import AccountNote from "./AccountNote";
import LoginStatusSiteTable, { LoginStatusActions } from "./LoginStatusSiteTable";
import { STATUS_COLOR, isoTimeText, statusLabel } from "./loginStatusLabels";

/** 探测地址为空时按来源给"先去哪儿"的提示（F12）：检测/重登都无从下手，不能只置灰。 */
function noProbeHint(id: string): string {
  if (id === "webform_browser") return t("applyUi.loginStatus.noProbe.webform");
  return t("applyUi.loginStatus.noProbe.apply");
}

const EMPTY_SITES: WebFormSiteList = { items: [], total: 0, truncated: 0 };
/** 没有说明可展示时的取值：`days === 0` 是后端约定的"无可展示"。 */
const EMPTY_NOTICE: KeepSessionNotice = { days: 0, first_effective_at: "", delivered: false };

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
  /**
   * 「保持登录」的一次性说明（T1）：数据 + 「本次打开里是否已被用户关掉」。
   *
   * 两件事放在同一个状态里，是为了让"关掉"这件事**只对本次拉取有效**：每次拉取都会
   * 整对象替换一次（`dismissed: false`），是否"已展示过"永远只认后端的 `delivered`。
   * 若 ack 那次请求失败了（静默处理），下次打开仍会按后端口径再显示一遍。
   */
  const [notice, setNotice] = useState<{ data: KeepSessionNotice; dismissed: boolean }>({
    data: EMPTY_NOTICE,
    dismissed: false,
  });

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

  // 一次性说明：与状态清单分开拉（它失败不该影响面板主体，所以错误也吞掉）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getKeepSessionNotice()
      .then((data) => {
        // 抽屉关得快时不要再往已卸载的组件里写状态。
        if (!cancelled) setNotice({ data, dismissed: false });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * 关掉说明 → 告诉后端"已展示"。
   *
   * ack 失败**不提示**：这是一条次要信息，弹个错误比不显示更糟；没打上标记时
   * 下次打开会照后端 `delivered=false` 再显示一遍，不会丢。
   */
  const dismissNotice = () => {
    setNotice((current) => ({ ...current, dismissed: true }));
    void ackKeepSessionNotice().catch(() => undefined);
  };

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

  /**
   * 备注存好后就地更新显示（不再重取整份清单）。
   *
   * 站点行与来源行都按 host 命中：同一条备注可能同时出现在两处（如投递浏览器入口的 host
   * 恰好也在网申站点清单里），两处一起刷新才不会出现"一行新、一行旧"。
   */
  const applyAccount = (host: string, note: string) => {
    setSites((current) => ({
      ...current,
      items: current.items.map((site) => (site.host === host ? { ...site, account: note } : site)),
    }));
    setRows((current) =>
      current.map((row) => (row.host === host ? { ...row, account: note } : row)),
    );
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
   * 顺序是「投递浏览器 → 各站点 → 网申父行」：浏览器类先跑完，用户能看着它逐个出结果；
   * 有站点清单时**跳过网申父行**（它只汇总，探测交给站点，F07）。
   */
  const checkAll = async () => {
    const hasSites = sites.items.length > 0;
    // 先排投递浏览器，再排各站点，最后才是其它来源：一条平铺的任务队列，
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

  // 三条同时满足才显示：有天数（功能生效过）、后端说还没展示过、本次打开没被关掉。
  const showNotice = notice.data.days > 0 && !notice.data.delivered && !notice.dismissed;
  /** 有站点时，网申父行只汇总（探测交给各站点），不给它一排动作。 */
  const hasSites = sites.items.length > 0;

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
      {/* 一次性说明（T1）：固定在最顶部，与检测结果无关。只在 `days > 0 && !delivered`
          时出现——`days === 0` 表示功能还没真正生效过，那时候没有任何可说的。 */}
      {showNotice ? (
        <Alert
          type="info"
          showIcon
          closable
          style={{ marginBottom: 12 }}
          title={t("applyUi.loginStatus.keepSessionNotice", { days: notice.data.days })}
          onClose={dismissNotice}
        />
      ) : null}
      {/* 说明只留两段（整改 #16）：段落 1 = 两处登录态互相独立；段落 2 = 检测怎么跑。
          原来第三段 `localOnlyHint` 与上面那条蓝色 Alert 说同一件事，已删掉渲染。 */}
      <Typography.Paragraph type="secondary">{t("applyUi.loginStatus.intro")}</Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
        {t("applyUi.loginStatus.probeAndSiteHint")}
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
              {/* 投递浏览器行只知道一个入口 host：拿到了就用同一条备注（原条目 8 A1）。
                  汇总行（网申有站点时）没有自己的 host，这里自然不渲染。 */}
              <AccountNote host={row.host} note={row.account} onSaved={applyAccount} />
              <span style={{ marginLeft: "auto" }} />
              {row.id === "webform_browser" && hasSites ? null : (
                <LoginStatusActions
                  checkLabel={t("applyUi.loginStatus.action.check")}
                  moreLabel={t("applyUi.loginStatus.action.more")}
                  loading={busyKey === row.id}
                  disabled={!row.probe_url}
                  disabledHint={row.probe_url ? undefined : noProbeHint(row.id)}
                  onCheck={() => void runCheck(row.id)}
                  more={[
                    {
                      key: "relogin",
                      label: t("applyUi.loginStatus.action.relogin"),
                      disabled: !row.probe_url,
                      onClick: () => void runRelogin(row),
                    },
                  ]}
                />
              )}
            </div>
            <Typography.Text
              type="secondary"
              style={{ display: "block", marginTop: 6, fontSize: 12 }}
            >
              {row.checked_at
                ? t("applyUi.loginStatus.checkedAt", { time: isoTimeText(row.checked_at) })
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
            {row.id === "webform_browser" && hasSites ? (
              <div style={{ marginTop: 10 }}>
                <LoginStatusSiteTable
                  sites={sites.items}
                  busyKey={busyKey}
                  onCheck={(host) => void runSiteCheck(host)}
                  onRelogin={(site) => void runSiteRelogin(site)}
                  onAccountSaved={applyAccount}
                />
                {sites.truncated > 0 ? (
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", marginTop: 6, fontSize: 12 }}
                  >
                    {t("applyUi.loginStatus.siteTruncated", { count: sites.truncated })}
                  </Typography.Text>
                ) : null}
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
