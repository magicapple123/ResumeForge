// SPDX-License-Identifier: Apache-2.0
/**
 * 「更多参数」：选中一条内容后，只调**这一条**级别管不到的那些细项（W07 对象级，L5）。
 *
 * ## 为什么不再是独立面板（2026-10-29 合并）
 *
 * 它原来单独占左栏最底部一段（用户截图「这条的排版 只作用于「上海大学」」），和上面的
 * 「文字级别」写的是同一个 `format_config.objects[<id>]`：字号比例、加粗、段前、段后
 * 两边各有一套控件，改一边另一边就"看起来没生效"。现在它作为文字级别的可展开细调区
 * 挂在 `WorkbenchTypographyTools` 里，行清单取 `OBJECT_EXTRA_STYLE_PROPS`（差集口径，
 * 见 `textLevels.ts`），两个控件不再抢同一批键。
 *
 * ## 与角色面板的关系
 *
 * 角色面板改"同类段落"（L4），这里改"单条"（L5）。写入都是 `format_config` 的域数据，
 * 不碰内容、不产生第二次保存链路（宿主把新 layout 交给既有版式保存）。
 *
 * ## 挂载归 shell
 *
 * 只接收 `objectId / objectLabel / onChange`；"选中哪一条"是宿主（大纲 / 纸面点击）的
 * 状态，本组件不自己维护第二份选择。
 */
import { Space, Typography } from "antd";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumePreviewHandle } from "../../ResumePreview";
import { t } from "../../../i18n";
import { styleProbeCss } from "../../../utils/resumeFormatProbe";
import { STYLE_PROP_LABELS, type StylePropKey } from "../../../utils/resumeStyleParams";
import type { ResumeRoleKey } from "../../../features/resume-layout/styleCatalog";
import { OBJECT_EXTRA_STYLE_PROPS } from "../../../features/resume-layout/textLevels";
import {
  readStyleCatalog,
  templateRoleDefaults,
} from "../../../features/resume-layout/styleCatalogExtensions";
import {
  clearObject,
  readObjectStyle,
  readStyleDomains,
  resolvedPropValue,
  roleBaseRatio,
  storedStyleValue,
  styleSourceOf,
  withObjectProp,
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
  /** 该对象所属角色（决定继承来源），默认正文。 */
  role?: ResumeRoleKey;
  disabled?: boolean;
  previewRef?: RefObject<ResumePreviewHandle | null>;
  onChange: (layout: ResumeLayout) => void;
}

export default function ObjectStylePanel({
  layout,
  catalog,
  objectId,
  objectLabel,
  role = "body",
  disabled = false,
  previewRef,
  onChange,
}: Props) {
  useLocale();
  if (!objectId) {
    return <Typography.Text type="secondary">{t("typography.object.empty")}</Typography.Text>;
  }

  const config = layout.format_config;
  const domains = readStyleDomains(config);
  const styleCatalog = readStyleCatalog(catalog);
  const defaults = templateRoleDefaults(styleCatalog, layout.template, role);
  const ownStyle = readObjectStyle(domains, objectId);
  // 对象级字号同样是"乘在对象基准（=1.0）上的系数"，显示值需要乘回基准。
  const baseRatio = roleBaseRatio(defaults);
  const basePx = catalog?.font_scales?.find((scale) => scale.name === layout.font_scale)?.base_px;
  const name = objectLabel?.trim() || t("typography.object.untitled");

  const applyProbe = (css: string) => {
    previewRef?.current?.setLiveProbe(css);
  };
  const commit = (prop: StylePropKey, next: ResumeStyleValue | null) => {
    onChange({ ...layout, format_config: withObjectProp(config, objectId, prop, next) });
  };

  return (
    <section className="resume-typography-panel" aria-label={t("typography.object.more")}>
      <Typography.Text type="secondary">{t("typography.object.scope", { name })}</Typography.Text>
      <div className="resume-typography-rows">
        {OBJECT_EXTRA_STYLE_PROPS.map((prop) => (
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
            disabled={disabled}
            basePx={basePx}
            toProbeCss={(value) => styleProbeCss({ objectId }, { [prop]: value })}
            onProbe={applyProbe}
            onCommit={(next) =>
              commit(prop, next === null ? null : storedStyleValue(prop, next, baseRatio))
            }
            testId={`style-row-object-${prop}`}
          />
        ))}
      </div>
      {/* 字号 / 加粗 / 段前 / 段后为什么不在这一区：级别已经管住它们，再列一遍会互相
          覆盖。把去处写出来，用户不会以为功能被删。 */}
      <Typography.Text type="secondary">{t("typography.object.levelHint")}</Typography.Text>
      <Space size={8} wrap>
        <Typography.Link
          role="button"
          tabIndex={0}
          aria-label={t("typography.object.clear")}
          onClick={() => {
            applyProbe("");
            onChange({ ...layout, format_config: clearObject(config, objectId) });
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            applyProbe("");
            onChange({ ...layout, format_config: clearObject(config, objectId) });
          }}
        >
          {t("typography.object.clear")}
        </Typography.Link>
        <Typography.Text type="secondary">{t("typography.capability.word")}</Typography.Text>
      </Space>
    </section>
  );
}
