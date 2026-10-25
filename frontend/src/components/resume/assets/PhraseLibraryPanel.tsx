// SPDX-License-Identifier: Apache-2.0
/**
 * 「表达资产库」面板（W17 / D16）：筛选条 + 卡片列表 + 四态（加载 / 错误 / 空 / 有数据）。
 *
 * ## 职责边界
 *
 * 这个面板只做"看与筛"：**插入、删除、复制都由宿主处理**（插入要生成新的对象身份、删除要进回收站，
 * 两者都需要简历上下文与全局提示，不该埋在一个列表组件里）。所以它是一组回调 + 一份受控数据，
 * 既能挂进制作台侧栏，也能挂在独立的资产库页。
 *
 * ## 四态只走项目统一出口
 *
 * loading → `LoadingBlock`；error → `ErrorState`（带重试）；一条都没有 → `EmptyState`；
 * 筛选后为空 → `EmptyState inline` + "清空筛选"（与"真的没有资产"是两件事，不能共用一句话）。
 */
import { StarOutlined } from "@ant-design/icons";
import { Button, Space, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import PhraseCard from "./PhraseCard";
import PhraseFilters from "./PhraseFilters";
import { at } from "../../../features/resume-assets/i18n";
import {
  DEFAULT_PHRASE_FILTER,
  collectLanguages,
  collectTags,
  normalizeFilter,
  visiblePhrases,
} from "../../../features/resume-assets/filters";
import type { PhraseFilterState, ResumePhrase } from "../../../features/resume-assets/types";

export interface PhraseLibraryPanelProps {
  /** 已加载的资产（宿主负责请求；本组件不发网络请求）。 */
  phrases: ResumePhrase[];
  loading?: boolean;
  /** 非空时展示错误态（值是给用户看的说明，调用方负责本地化）。 */
  error?: string | null;
  retrying?: boolean;
  onRetry?: () => void;
  /** 当前是否有可插入的简历；false 时插入按钮禁用并说明原因。 */
  insertEnabled?: boolean;
  onInsert?: (phrase: ResumePhrase) => void;
  onRequestDelete?: (phrase: ResumePhrase) => void;
  onCopy?: (phrase: ResumePhrase) => void;
  /** 编辑这条资产（正文/类型/语言/岗位标签）；不传 = 不渲染入口。 */
  onEdit?: (phrase: ResumePhrase) => void;
  /** 把"当前选中的要点"收藏成资产；不传 = 不渲染这个入口。 */
  onCollectCurrent?: () => void;
  initialFilter?: Partial<PhraseFilterState>;
  className?: string;
}

export default function PhraseLibraryPanel({
  phrases,
  loading = false,
  error = null,
  retrying = false,
  onRetry,
  insertEnabled = false,
  onInsert,
  onRequestDelete,
  onCopy,
  onEdit,
  onCollectCurrent,
  initialFilter,
  className,
}: PhraseLibraryPanelProps) {
  const [filter, setFilter] = useState<PhraseFilterState>(() =>
    normalizeFilter({ ...DEFAULT_PHRASE_FILTER, ...(initialFilter ?? {}) }),
  );
  const tags = useMemo(() => collectTags(phrases), [phrases]);
  const languages = useMemo(() => collectLanguages(phrases), [phrases]);
  const visible = useMemo(() => visiblePhrases(phrases, filter), [phrases, filter]);

  return (
    <div className={className} data-resume-assets="library">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Space size={6} align="baseline">
          <Typography.Text strong>{at("assets.panel.title")}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {at("assets.list.count", { count: phrases.length })}
          </Typography.Text>
        </Space>
        {onCollectCurrent ? (
          <Tooltip title={at("assets.action.collect")}>
            <Button
              size="small"
              icon={<StarOutlined />}
              aria-label={at("assets.action.collectAria")}
              onClick={onCollectCurrent}
            >
              {at("assets.action.collect")}
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {error ? (
        <ErrorState
          description={error}
          onRetry={onRetry}
          retrying={retrying}
          retryLabel={at("assets.error.retry")}
        />
      ) : loading ? (
        <LoadingBlock tip={at("assets.panel.title")} />
      ) : phrases.length === 0 ? (
        <EmptyState
          description={
            <span>
              {at("assets.empty")}
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {at("assets.empty.hint")}
              </Typography.Text>
            </span>
          }
        />
      ) : (
        <>
          <PhraseFilters value={filter} onChange={setFilter} tags={tags} languages={languages} />
          <div style={{ marginTop: 8 }}>
            {visible.length === 0 ? (
              <EmptyState
                inline
                description={at("assets.empty.filtered")}
                actionLabel={at("assets.empty.filteredAction")}
                onAction={() => setFilter(normalizeFilter(null))}
              />
            ) : (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                {visible.map((phrase, index) => (
                  <PhraseCard
                    key={phrase.id}
                    phrase={phrase}
                    index={index + 1}
                    insertEnabled={insertEnabled}
                    onInsert={onInsert}
                    onRequestDelete={onRequestDelete}
                    onCopy={onCopy}
                    onEdit={onEdit}
                  />
                ))}
              </Space>
            )}
          </div>
        </>
      )}
    </div>
  );
}
