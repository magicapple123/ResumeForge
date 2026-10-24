// SPDX-License-Identifier: Apache-2.0
/**
 * W07 / P1-02 的角色级排版面板：六个段落角色（姓名 / 板块标题 / 条目标题 / 正文 / 日期与
 * 元信息 / 重点文字）各自一组属性。
 *
 * ## 作用范围与来源
 *
 * 写的是 `format_config.roles[role]`（L4）。每行右侧的来源胶囊显示这一属性现在来自哪里：
 * 来自模板 / 来自版式 / 同类段落已调整；改过之后出现 ↺，点它 = **删键**回继承。
 *
 * ## 目录是可选输入
 *
 * `role_fields` / `template_role_defaults` 由后端 W07-BE 下发（wave2 契约 §2.8）。
 * 目录缺这两项时：行集合回落到契约表、继承值用中性兜底（界面明确提示"起点为中性值"），
 * 面板仍然可写——只是"来自模板"的具体数值不显示。
 *
 * ## 挂载归 shell
 *
 * 本组件只接收 `layout / catalog / previewRef / onChange`；挂载到左栏由 wb-core 落笔
 * （契约 §2.5 的挂载点约定），这里不 import 任何 shell 文件。
 */
import { Collapse, Space, Typography } from "antd";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumePreviewHandle } from "../../ResumePreview";
import { t } from "../../../i18n";
import { styleProbeCss } from "../../../utils/resumeFormatProbe";
import { STYLE_PROP_LABELS, type StylePropKey } from "../../../utils/resumeStyleParams";
import {
  RESUME_ROLES,
  ROLE_LABELS,
  type ResumeRoleKey,
} from "../../../features/resume-layout/styleCatalog";
import {
  readStyleCatalog,
  roleStyleProps,
  templateRoleDefaults,
} from "../../../features/resume-layout/styleCatalogExtensions";
import {
  clearRole,
  readRoleStyle,
  readStyleDomains,
  resolvedPropValue,
  roleBaseRatio,
  storedStyleValue,
  styleSourceOf,
  withRoleProp,
  type ResumeStyleValue,
} from "../../../features/resume-layout/styleOverrides";
import StyleValueRow from "./StyleValueRow";

interface Props {
  layout: ResumeLayout;
  catalog?: ResumeTemplateCatalog;
  disabled?: boolean;
  previewRef?: RefObject<ResumePreviewHandle | null>;
  onChange: (layout: ResumeLayout) => void;
  /** 默认展开的角色（宿主/测试可指定；不传则打开前两个高频角色）。 */
  defaultOpenRoles?: readonly ResumeRoleKey[];
}

export default function RoleStylePanel({
  layout,
  catalog,
  disabled = false,
  previewRef,
  onChange,
  defaultOpenRoles,
}: Props) {
  const config = layout.format_config;
  const domains = readStyleDomains(config);
  const styleCatalog = readStyleCatalog(catalog);
  const basePx = catalog?.font_scales?.find((scale) => scale.name === layout.font_scale)?.base_px;

  const applyProbe = (css: string) => {
    previewRef?.current?.setLiveProbe(css);
  };

  const commit = (role: ResumeRoleKey, prop: StylePropKey, next: ResumeStyleValue | null) => {
    onChange({ ...layout, format_config: withRoleProp(config, role, prop, next) });
  };

  const items = RESUME_ROLES.map((role) => {
    const defaults = templateRoleDefaults(styleCatalog, layout.template, role);
    const baseRatio = roleBaseRatio(defaults);
    const ownStyle = readRoleStyle(domains, role);
    const ownCount = Object.keys(ownStyle).length;
    const rows = roleStyleProps(styleCatalog, role).map((prop) => (
      <StyleValueRow
        key={prop}
        prop={prop}
        label={t(STYLE_PROP_LABELS[prop])}
        value={resolvedPropValue(domains, { role, prop, templateDefaults: defaults })}
        own={ownStyle[prop]}
        source={styleSourceOf(config, { role, prop })}
        disabled={disabled}
        basePx={basePx}
        toProbeCss={(value) =>
          styleProbeCss({ role }, { [prop]: value }, { baseRatios: { [role]: baseRatio } })
        }
        onProbe={applyProbe}
        onCommit={(next) =>
          commit(role, prop, next === null ? null : storedStyleValue(prop, next, baseRatio))
        }
        testId={`style-row-${role}-${prop}`}
      />
    ));
    return {
      key: role,
      label: (
        <Space size={6}>
          <span>{t(ROLE_LABELS[role])}</span>
          {ownCount > 0 ? <Typography.Text type="secondary">{ownCount}</Typography.Text> : null}
        </Space>
      ),
      extra:
        ownCount > 0 ? (
          <Typography.Link
            role="button"
            tabIndex={0}
            aria-label={t("typography.role.clearAria", { role: t(ROLE_LABELS[role]) })}
            onClick={() => onChange({ ...layout, format_config: clearRole(config, role) })}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onChange({ ...layout, format_config: clearRole(config, role) });
            }}
          >
            {t("typography.role.clear")}
          </Typography.Link>
        ) : null,
      children: (
        <Space direction="vertical" size={2} style={{ width: "100%" }}>
          {rows}
        </Space>
      ),
    };
  });

  return (
    <section className="resume-typography-panel" aria-label={t("typography.role.groupAria")}>
      <Typography.Text type="secondary">{t("typography.panel.hint")}</Typography.Text>
      {!styleCatalog.hasTemplateDefaults ? (
        <Typography.Text type="warning">{t("typography.catalog.missing")}</Typography.Text>
      ) : null}
      <Collapse
        size="small"
        items={items}
        defaultActiveKey={[...(defaultOpenRoles ?? ["name", "body"])]}
      />
      <Typography.Text type="secondary">{t("typography.capability.pdf")}</Typography.Text>
    </section>
  );
}
