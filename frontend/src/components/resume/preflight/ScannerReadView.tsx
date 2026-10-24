// SPDX-License-Identifier: Apache-2.0
/**
 * D11「机器读到的正文」视图：逐页展示导出产物里**实际能读到的文字**，并把
 * `order_diffs` 点名的 token 高亮出来（缺失 / 顺序不同 / 乱码）。
 *
 * 读取口径以产物为准（后端 `product_text`），前端不做第二次抽取、不重新排序：
 * 这个视图存在的意义就是"让用户看到 ATS 会读成什么样"，任何前端加工都会失真。
 */
import { CopyOutlined } from "@ant-design/icons";
import { App, Button, Space, Tag, Typography } from "antd";
import EmptyState from "../../common/EmptyState";
import type { MessageKey } from "../../../i18n";
import { t } from "../../../i18n";
import {
  diffKindsPresent,
  highlightSegments,
  tokensFromOrderDiffs,
} from "../../../features/resume-preflight/machineText";
import type {
  MachineTextPage,
  OrderDiff,
  OrderDiffKind,
} from "../../../features/resume-preflight/types";
import { copyText } from "../../../utils/clipboard";

const KIND_LABEL_KEY: Record<OrderDiffKind, MessageKey> = {
  missing: "preflight.scanner.legend.missing",
  out_of_order: "preflight.scanner.legend.outOfOrder",
  garbled: "preflight.scanner.legend.garbled",
};

/** 高亮底色只用 token：深色主题下也要能看出"这不是正常文字"。 */
const KIND_STYLE: Record<OrderDiffKind, { backgroundColor: string; color: string }> = {
  missing: { backgroundColor: "var(--rf-error-bg)", color: "var(--rf-error-text)" },
  out_of_order: { backgroundColor: "var(--rf-warning-bg)", color: "var(--rf-warning-text)" },
  garbled: { backgroundColor: "var(--rf-warning-bg)", color: "var(--rf-warning-text)" },
};

interface Props {
  pages?: MachineTextPage[] | null;
  diffs?: OrderDiff[] | null;
}

export default function ScannerReadView({ pages = [], diffs = [] }: Props) {
  const { message } = App.useApp();
  const usablePages = (pages ?? []).filter((page) => page.text.trim().length > 0);
  if (usablePages.length === 0) {
    return <EmptyState inline description={t("preflight.scanner.empty")} />;
  }
  const tokens = tokensFromOrderDiffs(diffs);
  const kinds = diffKindsPresent(diffs);
  const plainText = usablePages.map((page) => page.text).join("\n\n");

  const copy = async () => {
    const ok = await copyText(plainText);
    if (ok) message.success(t("preflight.scanner.copied"));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("preflight.scanner.description")}
        </Typography.Text>
        <span style={{ flex: "1 1 auto" }} />
        <Button size="small" icon={<CopyOutlined />} onClick={() => void copy()}>
          {t("preflight.scanner.copy")}
        </Button>
      </div>
      {kinds.length > 0 ? (
        <Space size={6} wrap>
          {kinds.map((kind) => (
            <Tag key={kind} style={KIND_STYLE[kind]}>
              {t(KIND_LABEL_KEY[kind])}
            </Tag>
          ))}
        </Space>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("preflight.scanner.clean")}
        </Typography.Text>
      )}
      <div
        style={{
          maxHeight: 420,
          overflowY: "auto",
          padding: "8px 10px",
          border: "1px solid var(--rf-border-subtle)",
          borderRadius: "var(--rf-radius-control)",
        }}
      >
        {usablePages.map((page) => (
          <section key={page.page} style={{ marginBottom: 10 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("preflight.scanner.page", { page: page.page })}
            </Typography.Text>
            <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
              {highlightSegments(page.text, tokens).map((segment, index) =>
                segment.kind === "normal" ? (
                  <span key={index}>{segment.text}</span>
                ) : (
                  <span
                    key={index}
                    data-proview-diff={segment.kind}
                    style={KIND_STYLE[segment.kind]}
                  >
                    {segment.text}
                  </span>
                ),
              )}
            </Typography.Paragraph>
          </section>
        ))}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("preflight.scanner.hint")}
      </Typography.Text>
    </div>
  );
}
