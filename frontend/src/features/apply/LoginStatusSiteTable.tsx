// SPDX-License-Identifier: Apache-2.0
/**
 * 「登录状态」抽屉里的**网申站点表格**（整改 #16）＋两类行共用的行内动作。
 *
 * ## 为什么要表格化
 *
 * 整改前每个站点行挤了 7 个元素（名、域名、备注输入框、保存、状态、检测、重新登录），
 * 5 个站点 = 10 颗按钮，状态与操作在右侧各漂各的，扫一列找不到同一条竖线。现在：
 *
 * | 列 | 宽度 | 内容 |
 * | --- | --- | --- |
 * | 站点 | 42% | 主行站点名（与域名相同时**只写一次**）+ 次行域名 + 备注文字按钮 |
 * | 状态 | 96 | 状态胶囊（`unknown` 一律「无法判断」，绝不写「已失效」） |
 * | 上次检测 | auto | `时间 · detail`，超长省略 + `title` 全文（不截断字符串） |
 * | 操作 | 100 | 只有「检测」；「重新登录」收进 `⋯` |
 *
 * ## 为什么「重新登录」收进 `⋯`
 *
 * 它只在**确认掉线**之后才该被点。常驻在行里会和「检测」抢同等注意力，而多数时候用户
 * 只想先看一眼状态：点「检测」→ 结果说未登录 → 再决定要不要重登，顺序才符合因果。
 *
 * ## 为什么把动作组件放在这个文件里
 *
 * 站点行（表格）与来源行（抽屉里的卡片行）需要**同一套**「检测 + ⋯」：两处各写一份迟
 * 早会变成两种行为（一处能 loading、一处不能）。它不单独成文件是为了不把
 * `LoginStatusDrawer.tsx` 拆得过碎——抽屉本身已经贴着 500 行预算。
 */
import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { ReactNode } from "react";
import type { RowActionItem } from "../../components/common/RowActions";
import { useRowActionMenu } from "../../components/common/rowActionMenu";
import type { LoginStatusSite } from "../../api/loginStatus";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import AccountNote from "./AccountNote";
import { STATUS_COLOR, isoTimeText, statusLabel } from "./loginStatusLabels";

/** 单元格内的单行省略：全文交给原生 `title`（jsdom 里也能断言）。 */
const ELLIPSIS: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** 次行（域名 / 备注 / 时间 · 原因）的字号。 */
const SUB_STYLE: React.CSSProperties = { fontSize: 12, color: "var(--rf-text-tertiary, #8a94a6)" };

interface ActionsProps {
  /** 主操作（检测）的文案，同时作为无障碍名。 */
  checkLabel: string;
  /** 「⋯」入口的无障碍名。 */
  moreLabel: string;
  /** 这一行正在跑动作（按钮进 loading，避免"点了没反应"）。 */
  loading: boolean;
  /** 没有探测地址：整组置灰（不是只置灰其中一颗）。 */
  disabled: boolean;
  /** 置灰原因：挂在整组的 `title` 上，鼠标停在任意一处都能看到"先去哪儿"。 */
  disabledHint?: string;
  onCheck: () => void;
  /** 收进「⋯」的动作（如「重新登录」）。 */
  more: RowActionItem[];
}

/**
 * 一行里的动作：**只有一颗带文字的按钮（检测）** + 一个无文字的 `⋯`。
 *
 * `⋯` 用 `Dropdown` 而不是常驻按钮：菜单项复用的是全站同一套 `useRowActionMenu`
 * （`RowActionItem` 的 label / disabled / onClick 语义一致），不另写一份菜单逻辑。
 */
export function LoginStatusActions({
  checkLabel,
  moreLabel,
  loading,
  disabled,
  disabledHint,
  onCheck,
  more,
}: ActionsProps) {
  useLocale();
  const buildMenu = useRowActionMenu();
  return (
    <span
      className="login-status-actions"
      style={{ display: "inline-flex", alignItems: "center" }}
      title={disabled ? disabledHint : undefined}
    >
      <Space size={4}>
        <Button
          size="small"
          loading={loading}
          disabled={disabled}
          aria-label={checkLabel}
          onClick={onCheck}
        >
          {checkLabel}
        </Button>
        {more.length > 0 ? (
          <Dropdown
            menu={{ items: buildMenu(more) }}
            trigger={["click"]}
            placement="bottomRight"
            disabled={disabled}
          >
            <Button type="text" size="small" aria-label={moreLabel} icon={<MoreOutlined />} />
          </Dropdown>
        ) : null}
      </Space>
    </span>
  );
}

