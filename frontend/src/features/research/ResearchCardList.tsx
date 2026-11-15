// SPDX-License-Identifier: Apache-2.0
/**
 * 资料卡片列表（T07 · A 路产出）。
 *
 * 三种卡片（官网 / 近期新闻 / 公司介绍）共用一套行样式，靠 `kind` 换标签颜色：
 * 用户看的是"这是哪一类资料"，而不是三块不同的区域。
 *
 * 两条硬约束：
 * - `site_icon` 只在前端拿到合法 http(s) 时才渲染 `<img>`，**不猜** favicon 地址
 *   （猜一个就等于替用户向第三方发了一次请求）；
 * - 后端已按权威度 ≥ 4 算好 `authority_high`，前端不再重算阈值——阈值只该有一处。
 */
import { Card, Tag, Typography } from "antd";
import type { MessageKey } from "../../i18n";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EmptyState from "../../components/common/EmptyState";
import type { ResearchCard } from "../../api/research";

/** 卡片类型 → 标签文案。表里存 key，渲染处再 `t()`（切语言才会跟着变）。 */
const KIND_LABEL_KEY: Record<ResearchCard["kind"], MessageKey> = {
  official: "companyResearch.card.official",
  news: "companyResearch.card.news",
  overview: "companyResearch.card.overview",
};

/** 卡片类型 → antd Tag 颜色（只用语义色名，不写死十六进制）。 */
const KIND_COLOR: Record<ResearchCard["kind"], string> = {
  official: "green",
  news: "blue",
  overview: "default",
};

function CardRow({ card }: { card: ResearchCard }) {
  useLocale();
  return (
    <li>
      <Card size="small" className="rf-research-card">
        <div className="rf-research-card-head">
          {card.site_icon ? (
            <img
              className="rf-research-card-icon"
              src={card.site_icon}
              alt=""
              width={16}
              height={16}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <Tag color={KIND_COLOR[card.kind]}>{t(KIND_LABEL_KEY[card.kind])}</Tag>
          <Typography.Text type="secondary" className="rf-research-card-site">
            {card.site_name}
          </Typography.Text>
          {card.date ? <Typography.Text type="secondary">{card.date}</Typography.Text> : null}
          {/* Backend decides the authority badge; the UI never re-derives the threshold. */}
          {card.authority_high ? (
            <Tag color="gold">{t("companyResearch.card.authorityBadge")}</Tag>
          ) : null}
        </div>
        <Typography.Link
          href={card.url}
          target="_blank"
          rel="noreferrer"
          title={card.title}
          aria-label={t("companyResearch.card.openAria", { title: card.title })}
        >
          {card.title}
        </Typography.Link>
        {card.snippet ? (
          <Typography.Paragraph type="secondary" className="rf-research-card-snippet">
            {card.snippet}
          </Typography.Paragraph>
        ) : null}
      </Card>
    </li>
  );
}

export default function ResearchCardList({ cards }: { cards: ResearchCard[] }) {
  useLocale();
  if (cards.length === 0) {
    return <EmptyState inline description={t("companyResearch.cards.empty")} />;
  }
  return (
    <ul className="rf-research-cards" aria-label={t("companyResearch.cards.title")}>
      {cards.map((card) => (
        <CardRow key={`${card.kind}:${card.url}`} card={card} />
      ))}
    </ul>
  );
}
