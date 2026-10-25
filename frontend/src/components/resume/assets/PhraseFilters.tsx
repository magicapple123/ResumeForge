// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产库的筛选条（W17）：关键词 + 类型 + 语言 + 岗位标签 + 排序 + 清空。
 *
 * **受控组件**：筛选状态由 `PhraseLibraryPanel` 持有（这样"清空筛选"与空态按钮能改同一份状态）。
 * 选项来自数据本身（`collectTags` / `collectLanguages`），不写死枚举——用户收藏了什么标签，
 * 下拉里就有什么，避免"筛选里有一个永远没有结果的选项"。
 *
 * ## 为什么不用 Row/Col（2026-10-25 任务 C2）
 *
 * 面板挂在制作台左栏，宽度由用户拖动决定（380–640），**与视口无关**。原来的
 * `Col xs/md` 按视口算断点，1728 视口下 4 列各占 4/24，340 内容宽里每个下拉只剩
 * 50 多 px，选中文案被截成「全 / 最」。现在改成两层：搜索框通栏，四个下拉走
 * `grid auto-fit minmax(140px, 1fr)`（380 → 2×2，≥600 → 一行 4 个），布局只跟容器宽度走。
 */
import { Button, Input, Select } from "antd";
import { at } from "../../../features/resume-assets/i18n";
import {
  activeFilterCount,
  isDefaultFilter,
  normalizeFilter,
} from "../../../features/resume-assets/filters";
import {
  PHRASE_KINDS,
  type PhraseFilterState,
  type PhraseKind,
  type PhraseSort,
} from "../../../features/resume-assets/types";

interface Props {
  value: PhraseFilterState;
  onChange: (next: PhraseFilterState) => void;
  /** 数据里实际出现的标签（降序）。 */
  tags: string[];
  /** 数据里实际出现的语言（空串 = 未标注）。 */
  languages: string[];
}

const SORT_OPTIONS: { value: PhraseSort; label: string }[] = [
  { value: "recent", label: at("assets.filter.sort.recent") },
  { value: "usage", label: at("assets.filter.sort.usage") },
  { value: "created", label: at("assets.filter.sort.created") },
];

function kindOptions() {
  return [
    { value: "all", label: at("assets.filter.kind.all") },
    ...PHRASE_KINDS.map((kind: PhraseKind) => ({
      value: kind,
      label: at(("assets.kind." + kind) as Parameters<typeof at>[0]),
    })),
  ];
}

/** 四个下拉共用同一份"占满一格"的宽度语义；具体列数由 CSS grid 决定。 */
const SELECT_CLASS = "resume-phrase-filters-select";

export default function PhraseFilters({ value, onChange, tags, languages }: Props) {
  const filter = normalizeFilter(value);
  const patch = (next: Partial<PhraseFilterState>) => onChange({ ...filter, ...next });
  const activeCount = activeFilterCount(filter);

  return (
    <div className="resume-phrase-filters">
      <Input.Search
        className="resume-phrase-filters-search"
        allowClear
        value={filter.keyword}
        placeholder={at("assets.filter.searchPlaceholder")}
        aria-label={at("assets.filter.search")}
        onChange={(event) => patch({ keyword: event.target.value })}
      />
      <div className="resume-phrase-filters-grid">
        <Select
          className={SELECT_CLASS}
          value={filter.kind}
          options={kindOptions()}
          aria-label={at("assets.filter.kind")}
          onChange={(kind) => patch({ kind })}
        />
        <Select
          className={SELECT_CLASS}
          value={filter.language}
          aria-label={at("assets.filter.language")}
          options={[
            { value: "all", label: at("assets.filter.language.all") },
            ...languages.map((language) => ({
              value: language,
              label:
                language === ""
                  ? at("assets.language.unknown")
                  : language === "zh-CN"
                    ? at("assets.language.zh-CN")
                    : language === "en-US"
                      ? at("assets.language.en-US")
                      : language,
            })),
          ]}
          onChange={(language) => patch({ language })}
        />
        <Select
          className={SELECT_CLASS}
          value={filter.tag}
          aria-label={at("assets.filter.tag")}
          options={[
            { value: "all", label: at("assets.filter.tag.all") },
            ...tags.map((tag) => ({ value: tag, label: tag })),
          ]}
          onChange={(tag) => patch({ tag })}
        />
        <Select
          className={SELECT_CLASS}
          value={filter.sort}
          options={SORT_OPTIONS}
          aria-label={at("assets.filter.sort")}
          onChange={(sort) => patch({ sort })}
        />
      </div>
      <div className="resume-phrase-filters-foot">
        <Button
          size="small"
          type="link"
          className="resume-phrase-filters-reset"
          disabled={isDefaultFilter(filter) || undefined}
          onClick={() => onChange(normalizeFilter(null))}
        >
          {at("assets.filter.reset")}
        </Button>
        {activeCount > 0 ? (
          <span className="resume-phrase-filters-active">
            {at("assets.filter.active", { count: activeCount })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
