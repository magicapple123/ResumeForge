// SPDX-License-Identifier: Apache-2.0
/**
 * 用户气泡里的「本轮引用」（F36）：岗位片 `标题 · 公司`、简历片 `标题`。
 *
 * - 标题来自后端落库的快照（`context.job_title` / `resume_title`），岗位改名或删除后
 *   仍显示发送当时引用的名字；
 * - 只有传了 `onOpenReference` 才可点：浮动/紧凑形态与单测不传它就退化成只读标签，
 *   不必为了"能点"改一遍所有调用方签名；
 * - 一个引用都没有时返回 `null`——空 div 会在气泡里多出一截间距。
 *
 * T29：外部简历的 id **不写进** `resume_id`（两张表 id 会撞号），新消息把它放在
 * `resume_ref`（`external:7`）。所以简历片按 `resume_id` → `resume_ref` 的顺序取一个：
 * 老消息只有前者，新消息（外部简历）只有后者；两个都在时以 `resume_id` 为准（同一份）。
 */
import { FileTextOutlined, LinkOutlined } from "@ant-design/icons";
import { Tag, Tooltip } from "antd";
import type { ReactNode } from "react";
import type { AssistantMessageReferences, AssistantReferenceKind } from "../../../types";
import { decodeResumeRef } from "../../../types/resumeRef";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  refs: AssistantMessageReferences;
  /** 缺省不可点（只读展示）。 */
  onOpenReference?: (kind: AssistantReferenceKind, id: number) => void;
}

/**
 * 岗位片的口径与输入区 chip 一致：`标题 · 公司`（无公司时只有标题）。
 * 早期消息只存了 id（快照字段上线前），此时退回 `岗位 #12`——空白 chip 会让用户
 * 以为气泡里有个坏掉的标签。
 */
function jobText(refs: AssistantMessageReferences, id: number): string {
  const title = refs.job_title || t("assistantComposer.context.jobFallback", { id });
  return refs.job_company ? `${title} · ${refs.job_company}` : title;
}

function resumeText(refs: AssistantMessageReferences, id: number): string {
  return refs.resume_title || t("assistantComposer.context.resumeFallback", { id });
}

interface RefItem {
  kind: AssistantReferenceKind;
  id: number;
  label: string;
  icon: ReactNode;
}

export default function MessageReferences({ refs, onOpenReference }: Props) {
  useLocale();
  // 先收集成列表再渲染：空列表直接返回 null，不必让调用方判断。
  const items: RefItem[] = [];
  if (refs.job_id != null) {
    items.push({
      kind: "job",
      id: refs.job_id,
      label: jobText(refs, refs.job_id),
      icon: <LinkOutlined />,
    });
  }
  if (refs.resume_id != null) {
    items.push({
      kind: "resume",
      id: refs.resume_id,
      label: resumeText(refs, refs.resume_id),
      icon: <FileTextOutlined />,
    });
  } else {
    // T29：外部简历只带 `resume_ref`（`external:7`）。解不出来就当没选——脏值不该
    // 在气泡里显示成一枚点不动的坏标签。
    const ref = decodeResumeRef(refs.resume_ref);
    if (ref) {
      items.push({
        kind: ref.kind === "external" ? "external_resume" : "resume",
        id: ref.id,
        label: resumeText(refs, ref.id),
        icon: <FileTextOutlined />,
      });
    }
  }
  if (items.length === 0) return null;

  const interactive = onOpenReference !== undefined;
  const open = (kind: AssistantReferenceKind, id: number): void => onOpenReference?.(kind, id);
  return (
    <div className="assistant-message-refs" aria-label={t("assistantUi.messageRefs.label")}>
      <span className="assistant-message-refs-label">{t("assistantUi.messageRefs.label")}</span>
      {items.map((item) => (
        <Tooltip title={item.label} key={`${item.kind}-${item.id}`}>
          <Tag
            className={`assistant-ref-chip${interactive ? " assistant-ref-chip--link" : ""}`}
            icon={item.icon}
            // 不可点时不留 role/tabIndex：读屏不该把纯展示标签念成链接。
            role={interactive ? "link" : undefined}
            tabIndex={interactive ? 0 : undefined}
            onClick={interactive ? () => open(item.kind, item.id) : undefined}
            onKeyDown={
              interactive
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open(item.kind, item.id);
                    }
                  }
                : undefined
            }
          >
            <span className="assistant-ref-chip-text">{item.label}</span>
          </Tag>
        </Tooltip>
      ))}
    </div>
  );
}
