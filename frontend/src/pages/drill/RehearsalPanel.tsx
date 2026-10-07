/** 复练队列：点一条就换一个角度出新题。 */
import { App, Button, Listy, Modal, Skeleton, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { listRehearsal, rehearse } from "../../api/drill";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import type { DrillRehearsalRow } from "../../types";
import { REHEARSE_LABELS } from "../../types";

export function RehearsalPanel({ sessionId }: { sessionId: number }) {
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
      message.error(error instanceof Error ? error.message : "出题失败");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 2 }} />;
  if (rows.length === 0) {
    return (
      <Typography.Text type="secondary">复练队列是空的——这一场没有需要再练的主张。</Typography.Text>
    );
  }

  return (
    <>
      <Typography.Paragraph type="secondary">
        复练不重复原题，换一个角度再问一次——把上次的答案背一遍不算会了。
      </Typography.Paragraph>
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
                出一道
              </Button>,
            ]}
          >
            <Space orientation="vertical" size={2} style={{ width: "100%" }}>
              <Space size={6} wrap>
                <Typography.Text strong>{row.claim_title}</Typography.Text>
                <Tag>{row.kind_label || REHEARSE_LABELS[row.kind as never] || row.kind}</Tag>
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
        title={`复练：${result?.label ?? ""}`}
        onCancel={() => setResult(null)}
        footer={<Button onClick={() => setResult(null)}>关掉</Button>}
        width={620}
      >
        <Typography.Paragraph strong>{result?.question}</Typography.Paragraph>
        {result?.expect && (
          <Typography.Text type="secondary">这道题要求：{result.expect}</Typography.Text>
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
          这里只是出题，不会计入这一场的记录——想认真练，可以拿这个问题自己讲一遍。
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
