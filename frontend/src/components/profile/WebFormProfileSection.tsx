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
import { Alert, Card, Empty, Skeleton, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getWebFormExtraProfile } from "../../api/webform";
import type {
  WebFormExtraEntry,
  WebFormExtraProfile,
  WebFormField,
  WebFormRepeatedGroup,
} from "../../types";
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

  const displayLabel = useCallback(
    (field: WebFormField): string => entries[field.key]?.label?.trim() || field.label,
    [entries],
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

  /** 查看态只显示**已填**的项——否则一屏空标签，用户找不到自己填过什么。 */
  const filledCount = useMemo(
    () => profile?.fields.filter((field) => values[field.key]?.trim()).length ?? 0,
    [profile, values],
  );
  const hasRepeatedValues = repeatedGroups.some((group) =>
    group.records.some((record) => Object.values(record.values).some((value) => value.trim())),
  );

  const totalCount = profile?.fields.length ?? 0;
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();

  /** 先筛选再渲染，避免每个分组里重复写一套查看态/编辑态判断。 */
  const filteredGrouped = useMemo(() => {
    return grouped
      .map(({ group, fields }) => ({
        group,
        fields: fields.filter((field) => {
          const value = values[field.key] ?? "";
          if (!editing && !value.trim()) return false;
          if (editing && showOnlyFilled && !value.trim()) return false;
          if (!normalizedSearch) return true;
          const haystack = `${group} ${displayLabel(field)} ${value}`.toLocaleLowerCase();
          return haystack.includes(normalizedSearch);
        }),
      }))
      .filter((entry) => entry.fields.length > 0);
  }, [displayLabel, editing, grouped, normalizedSearch, showOnlyFilled, values]);

  const handleRenameCustomField = (key: string, nextLabel: string): string | undefined => {
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
  };

  const handleDeleteCustomField = (key: string) => {
    setProfile((current) => {
      if (!current) return current;
      return { ...current, fields: current.fields.filter((field) => field.key !== key) };
    });
    onFieldDelete(key);
    setError("");
  };

  const handleAddCustomField = () => {
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
      matchable: false,
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
    onLoaded({ ...nextProfile, values, details });
    onChange(key, "");
    onFieldLabelChange(key, label);
    setCustomLabel("");
    setError("");
  };

  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;

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
        message="这一区只给「网申填表」用，不会进入简历"
        description="这里补充简历资料中没有的网申字段；网申填表会合并读取简历资料和这里的补充资料，但生成简历不会读取这里。证件、家庭与健康信息只存本机。"
      />

      <WebFormProfileToolbar
        editing={editing}
        filledCount={filledCount}
        totalCount={totalCount}
        searchTerm={searchTerm}
        showOnlyFilled={showOnlyFilled}
        onSearchChange={setSearchTerm}
        onToggleShowOnlyFilled={() => setShowOnlyFilled((current) => !current)}
      />

      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}

      <WebFormProfileRecords
        groups={repeatedGroups}
        editing={editing}
        saving={saving}
        onChange={onRepeatedGroupsChange}
      />

      {!loading && !error && filledCount === 0 && !hasRepeatedValues && !editing ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有填过。点右上角「编辑资料」即可补上网申表单常问的那些栏目"
        />
      ) : null}

      {(editing || filledCount > 0) && filteredGrouped.length === 0 && searchTerm.trim() ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的网申资料" />
      ) : null}

      {filteredGrouped.map(({ group, fields }) => {
        const groupAllFields = profile?.fields.filter((field) => field.group === group) ?? fields;
        return (
          <WebFormProfileGroup
            key={group}
            group={group}
            fields={fields}
            groupAllFields={groupAllFields}
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
