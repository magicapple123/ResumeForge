// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产库的筛选条（W17）：关键词 + 类型 + 语言 + 岗位标签 + 排序 + 清空。
 *
 * **受控组件**：筛选状态由 `PhraseLibraryPanel` 持有（这样"清空筛选"与空态按钮能改同一份状态）。
 * 选项来自数据本身（`collectTags` / `collectLanguages`），不写死枚举——用户收藏了什么标签，
 * 下拉里就有什么，避免"筛选里有一个永远没有结果的选项"。
 */
import { Button, Col, Input, Row, Select, Space } from "antd";
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

export default function PhraseFilters({ value, onChange, tags, languages }: Props) {
  const filter = normalizeFilter(value);
  const patch = (next: Partial<PhraseFilterState>) => onChange({ ...filter, ...next });
  const activeCount = activeFilterCount(filter);

  return (
    <Row gutter={[8, 8]} align="middle">
      <Col xs={24} md={8}>
        <Input.Search
          allowClear
          value={filter.keyword}
          placeholder={at("assets.filter.searchPlaceholder")}
          aria-label={at("assets.filter.search")}
          onChange={(event) => patch({ keyword: event.target.value })}
        />
      </Col>
      <Col xs={12} md={4}>
        <Select
          style={{ width: "100%" }}
          value={filter.kind}
          options={kindOptions()}
          aria-label={at("assets.filter.kind")}
          onChange={(kind) => patch({ kind })}
        />
      </Col>
      <Col xs={12} md={4}>
        <Select
          style={{ width: "100%" }}
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
      </Col>
      <Col xs={12} md={4}>
        <Select
          style={{ width: "100%" }}
          value={filter.tag}
          aria-label={at("assets.filter.tag")}
          options={[
            { value: "all", label: at("assets.filter.tag.all") },
            ...tags.map((tag) => ({ value: tag, label: tag })),
          ]}
          onChange={(tag) => patch({ tag })}
        />
      </Col>
      <Col xs={12} md={4}>
        <Select
          style={{ width: "100%" }}
          value={filter.sort}
          options={SORT_OPTIONS}
          aria-label={at("assets.filter.sort")}
          onChange={(sort) => patch({ sort })}
        />
      </Col>
      <Col span={24}>
        <Space size={8} wrap>
          <Button
            size="small"
            type="link"
            disabled={isDefaultFilter(filter) || undefined}
            onClick={() => onChange(normalizeFilter(null))}
          >
            {at("assets.filter.reset")}
          </Button>
          {activeCount > 0 ? (
            <span style={{ color: "var(--rf-text-secondary)", fontSize: 12 }}>
              {at("assets.filter.active", { count: activeCount })}
            </span>
          ) : null}
        </Space>
      </Col>
    </Row>
  );
}
