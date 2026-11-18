// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目排版」面板（W07 对象级 L5；Q12 引入作用范围，Q14 接收「固定当前样式」）。
 *
 * ## 作用范围（Q12）
 *
 * 顶部段控「整条 / 条目头 / 正文 / 灰字」：整条写 `format_config.objects[<id>]`（兼容旧
 * 数据、不迁移），其余三个范围写 `object_roles["<id>:<角色>"]`。行清单随范围过滤（来自
 * 角色白名单，见 `features/resume/layout/entryStyleScopes`），不是手写第二份清单。
 *
 * 从纸面点字段进来时按位置自动预选（title → 条目头、body → 正文、meta/lead/trail → 灰字，
 * 由宿主用 `scopeForDocumentPath` 推出来传 `defaultScope`）；用户手动选过的范围在同一
 * 纸面路径上保持不动，路径一变自动回到新字段推出的范围（与文字级别同一套交互）。
 *
 * ## 与「文字级别」的关系
 *
 * 级别管字号比例 / 加粗 / 段前段后四项，本面板只列级别管不到的属性；两边写同一份域数据，
 * 但键集合不相交，改一边不会把另一边冲掉。
 *
 * ## 固定当前样式（Q14）
 *
 * 「固定这条的当前样式」放在面板底部，与恢复成对；按**当前作用范围**执行（整条 → objects，
 * 子范围 → object_roles）。写入由宿主（`onFreeze`）完成，本组件只管把范围传出去。
 */
import { BgColorsOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Segmented, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumeEntry } from "../../../types/resumeDocument";
import type { ResumePreviewHandle } from "../preview/ResumePreview";
import { writeLiveProbe } from "../preview/liveProbeRegistry";
import { t } from "../../../i18n";
import { styleProbeCss } from "../../../utils/resumeFormatProbe";
import { STYLE_PROP_LABELS, type StylePropKey } from "../../../utils/resumeStyleParams";
import {
  ENTRY_STYLE_SCOPES,
  ENTRY_STYLE_SCOPE_HINTS,
  ENTRY_STYLE_SCOPE_LABELS,
  ENTRY_STYLE_SCOPE_SOURCES,
  entryStyleAvailability,
  entryStyleScopeProps,
  entryStyleScopeRole,
  type EntryStyleScope,
} from "./entryStyleScopes";
import { readStyleCatalog, templateRoleDefaults } from "./styleCatalogExtensions";
import {
  clearObject,
  clearObjectRole,
  readObjectRoleStyle,
  readObjectStyle,
  readStyleDomains,
  resolvedPropValue,
  roleBaseRatio,
  storedStyleValue,
  styleSourceOf,
  withObjectProp,
  withObjectRoleProp,
  type ResumeStyleValue,
} from "./styleOverrides";
import StyleValueRow from "./StyleValueRow";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeRoleKey } from "./styleCatalog";
import { groupStyleRows, type ObjectStyleGroupId } from "./objectStyleGroups";

interface Props {
  layout: ResumeLayout;
  catalog?: ResumeTemplateCatalog;
  /** 选中对象的稳定 id；空 = 未选中。 */
  objectId: string | null;
  /** 显示名（条目名），空时用"未命名条目"。 */
  objectLabel?: string;
  /** 当前聚焦条目：用来判断"有没有日期/灰字""正文有没有要点"（可缺省 = 不隐藏任何行）。 */
  entry?: ResumeEntry | null;
  /** 纸面上最后点中的字段路径：作用范围跟随它（Q12）；不传 = 固定默认范围。 */
  pickedPath?: string | null;
  /** 宿主从纸面路径推出的默认范围（`scopeForDocumentPath`）；缺省 = 整条。 */
  defaultScope?: EntryStyleScope;
  fieldRole?: ResumeRoleKey;
  /**
   * QW-6：页眉字段（`header.{id}`）。传入时面板固定为「字段值 / 字段名」两个目标，
   * 没有范围切换——页眉没有"整条 / 条目头 / 正文 / 灰字"这几层。
   */
  headerField?: { id: string; label: string; hasLabel?: boolean } | null;
  /** #7：右键浮层里锁定范围——不提供范围切换（浮层只改右键命中那一块）。 */
  lockScope?: boolean;
  /**
   * I-21：把行折成「文字与颜色 / 行距与缩进 / 列表与对齐 / 日期与字距」四组，一次只
   * 展开一组（见 `objectStyleGroups.ts`）。只给右键浮层用：那里受点击点下方的
   * 视口空间限制，平铺 536px 会把触发内容压住；左栏参数面板有纵向空间，保持平铺。
   */
  collapsibleGroups?: boolean;
  disabled?: boolean;
  previewRef?: RefObject<ResumePreviewHandle | null>;
  onChange: (layout: ResumeLayout) => void;
  /** Q14：把当前范围的生效值固定成显式覆盖（宿主负责落库）。 */
  onFreeze?: (scope: EntryStyleScope) => void;
}

