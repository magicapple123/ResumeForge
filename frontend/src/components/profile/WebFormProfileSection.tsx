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
 * ## 编辑/保存
 *
 * 跟随「我的资料」现有的流程：查看态只读、编辑态可改，保存由页面顶部的「保存全部资料」
 * 统一触发。**不用独立按钮**——但数据是另一次请求，所以那次保存要**两次都成功才算成功**
 * （见 ProfilePage 的 `submit`）。
 */
import { Alert, Card, Empty, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWebFormExtraProfile } from "../../api/webform";
import type {
  WebFormExtraEntry,
  WebFormExtraProfile,
  WebFormField,
  WebFormRepeatedGroup,
} from "../../types";
import PageSkeleton from "../common/PageSkeleton";
import WebFormProfileCustomFieldAdder from "./WebFormProfileCustomFieldAdder";
import WebFormProfileGroup from "./WebFormProfileGroup";
import { customFieldKey, isCustomField, normalizeFieldLabel } from "./WebFormProfileFieldUtils";
import WebFormProfileRecords from "./WebFormProfileRecords";
import WebFormProfileToolbar from "./WebFormProfileToolbar";

/** 编辑态的值由父组件持有（这样它能和资料表单一起提交）。 */
export type ExtraProfileValues = Record<string, string>;

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
}

