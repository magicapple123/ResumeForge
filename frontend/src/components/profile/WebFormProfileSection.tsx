// SPDX-License-Identifier: Apache-2.0
/**
 * 「网申资料」：用户专门为网申表单录的补充资料。
 *
 * ## 为什么它在这里，而不是并进上面的资料表单
 *
 * 用户的要求是"这一项要跟简历资料分开，用于补充简历资料里没有的内容，专门供网申填表模块
 * 读取，**生成简历模块默认不读这里的信息**"。所以它：
 *
 * - **存独立的表**（`web_form_profile_entry`），走 `/api/webform/extra-profile`，
 *   不经过 `profile.ts`；
 * - **不进 `ProfileSectionStack`**（那个栈是可拖拽排序的简历资料分区，且后端按
 *   `PROFILE_SECTION_KEYS` 归一化 `section_order`，不认识的键会被**静默丢弃**——
 *   混进去会让分区顺序看起来莫名其妙地变了）。
 *
 * ## 数据形状为什么是"键值对"
 *
 * 字段清单由后端 `services/webform/fields.py` 下发（`GET /api/webform/extra-profile`），
 * 前端**不写死字段名**。这样加字段只改后端一处，这里自动多出一个输入框。
 *
 * ## 「自定义」分组空着也要显示
 *
 * 用户要求"默认有一个空的自定义板块，可以在里面加自定义字段"。所以这个组不看有没有字段
 * （见下面的 `grouped` / `filteredGrouped`），而"添加自定义字段"的输入框就长在这张卡片的
 * 底部（`WebFormProfileCustomGroupFooter`），添加逻辑仍只有一份（`useWebFormCustomFields`）。
 *
 * ## 编辑/保存
 *
 * 跟随「我的资料」现有的流程：查看态只读、编辑态可改，保存由页面顶部的「保存全部资料」
 * 统一触发。**不用独立按钮**——但数据是另一次请求，所以那次保存要**两次都成功才算成功**
 * （见 ProfilePage 的 `submit`）。
 */
import { Card, Tag } from "antd";
import EmptyState from "../common/EmptyState";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { getWebFormExtraProfile } from "../../api/webform";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type {
  WebFormExtraEntry,
  WebFormExtraProfile,
  WebFormField,
  WebFormRepeatedGroup,
} from "../../types";
import type { RecognitionReviewRow } from "./RecognitionReviewList";
import PageSkeleton from "../common/PageSkeleton";
import WebFormProfileCustomFieldAdder from "./WebFormProfileCustomFieldAdder";
import WebFormProfileCustomGroupFooter from "./WebFormProfileCustomGroupFooter";
import WebFormProfileGroup from "./WebFormProfileGroup";
import WebFormProfileRecords from "./WebFormProfileRecords";
import {
  WebFormProfileEmpty,
  WebFormProfileLoadError,
  WebFormProfileNotice,
} from "./WebFormProfileStates";
import { WEBFORM_CUSTOM_GROUP } from "../../features/webform/groupIdentity";
import { webformFieldLabel } from "../../features/webform/webformFieldLabels";
import WebFormProfileToolbar from "./WebFormProfileToolbar";
import { useWebFormCustomFields } from "./useWebFormCustomFields";
import type { ExtraProfileValues } from "./useWebFormCustomFields";

/** 编辑态的值由父组件持有（这样它能和资料表单一起提交）。改由 hook 模块给出，见其注释。 */
export type { ExtraProfileValues } from "./useWebFormCustomFields";

/** 暴露给宿主的命令式能力（项 12：校对结果要写进这里自持的字段清单）。 */
export interface WebFormProfileSectionHandle {
  /** 写入校对后的识别结果。**顺序不能反**：新字段先建、名字先落，再写值（否则会闪一帧
   *  "有值没名字"的字段）。 */
  applyParsedRows: (rows: RecognitionReviewRow[]) => void;
}

interface Props {
  editing: boolean;
  saving: boolean;
  values: ExtraProfileValues;
  /** 每条的来源与档位。**学到的必须标出来**——那是程序推断的，用户有权知道它从哪来。 */
  details: Record<string, WebFormExtraEntry>;
  onChange: (key: string, value: string) => void;
  onFieldLabelChange: (key: string, label: string) => void;
  onFieldDelete: (key: string) => void;
  repeatedGroups: WebFormRepeatedGroup[];
  onRepeatedGroupsChange: (groups: WebFormRepeatedGroup[]) => void;
  /** 目录加载完成时把字段清单交回父组件（父组件据此渲染与提交）。 */
  onLoaded: (profile: WebFormExtraProfile) => void;
  onRequestEdit: () => void;
  /** 打开「粘贴文本识别」（项 12）。只有编辑态会渲染入口。 */
}