interface Props {
  sites: LoginStatusSite[];
  /** 正在跑的单个动作：`site:<host>`（与抽屉里其它动作共用一个 busyKey）。 */
  busyKey: string | null;
  onCheck: (host: string) => void;
  onRelogin: (site: LoginStatusSite) => void;
  /** 备注保存成功后的就地刷新（按 host 双处同步由调用方负责）。 */
  onAccountSaved: (host: string, note: string) => void;
}

/** 站点名与域名相同（或名为空）时**只渲染一次**：同一个字符串写两遍是纯噪音。 */
function siteNameCell(site: LoginStatusSite, onAccountSaved: Props["onAccountSaved"]): ReactNode {
  const label = site.label?.trim() ?? "";
  const duplicated = label === "" || label === site.host;
  return (
    <div style={{ minWidth: 0 }}>
      {duplicated ? (
        <div style={ELLIPSIS} title={site.host}>
          {site.host}
        </div>
      ) : (
        <>
          <div style={ELLIPSIS} title={label}>
            {label}
          </div>
          <div style={{ ...ELLIPSIS, ...SUB_STYLE }} title={site.host}>
            {site.host}
          </div>
        </>
      )}
      {/* 备注平时只是一个文字按钮（点击后才出输入框）：常见状态是"没填"，没必要常驻输入框。 */}
      <AccountNote host={site.host} note={site.account} onSaved={onAccountSaved} />
    </div>
  );
}

/** 「上次检测」文案：`时间 · 原因`。没有检测过时只写「还没检测过」。 */
function checkedText(site: LoginStatusSite): string {
  if (!site.checked_at) return t("applyUi.loginStatus.never");
  const time = isoTimeText(site.checked_at);
  return site.detail ? `${time} · ${site.detail}` : time;
}

export default function LoginStatusSiteTable({
  sites,
  busyKey,
  onCheck,
  onRelogin,
  onAccountSaved,
}: Props) {
  useLocale();

  const columns: TableColumnsType<LoginStatusSite> = [
    {
      title: t("applyUi.loginStatus.column.site"),
      key: "site",
      width: "42%",
      render: (_, site) => siteNameCell(site, onAccountSaved),
    },
    {
      title: t("applyUi.loginStatus.column.status"),
      key: "status",
      width: 96,
      render: (_, site) => (
        <Tag color={STATUS_COLOR[site.status]} style={{ marginInlineEnd: 0 }}>
          {statusLabel(site.status)}
        </Tag>
      ),
    },
    {
      title: t("applyUi.loginStatus.column.checked"),
      key: "checked",
      // 自适应：站点名与状态都是定宽，剩下的宽度给这句最长的文字。
      render: (_, site) => {
        const text = checkedText(site);
        return (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <span style={{ ...ELLIPSIS, display: "block" }} title={text}>
              {text}
            </span>
          </Typography.Text>
        );
      },
    },
    {
      title: t("applyUi.loginStatus.column.action"),
      key: "action",
      width: 100,
      align: "right",
      render: (_, site) => (
        <LoginStatusActions
          checkLabel={t("applyUi.loginStatus.site.check")}
          moreLabel={t("applyUi.loginStatus.site.more")}
          loading={busyKey === `site:${site.host}`}
          disabled={!site.probe_url}
          onCheck={() => onCheck(site.host)}
          more={[
            {
              key: "relogin",
              label: t("applyUi.loginStatus.site.relogin"),
              disabled: !site.probe_url,
              onClick: () => onRelogin(site),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <Table<LoginStatusSite>
      rowKey="host"
      size="small"
      columns={columns}
      dataSource={sites}
      pagination={false}
      tableLayout="fixed"
      // 行仍带 `.login-status-site`：既有的单测与样式靠它定位"一个站点一行"。
      rowClassName={() => "login-status-site"}
    />
  );
}
