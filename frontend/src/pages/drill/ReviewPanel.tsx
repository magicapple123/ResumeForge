// SPDX-License-Identifier: Apache-2.0
/** 复盘：三段结论 + 行动清单 + 复练队列。 */
import { Alert, Listy, Space, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { DrillSession } from "../../types";
import { RehearsalPanel } from "./RehearsalPanel";

/**
 * 行动类型是后端返回的协议值（中文），展示名与一句说明在语言包里。
 * 映射放在这里（协议值 → MessageKey），不改 `types/drill.ts` 的类型层。
 */
const ACTION_KIND_COPY: Partial<Record<string, { labelKey: MessageKey; hintKey: MessageKey }>> = {
  补事实: { labelKey: "drill.review.kind.addFact", hintKey: "drill.review.hint.addFact" },
  补知识: { labelKey: "drill.review.kind.addKnowledge", hintKey: "drill.review.hint.addKnowledge" },
  降表述: {
    labelKey: "drill.review.kind.downgradeClaim",
    hintKey: "drill.review.hint.downgradeClaim",
  },
};

/** 认不出的协议值原样显示，保证后端新增类型时不至于渲染空白。 */
function actionKindLabel(kind: string): string {
  const copy = ACTION_KIND_COPY[kind];
  return copy ? t(copy.labelKey) : kind;
}

/** 同类操作的一句说明；没有就返回空串，由调用方决定不渲染。 */
function actionKindHint(kind: string): string {
  const copy = ACTION_KIND_COPY[kind];
  return copy ? t(copy.hintKey) : "";
}

export function ReviewPanel({ session }: { session: DrillSession }) {
  // 本组件用模块级 t()，必须订阅语言变化，否则切语言后文案不跟着变。
  useLocale();
  const review = session.review;
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {review.covered && (
        <Typography.Paragraph style={{ marginBottom: 0 }}>{review.covered}</Typography.Paragraph>
      )}
      {review.verified_summary && (
        <Alert
          type="success"
          showIcon
          title={t("drill.review.verified.title")}
          description={review.verified_summary}
        />
      )}
      {review.gaps_summary && (
        <Alert
          type="warning"
          showIcon
          title={t("drill.review.gaps.title")}
          description={review.gaps_summary}
        />
      )}

      {(review.actions?.length ?? 0) > 0 && (
        <div>
          <Typography.Text strong>{t("drill.review.actions.title")}</Typography.Text>
          <Listy
            items={review.actions ?? []}
            rowKey={(item) => `${item.kind}|${item.claim_title}|${item.detail}`}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={(item) => (
              <ListyItem>
                <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                  <Space size={6} wrap>
                    <Tag
                      color={
                        item.kind === "降表述" ? "red" : item.kind === "补知识" ? "blue" : "gold"
                      }
                    >
                      {actionKindLabel(item.kind)}
                    </Tag>
                    <Typography.Text strong>{item.claim_title}</Typography.Text>
                  </Space>
                  <Typography.Text>{item.detail}</Typography.Text>
                  {actionKindHint(item.kind) && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {actionKindHint(item.kind)}
                    </Typography.Text>
                  )}
                </Space>
              </ListyItem>
            )}
          />
        </div>
      )}

      <div>
        <Typography.Text strong>{t("drill.review.rehearsal.title")}</Typography.Text>
        <RehearsalPanel sessionId={session.id} />
      </div>
    </Space>
  );
}
