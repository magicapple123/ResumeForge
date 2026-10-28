// SPDX-License-Identifier: Apache-2.0
/**
 * 来源核对面板（W12 / P1-06）：选中一条内容，看它来自哪条资料、关联时是哪一版、来源是否已更新。
 *
 * ## 三条界面真相（都是契约 §2 的直接体现）
 *
 * 1. **未关联 = 没有 link**：显式说"未建立来源关联"，并说明"旧记录不会按文字猜"，
 *    绝不因为"看起来像"就显示一条来源。
 * 2. **stale 是算出来的**：来源指纹与关联时不一致 → 标"来源已更新"，给"采纳最新来源"
 *    与"解除关联"两个动作，由用户决定，不自动覆盖。
 * 3. **原句 / 当前改写** 分开显示：原句来自来源修订摘要，当前改写来自简历内容（宿主传入）。
 */
import { LinkOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Tag, Tooltip, Typography } from "antd";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { pt } from "../../../features/resume-provenance/i18n";
import { shortFingerprint, sourceKindKey } from "../../../features/resume-provenance/helpers";
import type {
  BlockLinkOut,
  DocumentObjectOut,
  SourceChainOut,
  SourceOut,
} from "../../../features/resume-provenance/types";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  /** 选中对象对应的目标块（可能多个：条目与其字段）。 */
  objects: DocumentObjectOut[];
  /** 当前选中块的来源链（GET chain；未关联时 sources 为空）。 */
  chain: SourceChainOut | null;
  /** 当前改写（简历正文里的文本，宿主传入；用于和原句对照）。 */
  currentText?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 采纳最新来源（重新关联到最新修订）。 */
  onRelink?: (link: BlockLinkOut) => void;
  /** 解除关联。 */
  onUnlink?: (link: BlockLinkOut) => void;
  /** 建立关联（打开来源选择）。 */
  onLink?: (object: DocumentObjectOut) => void;
}

function revisionSummary(source: SourceOut): string {
  const revisions = source.revisions ?? [];
  if (revisions.length === 0) return "";
  return revisions[revisions.length - 1].summary || "";
}

function SourceRow({
  source,
  onRelink,
  onUnlink,
}: {
  source: SourceOut;
  onRelink?: (link: BlockLinkOut) => void;
  onUnlink?: (link: BlockLinkOut) => void;
}) {
  useLocale();
  const link = source.blocks[0] ?? null;
  const stale = link?.status === "stale";
  return (
    <div className="source-chain__row" data-source-id={source.id}>
      <Space size={6} wrap align="center">
        <Typography.Text strong>{source.title || source.external_ref || "-"}</Typography.Text>
        <Tag>{pt(sourceKindKey(source.kind))}</Tag>
        {stale ? (
          <Tooltip title={pt("provenance.stale.hint")}>
            <Tag icon={<WarningOutlined />} color="orange">
              {pt("provenance.stale")}
            </Tag>
          </Tooltip>
        ) : null}
        <Typography.Text type="secondary" className="source-chain__fingerprint">
          {pt("provenance.chain.fingerprint", {
            value: shortFingerprint(source.current_fingerprint),
          })}
        </Typography.Text>
      </Space>
      {revisionSummary(source) ? (
        <div className="source-chain__revision">
          <Typography.Text type="secondary" className="source-chain__fingerprint">
            {pt("provenance.chain.latestColon")}
          </Typography.Text>
          {revisionSummary(source)}
        </div>
      ) : null}
      <Space size={8} style={{ marginTop: 6 }} wrap>
        {stale && link && onRelink ? (
          <Button size="small" icon={<ReloadOutlined />} onClick={() => onRelink(link)}>
            {pt("provenance.chain.relink")}
          </Button>
        ) : null}
        {link && onUnlink ? (
          <Button size="small" type="text" danger onClick={() => onUnlink(link)}>
            {pt("provenance.chain.unlink")}
          </Button>
        ) : null}
      </Space>
    </div>
  );
}

export default function SourceChainPanel({
  objects,
  chain,
  currentText,
  loading = false,
  error = null,
  onRetry,
  onRelink,
  onUnlink,
  onLink,
}: Props) {
  useLocale();
  if (error) {
    return <ErrorState description={error} onRetry={onRetry} />;
  }
  if (loading) {
    return <LoadingBlock tip={pt("provenance.panel.title")} />;
  }
  if (objects.length === 0) {
    // 未选中内容：只说一句"先选一条"，不再和"未关联"叠成两句空话。
    return <EmptyState inline description={pt("provenance.chain.selectFirst")} />;
  }

  const linkedObject = objects.find((item) => item.link !== null) ?? null;
  const unlinkedObject = objects.find((item) => item.link === null) ?? null;
  const sources = chain?.sources ?? [];

  return (
    <div className="source-chain" data-provenance-chain="1">
      <Space size={8} align="center" className="source-chain__head" wrap>
        <Typography.Text strong>{pt("provenance.chain.heading")}</Typography.Text>
      </Space>

      {sources.length === 0 ? (
        <Space orientation="vertical" size={6} className="source-chain__body">
          <Alert
            type="info"
            showIcon
            title={pt("provenance.unlinked")}
            description={pt("provenance.unlinked.hint")}
          />
          {unlinkedObject && onLink ? (
            <Button
              size="small"
              icon={<LinkOutlined />}
              aria-label={pt("provenance.chain.link")}
              onClick={() => onLink(unlinkedObject)}
            >
              {pt("provenance.chain.link")}
            </Button>
          ) : null}
        </Space>
      ) : (
        <Space orientation="vertical" size={8} className="source-chain__body">
          <Typography.Text type="secondary" className="source-chain__count">
            {pt("provenance.linked", { count: sources.length })}
          </Typography.Text>
          {currentText ? (
            <div className="source-chain__current">
              <Typography.Text type="secondary" className="source-chain__fingerprint">
                {pt("provenance.chain.currentTextColon")}
              </Typography.Text>
              {currentText}
            </div>
          ) : null}
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} onRelink={onRelink} onUnlink={onUnlink} />
          ))}
          {unlinkedObject && onLink ? (
            <Button
              size="small"
              icon={<LinkOutlined />}
              aria-label={pt("provenance.chain.link")}
              onClick={() => onLink(unlinkedObject)}
            >
              {pt("provenance.chain.link")}
            </Button>
          ) : null}
          {linkedObject?.link && linkedObject.link.status === "stale" && onRelink ? (
            <Alert
              type="warning"
              showIcon
              title={pt("provenance.stale")}
              description={pt("provenance.stale.hint")}
              action={
                <Button size="small" onClick={() => onRelink(linkedObject.link as BlockLinkOut)}>
                  {pt("provenance.chain.relink")}
                </Button>
              }
            />
          ) : null}
        </Space>
      )}
    </div>
  );
}
