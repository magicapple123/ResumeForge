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
 * 2026-11-01（#19）：收藏入口在没选中要点时**禁用**并用 tooltip 说明原因（以前是整块不渲染，
 * 用户看不到"收藏"这个能力存在）；插入禁用原因与收藏原因都由宿主按场景传进来。
 *
 * ## 四态只走项目统一出口
 *
 * loading → `LoadingBlock`；error → `ErrorState`（带重试）；一条都没有 → `EmptyState`；
 * 筛选后为空 → `EmptyState inline` + "清空筛选"（与"真的没有资产"是两件事，不能共用一句话）。
 */
import { StarOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useMemo, useState } from "react";
import EmptyState from "../../common/EmptyState";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import PhraseCard from "./PhraseCard";
import PhraseFilters from "./PhraseFilters";
import "./assets.css";
import { at } from "../../../features/resume-assets/i18n";
import {
  DEFAULT_PHRASE_FILTER,
  collectLanguages,
  collectTags,
  normalizeFilter,
  visiblePhrases,
} from "../../../features/resume-assets/filters";
import type { PhraseFilterState, ResumePhrase } from "../../../features/resume-assets/types";
import { useLocale } from "../../../i18n/i18nContext";

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
  /** 收藏入口是否可用（#19：没选中要点时**禁用**而不是整个不渲染，tooltip 说明原因）。 */
  collectEnabled?: boolean;
  /** 收藏不可用的原因（tooltip 文案由宿主给，随场景不同）。 */
  collectDisabledReason?: string;
  /** 插入不可用的原因（tooltip 文案由宿主给：没选中位置 / 有未保存修改是两回事）。 */
  insertDisabledReason?: string;
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
  collectEnabled = true,
  collectDisabledReason,
  insertDisabledReason,
  initialFilter,
  className,
}: PhraseLibraryPanelProps) {
  useLocale();
  const [filter, setFilter] = useState<PhraseFilterState>(() =>
    normalizeFilter({ ...DEFAULT_PHRASE_FILTER, ...(initialFilter ?? {}) }),
  );
  const tags = useMemo(() => collectTags(phrases), [phrases]);
  const languages = useMemo(() => collectLanguages(phrases), [phrases]);
  const visible = useMemo(() => visiblePhrases(phrases, filter), [phrases, filter]);

  return (
    // 根节点固定带 `.resume-assets-panel`（flex 列 + gap 10）：宿主传进来的 `className`
    // 只做外层补充，不能决定这段排版是否存在——2026-10-29 用户反馈"挨得太近"，根因就是
    // 容器没传 className 时 head / 筛选条 / 列表三块直接贴住（gap 全丢了）。
    <div
      className={["resume-assets-panel", className].filter(Boolean).join(" ")}
      data-resume-assets="library"
    >
      <div className="resume-assets-head">
        <div className="resume-assets-head-main">
          <span className="resume-assets-head-title">{at("assets.panel.title")}</span>
          <span className="resume-assets-head-count">
            {at("assets.list.count", { count: phrases.length })}
          </span>
        </div>
        {onCollectCurrent ? (
          <Tooltip title={collectEnabled ? at("assets.action.collect") : collectDisabledReason}>
            {/* disabled Button 不派发鼠标事件：套 span 才能让「为什么不能收藏」的 tooltip 出现。 */}
            <span className="resume-assets-head-action-wrap">
              <Button
                size="small"
                className="resume-assets-head-action"
                icon={<StarOutlined />}
                disabled={!collectEnabled || undefined}
                aria-label={at("assets.action.collectAria")}
                onClick={onCollectCurrent}
              >
                {at("assets.action.collect")}
              </Button>
            </span>
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
              <span className="resume-assets-empty-hint">{at("assets.empty.hint")}</span>
            </span>
          }
        />
      ) : (
        <>
          <PhraseFilters value={filter} onChange={setFilter} tags={tags} languages={languages} />
          {visible.length === 0 ? (
            <EmptyState
              inline
              description={at("assets.empty.filtered")}
              actionLabel={at("assets.empty.filteredAction")}
              onAction={() => setFilter(normalizeFilter(null))}
            />
          ) : (
            <div className="resume-assets-list">
              {visible.map((phrase, index) => (
                <PhraseCard
                  key={phrase.id}
                  phrase={phrase}
                  index={index + 1}
                  insertEnabled={insertEnabled}
                  insertDisabledReason={insertDisabledReason}
                  onInsert={onInsert}
                  onRequestDelete={onRequestDelete}
                  onCopy={onCopy}
                  onEdit={onEdit}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