const WebFormProfileSection = forwardRef<WebFormProfileSectionHandle, Props>(
  function WebFormProfileSection(
    {
      editing,
      saving,
      values,
      details,
      onChange,
      onFieldLabelChange,
      onFieldDelete,
      repeatedGroups,
      onRepeatedGroupsChange,
      onLoaded,
      onRequestEdit,
    }: Props,
    ref,
  ) {
    const locale = useLocale();
    const [profile, setProfile] = useState<WebFormExtraProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [searchTerm, setSearchTerm] = useState("");
    // 搜索防抖：输入静置 300ms 才提交。搜索会改变字段集合（remount），每敲一个字符
    // 重挂载一批控件的代价太高；输入框仍即时回显（searchTerm），只是过滤动作延后。
    const [committedSearchTerm, setCommittedSearchTerm] = useState("");
    useEffect(() => {
      const timer = window.setTimeout(() => setCommittedSearchTerm(searchTerm.trim()), 300);
      return () => window.clearTimeout(timer);
    }, [searchTerm]);
    const [showOnlyFilled, setShowOnlyFilled] = useState(false);
    useEffect(() => {
      let cancelled = false;
      void getWebFormExtraProfile()
        .then((data) => {
          if (cancelled) return;
          setProfile(data);
          onLoaded(data);
        })
        .catch(() => {
          if (cancelled) return;
          setError(t("profileLibrary.webform.sectionLoadFailed"));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
      // The directory loads on mount and retries only after an explicit user action.
    }, [loadAttempt, onLoaded]);
    const retryLoad = () => {
      setError("");
      setLoading(true);
      setLoadAttempt((attempt) => attempt + 1);
    };
    // **前端可能比后端新**（后端没重启时这个字段还不存在），所以这里兜一下：
    // 缺了它只该少显示一个标记，不该让整页崩掉。
    const entries = useMemo(() => details ?? {}, [details]);
    /**
     * 展示名按 field.key 先算好一张表：字段名同时被「过滤 haystack」与「渲染」两处读，
     * 缓存后每字段只算一次，也顺带让 `displayLabel` 在击键时保持同一引用（entries / profile
     * 不变时），Group 的自定义比较器才不会被它打穿。
     */
    const displayLabels = useMemo(() => {
      void locale;
      const map = new Map<string, string>();
      for (const field of profile?.fields ?? []) {
        map.set(
          field.key,
          entries[field.key]?.label?.trim() || webformFieldLabel(field.key, field.label),
        );
      }
      return map;
    }, [entries, locale, profile]);
    const displayLabel = useCallback(
      (field: WebFormField): string =>
        displayLabels.get(field.key) ??
        (entries[field.key]?.label?.trim() || webformFieldLabel(field.key, field.label)),
      [displayLabels, entries],
    );
    /** 自定义字段的增 / 改名 / 删（唯一实现，见 hook 文件的注释）。 */
    const {
      customLabel,
      setCustomLabel,
      addCustomField,
      handleAddCustomField,
      handleRenameCustomField,
      handleDeleteCustomField,
    } = useWebFormCustomFields({
      profile,
      setProfile,
      values,
      details,
      displayLabel,
      onChange,
      onFieldLabelChange,
      onFieldDelete,
      onLoaded,
      onError: setError,
    });
    /**
     * 按分组切分，供分区展示（分组顺序来自后端目录）。
     *
     * 「自定义」组**空着也留着**：它默认就是一张空卡片。后端的 `list_extra_fields` 现在
     * 无条件给这个组，这里再兜一次——前端可能比后端新（后端没重启时目录里还没有它），
     * 缺了它只该少一张卡片，不该让用户没地方加字段。
     */
    const grouped = useMemo(() => {
      if (!profile) return [];
      const groupNames = profile.groups.includes(WEBFORM_CUSTOM_GROUP)
        ? profile.groups
        : [...profile.groups, WEBFORM_CUSTOM_GROUP];
      return groupNames
        .map((group) => ({
          group,
          fields: profile.fields.filter((field) => field.group === group),
        }))
        .filter((entry) => entry.fields.length > 0 || entry.group === WEBFORM_CUSTOM_GROUP);
    }, [profile]);
    /**
     * 查看态只显示**已填**的项——否则一屏空标签，用户找不到自己填过什么。
     *
     * 总数与「每组已填数」合并成**一遍**扫描：以前总数扫一遍全字段、Group 内部又各扫一遍
     * 本组字段，击键时叠加成 O(字段数 × 组数)。现在一次 O(字段数) 同时产出两者。
     */
    const filledStats = useMemo(() => {
      const byGroup = new Map<string, number>();
      let total = 0;
      if (!profile || editing) return { total, byGroup };
      for (const field of profile.fields) {
        if (!values[field.key]?.trim()) continue;
        total += 1;
        byGroup.set(field.group, (byGroup.get(field.group) ?? 0) + 1);
      }
      return { total, byGroup };
    }, [editing, profile, values]);
    // 编辑态输入时不刷新全局计数：计数只用于查看态和筛选工具栏，避免每个字符扫描整份资料。
    const filledCount = editing ? 0 : filledStats.total;
    // 击键时 repeatedGroups 引用不变，这条 memo 让该项计算跟着跳过。
    const hasRepeatedValues = useMemo(
      () =>
        repeatedGroups.some((group) =>
          group.records.some((record) =>
            Object.values(record.values).some((value) => value.trim()),
          ),
        ),
      [repeatedGroups],
    );

    const totalCount = profile?.fields.length ?? 0;
    const normalizedSearch = committedSearchTerm.toLocaleLowerCase();
    // 每个分组的全量字段清单：按 profile 一次建好（数组引用稳定），
    // Group 的 memo 才不会被「每 render 重建的 groupAllFields 数组」打穿。
    const fieldsByGroup = useMemo(() => {
      const map = new Map<string, WebFormField[]>();
      if (!profile) return map;
      for (const field of profile.fields) {
        const list = map.get(field.group);
        if (list) list.push(field);
        else map.set(field.group, [field]);
      }
      return map;
    }, [profile]);
    /**
     * 是否需要真正过滤。查看态永远要隐藏空字段；编辑态只有开了「只看已填」或输入了搜索词才需要。
     * 都不需要时，`filteredGrouped` 直接复用 `fieldsByGroup` 里**引用稳定**的数组，
     * Group 的自定义比较器才能对未编辑的组整体 bail。
     */
    const needsFilter = !editing || showOnlyFilled || Boolean(normalizedSearch);
    /**
     * 空的「自定义」组只在**没有筛选意图**时保留：它是"加字段"的入口，藏起来用户就没地方
     * 加；而搜索时保留它，会让"没有匹配"变成一张空卡片，看不出搜索其实没命中。
     */
    const keepEmptyCustomGroup = !showOnlyFilled && !normalizedSearch;
    /** 先筛选再渲染，避免每个分组里重复写一套查看态/编辑态判断。 */
    const filteredGrouped = useMemo(() => {
      return grouped
        .map(({ group, fields }) => {
          if (!needsFilter) {
            return { group, fields: fieldsByGroup.get(group) ?? fields };
          }
          return {
            group,
            fields: fields.filter((field) => {
              const value = values[field.key] ?? "";
              if (!editing && !value.trim()) return false;
              if (editing && showOnlyFilled && !value.trim()) return false;
              if (!normalizedSearch) return true;
              const haystack = `${group} ${displayLabel(field)} ${value}`.toLocaleLowerCase();
              return haystack.includes(normalizedSearch);
            }),
          };
        })
        .filter(
          (entry) =>
            entry.fields.length > 0 ||
            (entry.group === WEBFORM_CUSTOM_GROUP && keepEmptyCustomGroup),
        );
    }, [
      displayLabel,
      editing,
      fieldsByGroup,
      grouped,
      keepEmptyCustomGroup,
      needsFilter,
      normalizedSearch,
      showOnlyFilled,
      values,
    ]);
    // 编辑态默认展示全部字段时，输入值变化不需要重新构造分组列表。
    // 这条快路径避免每次按键都执行 map/filter，并保持各组 fields 引用稳定。
    const visibleGroups =
      editing && !showOnlyFilled && !normalizedSearch ? grouped : filteredGrouped;

    const customFieldCount = fieldsByGroup.get(WEBFORM_CUSTOM_GROUP)?.length ?? 0;
    /**
     * 「自定义」卡片底部的那一块：空态提示 + 编辑态的添加输入框。
     *
     * **必须 `useMemo` 固定引用**：`WebFormProfileGroup` 的判等按引用比较 `footer`，
     * 每 render 新建一个元素会让这张卡片在每次击键时整块重渲（memo 形同虚设）。
     */
    const customGroupFooter = useMemo(
      () => (
        <WebFormProfileCustomGroupFooter
          empty={customFieldCount === 0}
          editing={editing}
          value={customLabel}
          onChange={setCustomLabel}
          onAdd={handleAddCustomField}
        />
      ),
      [customFieldCount, customLabel, editing, handleAddCustomField, setCustomLabel],
    );

    useImperativeHandle(
      ref,
      () => ({
        applyParsedRows: (rows: RecognitionReviewRow[]) => {
          for (const row of rows) {
            if (row.isNew) {
              // 用户没勾的新字段不写入（D21：目录外的字段必须逐条确认）。
              if (!row.selected) continue;
              const key = addCustomField(row.label, row.id);
              if (!key) continue;
              // 名字已在 `addCustomField` 里落过，这里只写值（顺序：先名字、后值）。
              onChange(key, row.value);
              continue;
            }
            // 目录内的行：`id` 就是字段 key。
            onChange(row.id, row.value);
          }
        },
      }),
      [addCustomField, onChange],
    );

    const toggleShowOnlyFilled = useCallback(() => setShowOnlyFilled((current) => !current), []);

    if (loading) return <PageSkeleton rows={4} card={false} />;

    return (
      <Card
        size="small"
        title={t("profileLibrary.tab.webform")}
        extra={<Tag color="blue">{t("profileLibrary.webform.sectionTag")}</Tag>}
        style={{ marginTop: 16 }}
      >
        <WebFormProfileNotice />

        <WebFormProfileToolbar
          editing={editing}
          filledCount={filledCount}
          totalCount={totalCount}
          searchTerm={searchTerm}
          showOnlyFilled={showOnlyFilled}
          onSearchChange={setSearchTerm}
          onToggleShowOnlyFilled={toggleShowOnlyFilled}
        />

        {error ? (
          <WebFormProfileLoadError description={error} onRetry={retryLoad} retrying={loading} />
        ) : null}

        <WebFormProfileRecords
          groups={repeatedGroups}
          editing={editing}
          saving={saving}
          showOnlyFilled={showOnlyFilled}
          searchTerm={committedSearchTerm}
          onChange={onRepeatedGroupsChange}
        />

        {!loading && !error && filledCount === 0 && !hasRepeatedValues && !editing ? (
          <WebFormProfileEmpty onEdit={onRequestEdit} />
        ) : null}

        {(editing || filledCount > 0) && visibleGroups.length === 0 && searchTerm.trim() ? (
          <EmptyState inline description={t("profileLibrary.webform.sectionEmptySearch")} />
        ) : null}

        {visibleGroups.map(({ group, fields }) => {
          // 全量清单来自 fieldsByGroup（引用稳定），不在这里每 render 重新 filter。
          const groupAllFields = fieldsByGroup.get(group) ?? fields;
          return (
            <WebFormProfileGroup
              key={group}
              group={group}
              fields={fields}
              groupAllFields={groupAllFields}
              filledCount={editing ? 0 : (filledStats.byGroup.get(group) ?? 0)}
              editing={editing}
              saving={saving}
              values={values}
              entries={entries}
              displayLabel={displayLabel}
              onChange={onChange}
              onRename={handleRenameCustomField}
              onDelete={handleDeleteCustomField}
              footer={group === WEBFORM_CUSTOM_GROUP ? customGroupFooter : undefined}
            />
          );
        })}

        {/*
          筛选态（只看已填 / 搜索词）下「自定义」卡片可能整张被过滤掉，而添加输入框长在那张
          卡片里——于是正在编辑的用户会突然找不到加字段的入口。这里补一个**只在自定义卡片
          不可见时**出现的兜底输入框：卡片可见时由它的 footer 承担，两者不会同时出现。
        */}
        {editing && !visibleGroups.some((entry) => entry.group === WEBFORM_CUSTOM_GROUP) ? (
          <WebFormProfileCustomFieldAdder
            value={customLabel}
            onChange={setCustomLabel}
            onAdd={handleAddCustomField}
          />
        ) : null}
      </Card>
    );
  },
);

export default WebFormProfileSection;
