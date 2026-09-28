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
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { getWebFormExtraProfile } from "../../api/webform";
import type { WebFormExtraEntry, WebFormExtraProfile, WebFormField } from "../../types";
import WebFormCustomFieldControls from "./WebFormCustomFieldControls";

const { TextArea } = Input;

/** 编辑态的值由父组件持有（这样它能和资料表单一起提交）。 */
export type ExtraProfileValues = Record<string, string>;

/** 三档的含义。界面上只给三个词，用户没法判断该选哪个，所以每档都要有说法。 */
const REUSE_META: Record<WebFormExtraEntry["reuse"], { label: string; hint: string }> = {
  general: { label: "通用", hint: "换哪家公司都成立，下次自动填" },
  scenario: { label: "场景", hint: "和投递渠道有关，下次自动填并标出来源" },
  once: { label: "本次", hint: "一次性的，只记下来、下次不自动填" },
};

/**
 * 自定义字段本身不参与通用的模糊匹配；只有标签与唯一预设字段显示名完全相同时，
 * 实时逐框建议才会提供该字段的值。其余情况仍应提示用户手动挑选，避免误填。
 */
const CUSTOM_HINT = "自定义字段默认不参与模糊匹配；唯一同名预设字段可逐框建议，其余需手动挑选";

interface Props {
  editing: boolean;
  saving: boolean;
  values: ExtraProfileValues;
  /** 每条的来源与档位。**学到的必须标出来**——那是程序推断的，用户有权知道它从哪来。 */
  details: Record<string, WebFormExtraEntry>;
  onChange: (key: string, value: string) => void;
  onReuseChange: (key: string, reuse: WebFormExtraEntry["reuse"]) => void;
  onFieldLabelChange: (key: string, label: string) => void;
  onFieldDelete: (key: string) => void;
  /** 目录加载完成时把字段清单交回父组件（父组件据此渲染与提交）。 */
  onLoaded: (profile: WebFormExtraProfile) => void;
}

