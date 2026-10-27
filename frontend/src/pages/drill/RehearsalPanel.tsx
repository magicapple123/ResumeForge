// SPDX-License-Identifier: Apache-2.0
/** 复练队列：点一条就换一个角度出新题。 */
import { App, Button, Listy, Modal, Space, Tag, Typography } from "antd";
import PageSkeleton from "../../components/common/PageSkeleton";
import { useCallback, useEffect, useState } from "react";
import { listRehearsal, rehearse } from "../../api/drill";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { DrillRehearsalRow, RehearseKind } from "../../types";

/**
 * 复练题型是后端协议值（`variant` / `counterfactual` …），展示名在语言包里。
 * 映射放在这里（协议值 → MessageKey），不改 `types/drill.ts` 的类型层。
 */
const REHEARSE_LABEL_KEYS: Record<RehearseKind, MessageKey> = {
  variant: "drill.rehearsal.kind.variant",
  counterfactual: "drill.rehearsal.kind.counterfactual",
  failure: "drill.rehearsal.kind.failure",
  evidence: "drill.rehearsal.kind.evidence",
  compress: "drill.rehearsal.kind.compress",
};

/** 后端可能给出表外的题型：认不出来就返回空串，由调用方回落到协议值。 */
function rehearseKindLabel(kind: string): string {
  const key = REHEARSE_LABEL_KEYS[kind as RehearseKind];
  return key ? t(key) : "";
}

export function RehearsalPanel({ sessionId }: { sessionId: number }) {
  // 本组件用模块级 t()，必须订阅语言变化，否则切语言后文案不跟着变。
  useLocale();
  const { message } = App.useApp();
  const [rows, setRows] = useState<DrillRehearsalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ question: string; expect: string; label: string } | null>(
    null,
  );

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新。
  const fetchRows = useCallback(async () => {
    try {
      return await listRehearsal(sessionId);
    } catch {
      return null;
    }
  }, [sessionId]);

  // Compiler 规范：随 sessionId 变化的加载用渲染期守卫 + 内联 async IIFE。
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await fetchRows();
      if (cancelled) return;
      setRows(rows ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRows, sessionId]);

  const run = async (row: DrillRehearsalRow) => {
    setBusy(`${row.claim_title}-${row.kind}`);
    try {
      const fresh = await rehearse(sessionId, row);
      setResult({ question: fresh.question, expect: fresh.expect, label: fresh.claim_title });
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("drill.rehearsal.error.failed"));
    } finally {
      setBusy("");
    }
  };

  if (loading) return <PageSkeleton rows={2} card={false} />;
  if (rows.length === 0) {
    return <Typography.Text type="secondary">{t("drill.rehearsal.empty")}</Typography.Text>;
  }

  return (
    <>
      <Typography.Paragraph type="secondary">{t("drill.rehearsal.intro")}</Typography.Paragraph>
      <Listy
        items={rows}
        rowKey={(row) => `${row.claim_title}-${row.kind}`}
        styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
        itemRender={(row) => (
          <ListyItem
            actions={[
              <Button
                key="go"
                size="small"
                type="link"
                loading={busy === `${row.claim_title}-${row.kind}`}
                onClick={() => void run(row)}
              >
                {t("drill.rehearsal.action.ask")}
              </Button>,
            ]}
          >
            <Space orientation="vertical" size={2} style={{ width: "100%" }}>
              <Space size={6} wrap>
                <Typography.Text strong>{row.claim_title}</Typography.Text>
                <Tag>{row.kind_label || rehearseKindLabel(row.kind) || row.kind}</Tag>
              </Space>
              {row.why && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.why}
                </Typography.Text>
              )}
            </Space>
          </ListyItem>
        )}
      />
      <Modal
        open={result !== null}
        title={t("drill.rehearsal.result.title", { label: result?.label ?? "" })}
        onCancel={() => setResult(null)}
        footer={
          <Button onClick={() => setResult(null)}>{t("drill.rehearsal.action.close")}</Button>
        }
        width={620}
      >
        <Typography.Paragraph strong>{result?.question}</Typography.Paragraph>
        {result?.expect && (
          <Typography.Text type="secondary">
            {t("drill.rehearsal.result.expect", { expect: result.expect })}
          </Typography.Text>
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
          {t("drill.rehearsal.result.note")}
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
