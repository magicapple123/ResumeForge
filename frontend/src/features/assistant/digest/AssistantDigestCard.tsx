// SPDX-License-Identifier: Apache-2.0
/**
 * 今日简报卡（18B）：一屏"今天该干什么"。
 *
 * 内容全部来自既有数据；卡片上只做展示与「重新生成」——
 * 不新增采集、不调模型、不做常驻调度（启动时才补算，设计取舍见问题清单 #18B）。
 */
import { DownOutlined, ReloadOutlined, UpOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Popover, Space, Tag, Typography } from "antd";
import EmptyState from "../../../components/common/EmptyState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { DigestItem, DigestSection } from "./digestApi";
import { useAssistantDigest } from "./useAssistantDigest";
import { useDigestDisclosure } from "./useDigestDisclosure";
import "./assistantDigest.css";

const SECTION_LABEL_KEYS: Record<string, Parameters<typeof t>[0]> = {
  worth_jobs: "assistantBreadth.digest.section.worth_jobs",
  stale_applications: "assistantBreadth.digest.section.stale_applications",
  interviews: "assistantBreadth.digest.section.interviews",
  expired_jobs: "assistantBreadth.digest.section.expired_jobs",
  funnel: "assistantBreadth.digest.section.funnel",
};

function sectionTitle(section: DigestSection): string {
  const key = SECTION_LABEL_KEYS[section.key];
  return key ? t(key) : section.key;
}

/** ISO 带时区偏移 → HH:MM（简报只需要"上次更新在几点"，不做时区换算）。 */
function shortTime(value: string): string {
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : value;
}

function itemLine(section: DigestSection, item: DigestItem): string {
  if (section.key === "stale_applications") {
    return `${item.title ?? ""} · ${item.company ?? ""} · ${t("assistantBreadth.digest.staleDays", {
      days: item.days ?? 0,
    })}`;
  }
  if (section.key === "interviews") {
    const when =
      item.days_until === 0
        ? t("assistantBreadth.digest.today")
        : t("assistantBreadth.digest.daysUntil", { days: item.days_until ?? 0 });
    const action = item.next_action ? ` · ${item.next_action}` : "";
    return `${item.company ?? ""} · ${item.title ?? ""} · ${when}${action}`;
  }
  if (section.key === "worth_jobs" && typeof item.score === "number") {
    return `${item.company ?? ""} · ${item.title ?? ""} · ${t("assistantBreadth.digest.score", {
      score: item.score,
    })}`;
  }
  return `${item.company ?? ""} · ${item.title ?? ""}`.trim();
}