function customFieldKey(label: string): string {
  return (
    "CUSTOM_" +
    label
      .trim()
      .replace(/\s+/g, "")
      .replace(/[ \t\r\n\-—–:：·.、,，*＊[\]【】()（）<>《》"'“”‘’]/g, "")
      .slice(0, 40)
  );
}

function isCustomField(field: WebFormField): boolean {
  return field.key.startsWith("CUSTOM_");
}

function normalizeFieldLabel(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** 一个字段该用哪种输入控件。`kind` 由后端目录给出。 */
function FieldInput({
  field,
  value,
  disabled,
  onChange,
  label,
}: {
  field: WebFormField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  label?: string;
}) {
  if (field.kind === "longtext") {
    return (
      <TextArea
        value={value}
        disabled={disabled}
        autoSize={{ minRows: 2, maxRows: 5 }}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label || field.label}
      />
    );
  }
  return (
    <Input
      value={value}
      disabled={disabled}
      type={field.kind === "tel" ? "tel" : field.kind === "email" ? "email" : "text"}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label || field.label}
    />
  );
}

export default function WebFormProfileSection({
  editing,
  saving,
  values,
  details,
  onChange,
  onReuseChange,
  onFieldLabelChange,
  onFieldDelete,
  onLoaded,
}: Props) {
  const [profile, setProfile] = useState<WebFormExtraProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customLabel, setCustomLabel] = useState("");

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
    () => Object.values(values).filter((value) => value.trim()).length,
    [values],
  );

  // **前端可能比后端新**（后端没重启时这个字段还不存在），所以这里兜一下：
  // 缺了它只该少显示一个标记，不该让整页崩掉。
  const entries = details ?? {};

  const displayLabel = (field: WebFormField): string =>
    entries[field.key]?.label?.trim() || field.label;

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
        description="校招网申表单问的东西比简历多（四六级分数、档案所在地、紧急联系人、身高…），这里补的是简历里没有的那些。生成简历时不读这里的内容。含证件、家庭与健康的信息只存本机。"
      />

      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}

      {!loading && !error && filledCount === 0 && !editing ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有填过。点右上角「编辑资料」即可补上网申表单常问的那些栏目"
        />
      ) : null}

      {grouped.map(({ group, fields }) => {
        // 查看态：整组都空就不渲染，避免一屏空标题。
        const visible = editing ? fields : fields.filter((field) => values[field.key]?.trim());
        if (!visible.length) return null;
        return (
          <div key={group} style={{ marginBottom: 12 }}>
            <Typography.Text strong>{group}</Typography.Text>
            <Row gutter={[12, 8]} style={{ marginTop: 6 }}>
              {visible.map((field) => (
                <Col key={field.key} xs={24} md={12} xl={8}>
                  <div style={{ marginBottom: 4 }}>
                    {isCustomField(field) ? (
                      <WebFormCustomFieldControls
                        label={displayLabel(field)}
                        editing={editing}
                        saving={saving}
                        onRename={(label) => handleRenameCustomField(field.key, label)}
                        onDelete={() => handleDeleteCustomField(field.key)}
                      />
                    ) : (
                      <Typography.Text type="secondary">{field.label}</Typography.Text>
                    )}
                    {/* **学到的必须标出来**：那是程序在填表时推断的，不是用户录的。
                        不标的话"这个值我什么时候填过"会变成一个没人能回答的问题。 */}
                    {entries[field.key]?.source === "learned" ? (
                      <Tooltip title="填表时你填了这个框、而简历通里没有，于是问你要不要记住">
                        <Tag style={{ marginLeft: 6 }} color="purple">
                          填表时学到的
                        </Tag>
                      </Tooltip>
                    ) : null}
                    {/* 自定义字段（清单外的）：标出来，并说明它不参与通用模糊匹配。
                        唯一同名预设字段的精确对应由实时取数层处理；前端不自行判断字段键。 */}
                    {field.matchable === false ? (
                      <Tooltip title="这是你填表时攒下来的、不在预设清单里的字段。它会存下来、能手填、能在「换个资料…」里搜到；本身不参与模糊匹配，只有标签与唯一预设字段显示名完全相同，才会作为该字段的逐框候选，其余情况请手动挑选。">
                        <Tag style={{ marginLeft: 6 }} color="cyan">
                          自定义字段
                        </Tag>
                      </Tooltip>
                    ) : null}
                  </div>
                  {editing ? (
                    <FieldInput
                      field={field}
                      value={values[field.key] ?? ""}
                      disabled={saving}
                      label={displayLabel(field)}
                      onChange={(value) => onChange(field.key, value)}
                    />
                  ) : (
                    <Typography.Text>{values[field.key]}</Typography.Text>
                  )}
                  {/* 档位只在**有值、且查看态**时给：编辑态里这个值可能正要被清空，
                      对一条空项问"下次还填吗"没有意义。 */}
                  {!editing && values[field.key]?.trim() ? (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        下次：{" "}
                      </Typography.Text>
                      <Tag.CheckableTag
                        checked={(entries[field.key]?.reuse ?? "general") === "general"}
                        onChange={() => onReuseChange(field.key, "general")}
                      >
                        通用
                      </Tag.CheckableTag>
                      <Tag.CheckableTag
                        checked={entries[field.key]?.reuse === "scenario"}
                        onChange={() => onReuseChange(field.key, "scenario")}
                      >
                        场景
                      </Tag.CheckableTag>
                      <Tag.CheckableTag
                        checked={entries[field.key]?.reuse === "once"}
                        onChange={() => onReuseChange(field.key, "once")}
                      >
                        本次
                      </Tag.CheckableTag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {" "}
                        {field.matchable === false
                          ? CUSTOM_HINT
                          : REUSE_META[entries[field.key]?.reuse ?? "general"].hint}
                      </Typography.Text>
                    </div>
                  ) : null}
                </Col>
              ))}
            </Row>
          </div>
        );
      })}

      {editing ? (
        <Space.Compact style={{ width: "100%", marginTop: 4 }}>
          <Input
            value={customLabel}
            onChange={(event) => setCustomLabel(event.target.value)}
            onPressEnter={handleAddCustomField}
            placeholder="字段名称，如：实验室、导师姓名"
            maxLength={40}
            aria-label="新增自定义网申字段名称"
          />
          <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddCustomField}>
            添加
          </Button>
        </Space.Compact>
      ) : null}
    </Card>
  );
}
