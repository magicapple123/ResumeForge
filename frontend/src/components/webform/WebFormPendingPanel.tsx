// SPDX-License-Identifier: Apache-2.0
/**
 * 「页面要求但这一轮不会自动填」的清单。
 *
 * 三块**必须分开显示**，因为用户该做的事完全不同：
 * - 资料里没有 → 去「我的资料」补上，下次就读得到了；
 * - 永不自动填 → 验证码、附件、他人信息、同意条款，只能自己动手（这不是缺陷，是刻意的）；
 * - 没认出来 → 这一步帮不上，**默认收起**。
 *
 * 「没认出来」单独收起是有实测依据的：腾讯校招简历页 69 个控件里有 36 个落在这一类，
 * 而其中一半以上是「可添加多条」的区块（实习经历 / 项目经历 / 获奖信息）里的字段——
 * 那类区块本版不处理。一股脑铺开会让用户以为这个功能什么都没干成，其实能填的都已经
 * 列在上面了。
 */
import { Alert, Card, Collapse, Listy, Space, Tag, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import { Link } from "react-router-dom";
import { ListyItem } from "../common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../common/listyPadding";
import type { WebFormPendingItem } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  missingData: WebFormPendingItem[];
  unrecognized: WebFormPendingItem[];
  blocked: WebFormPendingItem[];
}

function Lines({ items }: { items: WebFormPendingItem[] }) {
  return (
    <Listy
      items={items}
      rowKey={(item) => item.index}
      styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
      itemRender={(item) => (
        <ListyItem>
          <Space size={8} wrap>
            <Typography.Text>
              {item.label || t("webFormPage.pending.controlFallback", { index: item.index + 1 })}
            </Typography.Text>
            {item.required ? <Tag color="red">{t("common.required")}</Tag> : null}
            {item.field_label ? (
              <Typography.Text type="secondary">{item.field_label}</Typography.Text>
            ) : null}
          </Space>
        </ListyItem>
      )}
    />
  );
}

/**
 * 「换个资料…」的出口提示。批量预览面板没有逐框写值的入口（那在浏览器里的
 * 智能逐项填表面板上），所以这里不复刻一套选择器，只把路指清楚：
 * 智能逐项填表对**任何**状态（包括「不会自动填」）都留有「换个资料…」，
 * 展开就是完整资料清单，没有匹配项也能自己挑。
 *
 * 「换个资料…」原本是句中的加粗片段，改为整句一条 key（与 browserStatus 的既有做法
 * 一致）：拆成 before/strong/after 会把英文语序拆碎，而 i18n 没有富文本插值。
 */
function LiveExitHint() {
  return <Typography.Text type="secondary">{t("webFormPage.pending.exitHint")}</Typography.Text>;
}

export default function WebFormPendingPanel({ missingData, unrecognized, blocked }: Props) {
  // 本组件用模块级 t()：调用方用 memo 包着它，语言变化不来自 props，必须自己订阅。
  useLocale();
  if (!missingData.length && !unrecognized.length && !blocked.length) {
    return <EmptyState description={t("webFormPage.pending.empty")} />;
  }

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      {missingData.length ? (
        <Card
          size="small"
          title={t("webFormPage.pending.missingTitle", { count: missingData.length })}
          extra={<Link to="/profile">{t("webFormPage.pending.goToProfile")}</Link>}
        >
          <Lines items={missingData} />
        </Card>
      ) : null}

      {blocked.length ? (
        <Card size="small" title={t("webFormPage.pending.blockedTitle", { count: blocked.length })}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 8 }}
            title={t("webFormPage.pending.blockedBody")}
          />
          <Lines items={blocked} />
          <LiveExitHint />
        </Card>
      ) : null}

      {unrecognized.length ? (
        <Collapse
          size="small"
          items={[
            {
              key: "unrecognized",
              label: t("webFormPage.pending.unrecognizedTitle", {
                count: unrecognized.length,
              }),
              children: (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  <Typography.Text type="secondary">
                    {t("webFormPage.pending.unrecognizedBody")}
                  </Typography.Text>
                  <Lines items={unrecognized} />
                  <LiveExitHint />
                </Space>
              ),
            },
          ]}
        />
      ) : null}
    </Space>
  );
}
