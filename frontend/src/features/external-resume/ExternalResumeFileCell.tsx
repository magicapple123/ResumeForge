// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历列表的「文件」单元格（T09 起的三段结构 + T28 的收藏与备注）。
 *
 * 从 `pages/resumes/ExternalResumeFileTable.tsx` 抽出来，两个原因：
 *
 * 1. **500 行硬预算**：表格已经 460+ 行，加"收藏星标 + 备注行"必然超标；
 * 2. **T28 的新东西集中在一处**：收藏与备注都是"这一行的标记"，不是表格结构的一部分。
 *
 * 结构（从上到下，空的段不占位）：
 *
 * 1. 类型徽标 + 文件名按钮（点它打开详情；按有没有文字层落到「文本」或「原件」页）；
 * 2. 提取状态副行：「已提取 N 字」/「未提取到文字 · 扫描件或图片型 PDF」（警示色）；
 * 3. **备注**（T28）：有备注才渲染——空备注不留空行（验收项 2）。
 *
 * 收藏星标放在文件名右侧（T28）：列表行与详情都能切，且**就地**显示状态（实心 = 已
 * 收藏），不需要打开菜单才知道。写作入口在面板（`onToggleFavorite`），本组件只报事件。
 */
import { StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Tag, Tooltip, Typography } from "antd";
import type { ExternalResumeItem } from "../../api/externalResumes";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { fileKindBadge, fileKindOf } from "../../utils/fileKind";
import "./externalResumeActions.css";

interface Props {
  item: ExternalResumeItem;
  /** 打开详情（面板决定落到哪个页签：有文字看文本、没文字看原件）。 */
  onOpen: (item: ExternalResumeItem) => void;
  /** 切换收藏；写作在面板（它知道怎么刷新列表）。 */
  onToggleFavorite: (item: ExternalResumeItem) => void;
}

export function ExternalResumeFileCell({ item, onOpen, onToggleFavorite }: Props) {
  // 模块级 t() 用法必须订阅语言变化，否则切语言时这一格不重画（见 localeSubscription 用例）。
  useLocale();
  const kind = fileKindOf(item.mime, item.name);
  // 已知类型给格式名（PDF / DOCX…，中英文一致）；只有不认识的类型才需要翻译。
  const badge = fileKindBadge(kind) ?? t("resumesPage.external.kindOther");
  // 收藏 / 备注是后加的字段（见 `ExternalResumeItem` 的注释），读侧统一归一。
  const favorite = Boolean(item.favorite);
  const note = item.note ?? "";
  const favoriteLabel = favorite
    ? t("resumesPage.external.unfavorite")
    : t("resumesPage.external.favorite");

  return (
    <div className="external-resume-file">
      <div className="external-resume-file-line">
        <Tag className={`external-resume-kind external-resume-kind-${kind}`}>{badge}</Tag>
        {/* 文件名就是主入口：按钮而不是 `<a>`——它打开的是弹层，不是导航。
            `title` 兜住省略号挡住的部分（长文件名在窄屏上必然被截）。 */}
        <Button
          type="link"
          className="external-resume-name"
          title={item.name}
          onClick={() => onOpen(item)}
        >
          {item.name}
        </Button>
        <Tooltip title={favoriteLabel}>
          <Button
            type="text"
            size="small"
            className={`external-resume-star${favorite ? " is-on" : ""}`}
            aria-label={favoriteLabel}
            aria-pressed={favorite}
            icon={favorite ? <StarFilled /> : <StarOutlined />}
            onClick={() => onToggleFavorite(item)}
          />
        </Tooltip>
      </div>
      {item.has_text ? (
        <Typography.Text type="secondary" className="external-resume-status">
          {t("resumesPage.external.extractedChars", { count: item.text_chars })}
        </Typography.Text>
      ) : (
        <Typography.Text type="warning" className="external-resume-status">
          {t("resumesPage.external.scanStatus")}
        </Typography.Text>
      )}
      {/* 备注：空串不渲染（不留空行）；单行省略，完整内容在详情的备注弹窗里看。 */}
      {note ? (
        <Typography.Text
          type="secondary"
          className="external-resume-note"
          ellipsis={{ tooltip: note }}
        >
          {note}
        </Typography.Text>
      ) : null}
    </div>
  );
}

export default ExternalResumeFileCell;
