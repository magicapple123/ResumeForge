// SPDX-License-Identifier: Apache-2.0
/**
 * 链接字段的**即时预览**（W14）：DOI / URL 合法时给一个可点链接，不合法时给一句说明。
 *
 * 规则只有一条：能不能变成链接由 `safeExternalHref` / `doiHref` 决定（只允许 http(s)），
 * 这里**不重复判断**协议——两处各判一次，迟早出现"预览可点、导出的 HTML 不可点"。
 *
 * ## 为什么用 `Form.Item shouldUpdate` 而不是 `Form.useWatch`
 *
 * 这个提示必须"输入一个字就跟一下"。`shouldUpdate` 的渲染函数由 Form 在值变化时重新执行，
 * 是 antd 里最稳定的一条订阅路径；`useWatch` 在部分发行版本里对"深层路径"不触发更新，
 * 表现恰好是"输入了但预览不更新"。订阅方式只在这里用一次，改一处即可。
 *
 * 输入中的半截内容（比如刚敲了 http）不算错误：不渲染任何提示，避免用户边打字边看红字。
 */
import { Form, Typography } from "antd";
import { doiHref, linkText, safeExternalHref } from "../../../features/resume-research/links";
import { rt } from "../../../features/resume-research/i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  /** 该字段在表单里的完整路径，例如 ["publications", 0, "url"]。 */
  path: (string | number)[];
  /** doi 会补成 https://doi.org/… 再解析；url 按原样解析。 */
  kind: "url" | "doi";
}

const HINT_STYLE = { fontSize: 12 } as const;

export default function UrlPreview({ path, kind }: Props) {
  useLocale();
  const form = Form.useFormInstance();
  return (
    <Form.Item noStyle shouldUpdate>
      {() => {
        const value = form.getFieldValue(path) as string | undefined;
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (!trimmed) return null;
        const href = kind === "doi" ? doiHref(trimmed) : safeExternalHref(trimmed);
        if (!href) {
          return (
            <Typography.Text type="secondary" style={HINT_STYLE}>
              {rt("research.link.invalid")}
            </Typography.Text>
          );
        }
        return (
          <Typography.Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={rt("research.link.open")}
            style={HINT_STYLE}
          >
            {linkText(kind === "doi" ? "https://doi.org/" + trimmed : trimmed)}
          </Typography.Link>
        );
      }}
    </Form.Item>
  );
}
