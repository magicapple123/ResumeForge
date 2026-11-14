// SPDX-License-Identifier: Apache-2.0
/**
 * 「模型窗口参考」入口：一个链接 + 一张只读表（模型 / 窗口 / 官方文档）。
 *
 * 为什么需要看得见：窗口是**手填**的（服务商的 /models 不返回窗口长度），填大直接 400、
 * 填小会提前压缩。此前这张表只存在于后端代码里，用户只能凭记忆填。这里把它原样摊开，
 * 并把"当前模型命中的是哪一条"标出来——否则用户看完还是不知道自己该填多少。
 *
 * 三条边界：
 * - 纯只读：不提供"一键应用"，窗口的写入仍走模型配置（同一个值会影响该模型的所有对话，
 *   不该在一个参考弹层里顺手改）；
 * - 表里没有的型号不给假数字，只用一句"按保守值估算"说明；
 * - 链接一律新窗口打开（官方文档），不把用户带离当前页。
 */

import { Alert, Button, Modal, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useState } from "react";
import { getModelWindowReference } from "../../api/settings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ModelWindowEntry, ModelWindowReference } from "../../types";

/** 表格里的数字用千分位原值：参考表要能逐位核对，缩写（1.0M）会抹掉精度。 */
function exactTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

/** 当前模型来源 → 已有文案（与上下文弹层同一套，避免两处措辞不一致）。 */
const SOURCE_KEYS = {
  manual: "contextUsage.window.source.manual",
  reference: "contextUsage.window.source.reference",
  fallback: "contextUsage.window.source.fallback",
} as const;

export default function ModelWindowReferenceButton() {
  useLocale();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ModelWindowReference | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setData(await getModelWindowReference());
    } catch {
      // 只是参考表：失败不弹全局错误，弹层里给一条可重试的说明即可。
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // 打开时才请求；已经拿到就复用（表是常量，不随对话变化）。放在点击里而不是 effect：
  // 既有数据时重开不该再发请求，也避免"effect 里同步 setState"的额外一轮渲染。
  const openReference = () => {
    setOpen(true);
    if (data === null && !loading && !failed) void load();
  };

  const columns: ColumnsType<ModelWindowEntry> = [
    {
      title: t("contextUsage.window.reference.column.model"),
      dataIndex: "label",
      key: "label",
      render: (label: string) => (
        <Space size={6} wrap={false}>
          <span>{label}</span>
          {data?.current.label === label ? (
            <Tag color="blue">{t("contextUsage.window.reference.currentBadge")}</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: t("contextUsage.window.reference.column.window"),
      dataIndex: "tokens",
      key: "tokens",
      align: "right",
      width: 140,
      render: (tokens: number) => <Typography.Text strong>{exactTokens(tokens)}</Typography.Text>,
    },
    {
      title: t("contextUsage.window.reference.column.reference"),
      dataIndex: "reference",
      key: "reference",
      width: 110,
      render: (reference: string) => (
        <a href={reference} target="_blank" rel="noreferrer">
          {t("contextUsage.window.reference.open")}
        </a>
      ),
    },
  ];

  const current = data?.current;
  return (
    <>
      <Button type="link" size="small" onClick={openReference}>
        {t("contextUsage.window.reference.trigger")}
      </Button>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={640}
        title={t("contextUsage.window.reference.title")}
        destroyOnHidden
      >
        {data ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {t("contextUsage.window.reference.hint", { tokens: exactTokens(data.default_tokens) })}
          </Typography.Paragraph>
        ) : null}
        {failed ? (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Alert type="warning" showIcon title={t("contextUsage.window.reference.failed")} />
            <Button size="small" onClick={() => void load()}>
              {t("contextUsage.window.reference.retry")}
            </Button>
          </Space>
        ) : (
          <>
            <Table<ModelWindowEntry>
              rowKey="label"
              size="small"
              loading={loading}
              columns={columns}
              dataSource={data?.entries ?? []}
              pagination={false}
              scroll={{ y: 420 }}
              locale={{ emptyText: t("contextUsage.window.reference.empty") }}
            />
            {current ? (
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                {current.model
                  ? t("contextUsage.window.reference.currentLine", {
                      model: current.model,
                      source: t(SOURCE_KEYS[current.source]),
                    })
                  : t("contextUsage.window.reference.noModel")}
              </Typography.Paragraph>
            ) : null}
          </>
        )}
      </Modal>
    </>
  );
}