export default function WebFormProfileSection({
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
}: Props) {
  const [profile, setProfile] = useState<WebFormExtraProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customLabel, setCustomLabel] = useState("");
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
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "「网申资料」加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // 只在挂载时拉一次；`onLoaded` 是稳定回调（父组件 useCallback）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // **前端可能比后端新**（后端没重启时这个字段还不存在），所以这里兜一下：
  // 缺了它只该少显示一个标记，不该让整页崩掉。
  const entries = useMemo(() => details ?? {}, [details]);

  /**
   * 展示名按 field.key 先算好一张表：字段名同时被「过滤 haystack」与「渲染」两处读，
   * 缓存后每字段只算一次，也顺带让 `displayLabel` 在击键时保持同一引用（entries / profile
   * 不变时），Group 的自定义比较器才不会被它打穿。
   */
  const displayLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const field of profile?.fields ?? []) {
      map.set(field.key, entries[field.key]?.label?.trim() || field.label);
    }
    return map;
  }, [entries, profile]);

  const displayLabel = useCallback(
    (field: WebFormField): string =>
      displayLabels.get(field.key) ?? (entries[field.key]?.label?.trim() || field.label),
    [displayLabels, entries],
  );

  /** 按分组切分，供分区展示（分组顺序来自后端目录）。 */
  const grouped = useMemo(() => {
    if (!profile) return [];
    return profile.groups
      .map((group) => ({
        group,
        fields: profile.fields.filter((field) => field.group === group),
      }))
      .filter((entry) => entry.fields.length > 0);
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
        group.records.some((record) => Object.values(record.values).some((value) => value.trim())),
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
      .filter((entry) => entry.fields.length > 0);
  }, [
    displayLabel,
    editing,
    fieldsByGroup,
    grouped,
    needsFilter,
    normalizedSearch,
    showOnlyFilled,
    values,
  ]);

  // 编辑态默认展示全部字段时，输入值变化不需要重新构造分组列表。
  // 这条快路径避免每次按键都执行 map/filter，并保持各组 fields 引用稳定。
  const visibleGroups = editing && !showOnlyFilled && !normalizedSearch ? grouped : filteredGrouped;

  const handleRenameCustomField = useCallback(
    (key: string, nextLabel: string): string | undefined => {
      const label = nextLabel.trim();
      if (!label) return "字段名不能为空";
      const duplicate = profile?.fields.some(
        (field) =>
          field.key !== key &&
          isCustomField(field) &&
          normalizeFieldLabel(displayLabel(field)) === normalizeFieldLabel(label),
      );
      if (duplicate) return "已经有同名自定义字段，请换一个名称";

      setProfile((current) => {
        if (!current) return current;
        return {
          ...current,
          fields: current.fields.map((field) => (field.key === key ? { ...field, label } : field)),
        };
      });
      onFieldLabelChange(key, label);
      setError("");
      return undefined;
    },
    [displayLabel, onFieldLabelChange, profile],
  );

  const handleDeleteCustomField = useCallback(
    (key: string) => {
      setProfile((current) => {
        if (!current) return current;
        return { ...current, fields: current.fields.filter((field) => field.key !== key) };
      });
      onFieldDelete(key);
      setError("");
    },
    [onFieldDelete],
  );

  // values/details 每击键都换新，会把 handleAddCustomField 每次重建。改用 ref 读最新值
  // （点击发生在渲染提交之后，ref 已是最新），把该回调的依赖收敛到稳定项。
  const addCustomFieldContextRef = useRef({ values, details });
  useEffect(() => {
    addCustomFieldContextRef.current = { values, details };
  });

  const handleAddCustomField = useCallback(() => {
    const label = customLabel.trim();
    const key = customFieldKey(label);
    if (!label || !key || key === "CUSTOM_") return;
    if (
      profile?.fields.some(
        (field) =>
          isCustomField(field) &&
          (field.key === key ||
            normalizeFieldLabel(displayLabel(field)) === normalizeFieldLabel(label)),
      )
    ) {
      setError("这个自定义字段已经存在");
      return;
    }
    const field: WebFormField = {
      key,
      label,
      group: "自定义",
      kind: "text",
      sensitive: false,
      matchable: true,
    };
    const nextProfile: WebFormExtraProfile = {
      ...(profile as WebFormExtraProfile),
      groups: profile?.groups.includes("自定义")
        ? profile.groups
        : [...(profile?.groups ?? []), "自定义"],
      fields: [...(profile?.fields ?? []), field],
    };
    setProfile(nextProfile);
    // onLoaded 会重置父组件的草稿：新增目录项时必须保留用户刚输入、尚未保存的值。
    const { values: latestValues, details: latestDetails } = addCustomFieldContextRef.current;
    onLoaded({ ...nextProfile, values: latestValues, details: latestDetails });
    onChange(key, "");
    onFieldLabelChange(key, label);
    setCustomLabel("");
    setError("");
  }, [customLabel, displayLabel, onChange, onFieldLabelChange, onLoaded, profile]);

  const toggleShowOnlyFilled = useCallback(() => setShowOnlyFilled((current) => !current), []);

  if (loading) return <PageSkeleton rows={4} card={false} />;

  return (
    <Card
      size="small"
      title="网申资料"
      extra={<Tag color="blue">网申填表专用</Tag>}
      style={{ marginTop: 16 }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title="这一区只给「网申填表」用，不会进入简历"
        description="这里补充简历资料中没有的网申字段；网申填表会合并读取简历资料和这里的补充资料，但生成简历不会读取这里。证件、家庭与健康信息只存本机。"
      />

      <WebFormProfileToolbar
        editing={editing}
        filledCount={filledCount}
        totalCount={totalCount}
        searchTerm={searchTerm}
        showOnlyFilled={showOnlyFilled}
        onSearchChange={setSearchTerm}
        onToggleShowOnlyFilled={toggleShowOnlyFilled}
      />

      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}

      <WebFormProfileRecords
        groups={repeatedGroups}
        editing={editing}
        saving={saving}
        showOnlyFilled={showOnlyFilled}
        searchTerm={committedSearchTerm}
        onChange={onRepeatedGroupsChange}
      />

      {!loading && !error && filledCount === 0 && !hasRepeatedValues && !editing ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有填过。点右上角「编辑资料」即可补上网申表单常问的那些栏目"
        />
      ) : null}

      {(editing || filledCount > 0) && visibleGroups.length === 0 && searchTerm.trim() ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的网申资料" />
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
          />
        );
      })}

      {editing ? (
        <WebFormProfileCustomFieldAdder
          value={customLabel}
          onChange={setCustomLabel}
          onAdd={handleAddCustomField}
        />
      ) : null}
    </Card>
  );
}
