// SPDX-License-Identifier: Apache-2.0
/**
 * W07 的对象级排版面板：选中一条内容后，只调**这一条**的段落级属性。
 *
 * ## 与角色面板的关系
 *
 * 角色面板改"同类段落"（L4），这里改"单条"（L5）。写入都是 `format_config` 的域数据，
 * 不碰内容、不产生第二次保存链路（宿主把新 layout 交给既有版式保存）。
 *
 * ## 可调属性是段落级的
 *
 * 字号等角色级概念不在这里（一条里的字号要跟同类段落走）；字符级标记（斜体/链接）由正文
 * 标记协议负责，也不在属性面板里伪装成开关。
 *
 * ## 挂载归 shell
 *
 * 只接收 `objectId / objectLabel / onChange`；"选中哪一条"是宿主（大纲 / 纸面点击）的
 * 状态，本组件不自己维护第二份选择。
 */
import { CloseOutlined } from "@ant-design/icons";
import { Button, Space, Tooltip, Typography } from "antd";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumePreviewHandle } from "../../ResumePreview";
import { t } from "../../../i18n";
import { styleProbeCss } from "../../../utils/resumeFormatProbe";
import { STYLE_PROP_LABELS, type StylePropKey } from "../../../utils/resumeStyleParams";
import {
  OBJECT_STYLE_PROPS,
  type ResumeRoleKey,
} from "../../../features/resume-layout/styleCatalog";
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
  onClose?: () => void;
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
  onClose,
}: Props) {
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
    <section className="resume-typography-panel" aria-label={t("typography.object.title")}>
      <Space size={6} wrap>
        <Typography.Text strong>{t("typography.object.title")}</Typography.Text>
        <Typography.Text type="secondary">{t("typography.object.scope", { name })}</Typography.Text>
        {onClose ? (
          <Tooltip title={t("typography.object.close")}>
            <Button
              size="small"
              type="text"
              icon={<CloseOutlined />}
              aria-label={t("typography.object.close")}
              onClick={onClose}
            />
          </Tooltip>
        ) : null}
      </Space>
      <div className="resume-typography-rows">
        {OBJECT_STYLE_PROPS.map((prop) => (
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
