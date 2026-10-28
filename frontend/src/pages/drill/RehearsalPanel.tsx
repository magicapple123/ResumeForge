// SPDX-License-Identifier: Apache-2.0
/** 复练队列：点一条就换一个角度出新题。 */
import { App, Button, Listy, Modal, Space, Tag, Typography } from "antd";
import PageSkeleton from "../../components/common/PageSkeleton";
import { useCallback, useEffect, useState } from "react";
import { listRehearsal, rehearse } from "../../api/drill";
import AbortButton from "../../components/common/AbortButton";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import { errorText, useAbortableRequest } from "../../hooks/useAbortableRequest";
import { t } from "../../i18n";
import { REHEARSE_KIND_LABEL_KEYS } from "../../i18n/enum/drill";
import { useLocale } from "../../i18n/i18nContext";
import type { DrillRehearsalRow, RehearseKind } from "../../types";

/**
 * 复练题型的展示名在 `i18n/enum/drill.ts`（协议值 → key 的唯一映射）；
 * 这里只负责"认不出的题型留空"，由调用方回落成协议值。
 */
function rehearseKindLabel(kind: string): string {
  const key = REHEARSE_KIND_LABEL_KEYS[kind as RehearseKind];
  return key ? t(key) : "";
}

export function RehearsalPanel({ sessionId }: { sessionId: number }) {
  // 本组件用模块级 t()，必须订阅语言变化，否则切语言后文案不跟着变。
  useLocale();
  const { message } = App.useApp();
  const [rows, setRows] = useState<DrillRehearsalRow[]>([]);
  const [loading, setLoading] = useState(false);
  // 复练出题同样是一次现场生成：等的时候可以停，停完这一条还能立刻再点。
  const askRequest = useAbortableRequest();
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
    const key = `${row.claim_title}-${row.kind}`;
    setBusy(key);
    const outcome = await askRequest.run((signal) => rehearse(sessionId, row, signal));
    setBusy("");
    if (outcome.status === "ok") {
      setResult({
        question: outcome.data.question,
        expect: outcome.data.expect,
        label: outcome.data.claim_title,
      });
      return;
    }
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("drill.rehearsal.error.failed")));
    }
    // aborted：用户自己停的，不弹错误；上一次的复练结果原样留着。
  };

  /** 停止：把这一条的行内 loading 一起收起，行内按钮立刻可再点。 */
  const cancel = () => {
    askRequest.cancel();
    setBusy("");
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
              busy === `${row.claim_title}-${row.kind}` ? (
                <AbortButton key="stop" size="small" onClick={cancel} />
              ) : null,
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
