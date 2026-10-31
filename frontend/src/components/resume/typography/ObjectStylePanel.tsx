// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目排版」面板（W07 对象级 L5；Q12 引入作用范围，Q14 接收「固定当前样式」）。
 *
 * ## 作用范围（Q12）
 *
 * 顶部段控「整条 / 条目头 / 正文 / 灰字」：整条写 `format_config.objects[<id>]`（兼容旧
 * 数据、不迁移），其余三个范围写 `object_roles["<id>:<角色>"]`。行清单随范围过滤（来自
 * 角色白名单，见 `features/resume-layout/entryStyleScopes`），不是手写第二份清单。
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
import { BgColorsOutlined } from "@ant-design/icons";
import { Button, Segmented, Space, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumeEntry } from "../../../types/resumeDocument";
import type { ResumePreviewHandle } from "../../ResumePreview";
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
} from "../../../features/resume-layout/entryStyleScopes";
import {
  readStyleCatalog,
  templateRoleDefaults,
} from "../../../features/resume-layout/styleCatalogExtensions";
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
} from "../../../features/resume-layout/styleOverrides";
import StyleValueRow from "./StyleValueRow";
import { useLocale } from "../../../i18n/i18nContext";

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
  if (!objectId) {
    return <Typography.Text type="secondary">{t("typography.object.empty")}</Typography.Text>;
  }

  const scope = manual && manual.path === pickedPath ? manual.scope : defaultScope;
  const scopeRole = entryStyleScopeRole(scope);
  // 整条范围沿用"按正文继承"的既有读法（四出口的 effective(role, object_id) 同口径）。
  const role = scopeRole ?? "body";
  const config = layout.format_config;
  const domains = readStyleDomains(config);
  const styleCatalog = readStyleCatalog(catalog);
  const defaults = templateRoleDefaults(styleCatalog, layout.template, role);
  const ownStyle = scopeRole
    ? readObjectRoleStyle(domains, objectId, scopeRole)
    : readObjectStyle(domains, objectId);
  const ownCount = Object.keys(ownStyle).length;
  // 对象级字号同样是"乘在对象基准（=1.0）上的系数"，显示值需要乘回基准。
  const baseRatio = roleBaseRatio(defaults);
  const basePx = catalog?.font_scales?.find((scale) => scale.name === layout.font_scale)?.base_px;
  const name = objectLabel?.trim() || t("typography.object.untitled");
  // 只有拿到条目内容时才隐藏"无关项"；目录/宿主没传时不臆断（否则行会凭空消失）。
  const known = entry !== null;
  const availability = entryStyleAvailability(entry);

  const rows = entryStyleScopeProps(scope).filter((prop) => {
    if (prop !== "meta_align") return true;
    // Q12：无日期/元信息字段 → 不显示「日期位置」。
    return !known || availability.hasMeta;
  });

  const applyProbe = (css: string) => {
    previewRef?.current?.setLiveProbe(css);
  };
  const commit = (prop: StylePropKey, next: ResumeStyleValue | null) => {
    const format_config = scopeRole
      ? withObjectRoleProp(config, objectId, scopeRole, prop, next)
      : withObjectProp(config, objectId, prop, next);
    onChange({ ...layout, format_config });
  };

  const restore = () => {
    applyProbe("");
    const format_config = scopeRole
      ? clearObjectRole(config, [objectId], scopeRole)
      : clearObject(config, objectId);
    onChange({ ...layout, format_config });
  };

  const restoreLabel = scopeRole
    ? t("typography.entryStyle.restore", { scope: t(ENTRY_STYLE_SCOPE_LABELS[scope]) })
    : t("typography.object.clear");

  return (
    <section className="resume-typography-panel" aria-label={t("typography.object.more")}>
      <Typography.Text type="secondary">
        {t("typography.entryStyle.status", {
          name,
          scope: t(ENTRY_STYLE_SCOPE_LABELS[scope]),
        })}
      </Typography.Text>
      <div className="resume-typography-scope" data-entry-style-scope="1">
        <Space size={6} wrap>
          <Typography.Text type="secondary">
            {t("typography.entryStyle.scope.label")}
          </Typography.Text>
          <Segmented
            size="small"
            value={scope}
            disabled={disabled}
            aria-label={t("typography.entryStyle.scope.aria")}
            options={ENTRY_STYLE_SCOPES.map((value) => ({
              value,
              label: t(ENTRY_STYLE_SCOPE_LABELS[value]),
            }))}
            onChange={(value) => setManual({ path: pickedPath, scope: value as EntryStyleScope })}
          />
        </Space>
        <Typography.Text type="secondary">{t(ENTRY_STYLE_SCOPE_HINTS[scope])}</Typography.Text>
      </div>
      <div className="resume-typography-rows">
        {rows.map((prop) => {
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
              disabled={disabled || bulletUnavailable}
              basePx={basePx}
              toProbeCss={(value) =>
                styleProbeCss(scopeRole ? { objectId, role: scopeRole } : { objectId }, {
                  [prop]: value,
                })
              }
              onProbe={applyProbe}
              onCommit={(next) =>
                commit(prop, next === null ? null : storedStyleValue(prop, next, baseRatio))
              }
              testId={`style-row-object-${prop}`}
            />
          );
        })}
      </div>
      {known && scope === "body" && !availability.hasBullets ? (
        <Typography.Text type="secondary">{t("typography.entryStyle.noBullets")}</Typography.Text>
      ) : null}
      {/* 字号 / 加粗 / 段前 / 段后为什么不在这一区：级别已经管住它们，再列一遍会互相
          覆盖。把去处写出来，用户不会以为功能被删。 */}
      <Typography.Text type="secondary">{t("typography.object.levelHint")}</Typography.Text>
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
              disabled={disabled}
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