export default function ObjectStylePanel({
  layout,
  catalog,
  objectId,
  objectLabel,
  entry = null,
  pickedPath = null,
  defaultScope = "object",
  fieldRole = "body",
  headerField = null,
  lockScope = false,
  collapsibleGroups = false,
  disabled = false,
  previewRef,
  onChange,
  onFreeze,
}: Props) {
  useLocale();
  // 手动选择带"当时那条纸面路径"：路径一变就失效，回到新字段推出的范围。
  const [manual, setManual] = useState<{ path: string | null; scope: EntryStyleScope } | null>(
    null,
  );
  // I-28：单字段作用域下再分"字段值 / 字段名"。字段名走 `field_label` 角色，
  // **不能**复用默认的 `fieldRole`（那是 body/meta，会把字段名样式悄悄写成正文）。
  const [fieldTarget, setFieldTarget] = useState<"value" | "label">("value");
  /**
   * I-21：分组手风琴的展开态。三态是刻意的——`auto` = 默认展开第一组（换作用范围时回到
   * 这里）、`none` = 用户把当前组也收起了、其余 = 用户点开的那一组。只有一个 state，
   * 所以"展开另一组"天生是**替换**：高度不随点击累积。
   */
  const [openGroup, setOpenGroup] = useState<ObjectStyleGroupId | "auto" | "none">("auto");
  const [groupsKey, setGroupsKey] = useState<string | null>(null);
  const setManualScope = (next: { path: string | null; scope: EntryStyleScope }) => {
    if (lockScope) return;
    setManual(next);
  };
  /**
   * I-15：实时探针按属性累积。
   *
   * `setLiveProbe` 是**单条覆盖**（整段 `style.textContent = css`）：先调字号再调颜色，
   * 第二条会把第一条顶掉，表现就是"刚调好的字号在 600ms 内回退"。所以这里按 prop 各存
   * 一份，每次变更后合并成一条串整体写入。
   */
  const probeByProp = useRef(new Map<StylePropKey, string>());
  // 换目标（字段 / 作用范围 / 字段值·字段名）或卸载时把上一个目标的探针撤掉，
  // 否则旧对象的规则会留在纸面（"双份样式"：探针 + 正式）。
  useEffect(
    () => () => {
      probeByProp.current.clear();
      if (previewRef?.current) previewRef.current.setLiveProbe("");
      else writeLiveProbe("");
    },
    [fieldTarget, headerField?.id, manual, objectId, previewRef],
  );
  if (!objectId) {
    return <Typography.Text type="secondary">{t("typography.object.empty")}</Typography.Text>;
  }

  const headerMode = headerField !== null;
  const targetId = headerMode ? `header.${headerField.id}` : objectId;
  const scope: EntryStyleScope = headerMode
    ? "field"
    : manual && manual.path === pickedPath
      ? manual.scope
      : defaultScope;
  const resolvedFieldRole: ResumeRoleKey =
    scope === "field" && fieldTarget === "label" ? "field_label" : fieldRole;
  const scopeRole = entryStyleScopeRole(scope, resolvedFieldRole);
  // 整条范围沿用"按正文继承"的既有读法（四出口的 effective(role, object_id) 同口径）。
  const role = scopeRole ?? "body";
  const config = layout.format_config;
  const domains = readStyleDomains(config);
  const styleCatalog = readStyleCatalog(catalog);
  const defaults = templateRoleDefaults(styleCatalog, layout.template, role);
  const ownStyle = scopeRole
    ? readObjectRoleStyle(domains, targetId, scopeRole)
    : readObjectStyle(domains, targetId);
  const ownCount = Object.keys(ownStyle).length;
  // 对象级字号同样是"乘在对象基准（=1.0）上的系数"，显示值需要乘回基准。
  const baseRatio = roleBaseRatio(defaults);
  const basePx = catalog?.font_scales?.find((scale) => scale.name === layout.font_scale)?.base_px;
  const name = headerMode
    ? headerField.label.trim() || t("typography.object.untitled")
    : objectLabel?.trim() || t("typography.object.untitled");
  const scopeLabelKey = headerMode
    ? ("typography.headerStyle.scope" as const)
    : ENTRY_STYLE_SCOPE_LABELS[scope];
  // 只有拿到条目内容时才隐藏"无关项"；目录/宿主没传时不臆断（否则行会凭空消失）。
  const known = entry !== null;
  const availability = entryStyleAvailability(entry);

  const rows = entryStyleScopeProps(scope, resolvedFieldRole).filter((prop) => {
    // DF-8：「日期位置」写的是条目头 flex 容器的 justify-content。字段作用域（含页眉字段）
    // 的行清单已在 `FIELD_STYLE_PROPS` 里去掉它，这里只剩"条目里有没有灰字"这一层判断。
    if (prop !== "meta_align") return true;
    // Q12：无日期/元信息字段 → 不显示「日期位置」。
    return !known || availability.hasMeta;
  });

  /**
   * I-21：分组只在浮层里开。行清单（= 作用范围）一变就回到「默认展开第一组」，
   * 否则上一个范围的组 id 在这个范围里可能根本不存在，会剩下四个都收起的组头。
   */
  const groupedRows = collapsibleGroups ? groupStyleRows(rows) : [];
  const rowsKey = rows.join(",");
  if (collapsibleGroups && rowsKey !== groupsKey) {
    setGroupsKey(rowsKey);
    setOpenGroup("auto");
  }
  const openGroupId =
    openGroup === "auto"
      ? (groupedRows[0]?.group.id ?? null)
      : openGroup === "none"
        ? null
        : openGroup;

  /**
   * 写探针：有 `previewRef` 走句柄（左栏原有行为），没有就走登记处
   * （字段右键浮层 / 照片框浮层——宿主没有 ref 通道，I-15）。
   */
  const flushProbe = () => {
    const css = [...probeByProp.current.values()].join("\n");
    if (previewRef?.current) previewRef.current.setLiveProbe(css);
    else writeLiveProbe(css);
  };
  const setProbe = (prop: StylePropKey, css: string) => {
    if (css) probeByProp.current.set(prop, css);
    else probeByProp.current.delete(prop);
    flushProbe();
  };
  const applyProbe = (css: string) => {
    // 只为"整段清空"保留：恢复 / 固定当前样式时把这条的全部探针撤掉。
    if (!css) probeByProp.current.clear();
    flushProbe();
  };
  const commit = (prop: StylePropKey, next: ResumeStyleValue | null) => {
    const format_config = scopeRole
      ? withObjectRoleProp(config, targetId, scopeRole, prop, next)
      : withObjectProp(config, targetId, prop, next);
    onChange({ ...layout, format_config });
  };

  const restore = () => {
    applyProbe("");
    const format_config = scopeRole
      ? clearObjectRole(config, [targetId], scopeRole)
      : clearObject(config, targetId);
    onChange({ ...layout, format_config });
  };

  const restoreLabel = scopeRole
    ? t("typography.entryStyle.restore", { scope: t(scopeLabelKey) })
    : t("typography.object.clear");

  /** 一行属性控件（平铺与分组共用，避免两条渲染路径各改一半）。 */
  const renderRow = (prop: StylePropKey) => {
    // 正文没有要点时项目符号无效：灰显 + 下方说明，而不是让用户拖了没反应。
    const bulletUnavailable =
      prop === "bullet" && known && scope === "body" && !availability.hasBullets;
    return (
      <StyleValueRow
        key={prop}
        prop={prop}
        label={t(STYLE_PROP_LABELS[prop])}
        value={resolvedPropValue(domains, {
          role,
          prop,
          objectId,
          templateDefaults: defaults,
        })}
        own={ownStyle[prop]}
        source={styleSourceOf(config, { role, prop, objectId })}
        disabled={disabled || bulletUnavailable || undefined}
        basePx={basePx}
        toProbeCss={(value) =>
          styleProbeCss(scopeRole ? { objectId, role: scopeRole } : { objectId }, {
            [prop]: value,
          })
        }
        onProbe={(css) => setProbe(prop, css)}
        onCommit={(next) =>
          commit(prop, next === null ? null : storedStyleValue(prop, next, baseRatio))
        }
        testId={`style-row-object-${prop}`}
      />
    );
  };

  return (
    <section className="resume-typography-panel" aria-label={t("typography.object.more")}>
      <Typography.Text type="secondary">
        {t("typography.entryStyle.status", {
          name,
          scope: t(scopeLabelKey),
        })}
      </Typography.Text>
      {!lockScope && !headerMode && (
        <div className="resume-typography-scope" data-entry-style-scope="1">
          <Space size={6} wrap>
            <Typography.Text type="secondary">
              {t("typography.entryStyle.scope.label")}
            </Typography.Text>
            <Segmented
              size="small"
              value={scope}
              disabled={disabled || undefined}
              aria-label={t("typography.entryStyle.scope.aria")}
              options={ENTRY_STYLE_SCOPES.map((value) => ({
                value,
                label: t(ENTRY_STYLE_SCOPE_LABELS[value]),
              }))}
              onChange={(value) =>
                setManualScope({ path: pickedPath, scope: value as EntryStyleScope })
              }
            />
          </Space>
          <Typography.Text type="secondary">{t(ENTRY_STYLE_SCOPE_HINTS[scope])}</Typography.Text>
        </div>
      )}
      {headerMode ? (
        <Typography.Text type="secondary">{t("typography.headerStyle.hint")}</Typography.Text>
      ) : null}
      {headerMode && headerField.hasLabel === false ? (
        // 这个字段没有标签段（label_mode=hide / 电话这类 auto 只印值）：禁用「字段名」，
        // 否则会写出一条永远匹配不到的 `object_roles["header.X:field_label"]`。
        <Typography.Text type="secondary">{t("typography.headerStyle.noLabel")}</Typography.Text>
      ) : null}
      {scope === "field" ? (
        <Segmented
          size="small"
          value={fieldTarget}
          onChange={(value) => setFieldTarget(value as "value" | "label")}
          options={[
            { value: "value", label: t("typography.fieldStyle.target.value") },
            {
              value: "label",
              label: t("typography.fieldStyle.target.label"),
              disabled: headerMode && headerField.hasLabel === false,
            },
          ]}
          aria-label={t("typography.fieldStyle.target.aria")}
        />
      ) : null}
      {collapsibleGroups ? (
        // I-21：组头单行（12px 字号 + 20px 行高 + 箭头靠右），内容只画当前那一组。
        <div className="resume-typography-groups">
          {groupedRows.map(({ group, rows: groupRows }) => {
            const open = group.id === openGroupId;
            return (
              <div
                key={group.id}
                className={`resume-typography-group${open ? " is-open" : ""}`}
                data-object-style-group={group.id}
              >
                <button
                  type="button"
                  className="resume-typography-group-head"
                  aria-expanded={open}
                  disabled={disabled || undefined}
                  data-testid={`style-group-${group.id}`}
                  onClick={() => setOpenGroup(open ? "none" : group.id)}
                >
                  <span className="resume-typography-group-name">{t(group.label)}</span>
                  {open ? (
                    <DownOutlined className="resume-typography-group-caret" />
                  ) : (
                    <RightOutlined className="resume-typography-group-caret" />
                  )}
                </button>
                {open ? (
                  <div className="resume-typography-rows">{groupRows.map(renderRow)}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="resume-typography-rows">{rows.map(renderRow)}</div>
      )}
      {known && scope === "body" && !availability.hasBullets ? (
        <Typography.Text type="secondary">{t("typography.entryStyle.noBullets")}</Typography.Text>
      ) : null}
      {scope !== "field" && !collapsibleGroups ? (
        // I-21：这句在浮层里不画——它解释的是「字号/加粗/段前段后去哪调」，而浮层的
        // 字段范围本来就把这四项列在「文字与颜色」组里（字段层没有文字级别面板）；
        // 300px 宽这一句要吃两行 40px，正是超出 360 的那 40px。
        <Typography.Text type="secondary">{t("typography.object.levelHint")}</Typography.Text>
      ) : null}
      <Space size={8} wrap>
        <Tag
          color={ownCount > 0 ? "blue" : undefined}
          style={{ marginInlineEnd: 0 }}
          data-entry-style-source={ownCount > 0 ? "object" : "template"}
        >
          {t(
            ownCount > 0
              ? ENTRY_STYLE_SCOPE_SOURCES[scope]
              : "typography.entryStyle.source.template",
          )}
        </Tag>
        {onFreeze ? (
          <Tooltip title={t("typography.painter.freezeHint")}>
            <Button
              size="small"
              icon={<BgColorsOutlined />}
              disabled={disabled || undefined}
              aria-label={t("typography.painter.freeze")}
              onClick={() => {
                applyProbe("");
                onFreeze(scope);
              }}
            >
              {t("typography.painter.freeze")}
            </Button>
          </Tooltip>
        ) : null}
        <Typography.Link
          role="button"
          tabIndex={0}
          aria-label={restoreLabel}
          onClick={restore}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            restore();
          }}
        >
          {restoreLabel}
        </Typography.Link>
        <Typography.Text type="secondary">{t("typography.capability.word")}</Typography.Text>
      </Space>
    </section>
  );
}