function SectionBlock({ section }: { section: DigestSection }) {
  if (section.key === "funnel" && section.summary) {
    return (
      <div data-testid="digest-section-funnel">
        <Typography.Text strong>{sectionTitle(section)}</Typography.Text>
        <div>
          <Space size={8} wrap>
            <Tag>
              {t("assistantBreadth.digest.funnel.applied", { count: section.summary.applied })}
            </Tag>
            <Tag color="success">
              {t("assistantBreadth.digest.funnel.succeeded", { count: section.summary.succeeded })}
            </Tag>
            <Tag color="error">
              {t("assistantBreadth.digest.funnel.failed", { count: section.summary.failed })}
            </Tag>
            <Tag color="processing">
              {t("assistantBreadth.digest.funnel.interviewing", {
                count: section.summary.interviewing,
              })}
            </Tag>
          </Space>
        </div>
      </div>
    );
  }
  return (
    <div data-testid={`digest-section-${section.key}`}>
      <Typography.Text strong>
        {sectionTitle(section)} · {section.count}
      </Typography.Text>
      {section.key === "interviews" && (section.today_count ?? 0) > 0 ? (
        <div>
          <Tag color="processing">
            {t("assistantBreadth.digest.interviewToday", { count: section.today_count ?? 0 })}
          </Tag>
        </div>
      ) : null}
      <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 2 }}>
        {(section.items ?? []).map((item) => (
          <li
            key={`${section.key}-${item.job_id ?? item.record_id ?? item.track_id ?? item.title}`}
          >
            <Typography.Text type="secondary">{itemLine(section, item)}</Typography.Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AssistantDigestCard({ enabled = true }: { enabled?: boolean }) {
  useLocale();
  const { digest, loading, refreshing, failed, refresh } = useAssistantDigest(enabled);
  const { open, changeOpen } = useDigestDisclosure();
  if (!enabled) return null;

  const visibleSections = (digest?.sections ?? []).filter(
    (section) => section.key === "funnel" || section.count > 0,
  );
  const nothingToDo =
    digest !== null && visibleSections.every((section) => section.key === "funnel");

  const changes = digest?.changes.count ?? 0;
  const countFor = (key: string) =>
    digest?.sections.find((section) => section.key === key)?.count ?? 0;
  const hasItems = (digest?.sections ?? []).some(
    (section) => section.key !== "funnel" && section.count > 0,
  );
  const content = (
    <div className="assistant-digest-popover" onClick={(event) => event.stopPropagation()}>
      <Card
        size="small"
        className="assistant-digest-card"
        title={t("assistantBreadth.digest.title")}
        extra={
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={(event) => {
              event.stopPropagation();
              void refresh();
            }}
          >
            {t(
              refreshing ? "assistantBreadth.digest.refreshing" : "assistantBreadth.digest.refresh",
            )}
          </Button>
        }
      >
        {failed ? (
          <Alert type="warning" showIcon title={t("assistantBreadth.digest.error")} />
        ) : null}
        {loading && digest === null ? <LoadingBlock minHeight={96} /> : null}
        {digest !== null ? (
          <div style={{ display: "grid", gap: 10 }}>
            <Space size={8} wrap>
              <Tag color={(digest.changes.count ?? 0) > 0 ? "warning" : "default"}>
                {t("assistantBreadth.digest.changes", { count: digest.changes.count })}
              </Tag>
              <Typography.Text type="secondary" data-testid="digest-generated-at">
                {t("assistantBreadth.digest.generatedAt", {
                  time: shortTime(digest.generated_at),
                })}
              </Typography.Text>
            </Space>
            {nothingToDo ? (
              <EmptyState inline description={t("assistantBreadth.digest.empty")} />
            ) : (
              visibleSections.map((section) => <SectionBlock key={section.key} section={section} />)
            )}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("assistantBreadth.digest.hint")}
            </Typography.Text>
          </div>
        ) : null}
      </Card>
    </div>
  );
  const summaryText = hasItems
    ? `${t("assistantBreadth.digest.changes", { count: changes })} · ${t(
        "assistantBreadth.digest.summary.stale",
        { count: countFor("stale_applications") },
      )} · ${t("assistantBreadth.digest.summary.expired", { count: countFor("expired_jobs") })}`
    : t("assistantBreadth.digest.summary.empty");

  return (
    <Popover
      open={open}
      onOpenChange={changeOpen}
      trigger="click"
      placement="bottomLeft"
      styles={{ content: { padding: 0 }, root: { maxWidth: "calc(100vw - 32px)" } }}
      content={content}
    >
      <Button type="text" className="assistant-digest-summary" aria-expanded={open}>
        {changes > 0 ? <span className="assistant-digest-change-dot" aria-hidden="true" /> : null}
        <strong>{t("assistantBreadth.digest.title")}</strong>
        <span className="assistant-digest-summary-counts">{summaryText}</span>
        {digest ? <time>{shortTime(digest.generated_at)}</time> : null}
        <span>
          {t(
            open
              ? "assistantBreadth.digest.summary.collapse"
              : "assistantBreadth.digest.summary.expand",
          )}
        </span>
        {open ? <UpOutlined /> : <DownOutlined />}
      </Button>
    </Popover>
  );
}
