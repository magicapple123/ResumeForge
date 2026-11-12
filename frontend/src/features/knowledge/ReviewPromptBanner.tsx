// SPDX-License-Identifier: Apache-2.0
/**
 * 复习提醒条（#29F）：最近 30 天没打开、但值得回看的条目，每周最多提示一次。
 *
 * 不做 SRS、不做定时任务：服务端只给候选（GET /knowledge/review-prompt），
 * "每周一次"的去重由前端按自然周记 localStorage（逻辑在 reviewWeek.ts）。
 * 本组件失败时安静隐藏——它只是提醒，不该在页面顶部挂一条红色错误。
 */
import { Alert, App, Button, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { getKnowledgeReviewPrompt } from "../../api/knowledge";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { KnowledgeReviewPrompt } from "../../types";
import { muteThisWeek, mutedThisWeek } from "./reviewWeek";

const STALE_DAYS = 30;

export default function ReviewPromptBanner() {
  useLocale();
  const { message } = App.useApp();
  const [prompt, setPrompt] = useState<KnowledgeReviewPrompt | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (mutedThisWeek()) return;
    let cancelled = false;
    getKnowledgeReviewPrompt({ stale_days: STALE_DAYS, limit: 5 })
      .then((data) => {
        if (!cancelled) setPrompt(data);
      })
      .catch(() => {
        // 提醒是可选数据：失败就安静跳过，不打扰页面。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden || !prompt || prompt.count === 0) return null;

  const dismiss = () => {
    muteThisWeek();
    setHidden(true);
    message.success(t("knowledgePage.review.dismissed"));
  };

  return (
    <Alert
      style={{ marginBottom: 12 }}
      type="info"
      showIcon
      title={t("knowledgePage.review.title", { count: prompt.count })}
      description={
        <div>
          <Typography.Text type="secondary">
            {t("knowledgePage.review.description")}
          </Typography.Text>
          {prompt.items.length > 0 ? (
            <Space size={4} wrap style={{ marginTop: 4 }}>
              {prompt.items.slice(0, 3).map((item) => (
                <Tag key={item.id}>{item.title}</Tag>
              ))}
            </Space>
          ) : null}
        </div>
      }
      action={
        <Button size="small" onClick={dismiss}>
          {t("knowledgePage.review.dismiss")}
        </Button>
      }
      closable
      onClose={dismiss}
    />
  );
}
