// SPDX-License-Identifier: Apache-2.0
/**
 * 识别结果的**校对列表**（项 13 / D23）。
 *
 * 识别不再"点一下就直接改表单"：结果先变成一张可编辑的清单，用户看过、改过、确认之后才
 * 真的写入。原因很直接——识别是**猜**，而改资料是**写**；把猜测直接写进用户的数据，
 * 一旦猜错就得自己发现、自己回滚（还没有回滚）。
 *
 * 三条刻意的约束：
 * 1. **受控、无自有状态**：`rows` 进、`onChange` 出。校对过程中的真相只有一份（在页面里），
 *    这样"确认填入"读到的就是用户眼前那一份。
 * 2. **不提供增删行**（D23）：删掉一行等于"这次不要这个字段"，但用户真正的诉求通常是
 *    "识别错了"——那就改值。允许增删会把这张表变形成半个编辑器，而编辑器在资料页上。
 * 3. **每行有稳定 `data-row-id`**：值输入框的可访问名是栏目名（「学校」），同名列会出现两次
 *    （两段教育经历），测试与自动化靠 `data-row-id` 定位而不是靠名字。
 */
import { Checkbox, Collapse, Input, Tag, Typography } from "antd";
import { useMemo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export interface RecognitionReviewRow {
  /** 稳定键：标量=字段名（`name`）；条目=`educations.0.school`。 */
  id: string;
  /** 折叠分组标题（教育经历 / 实习与工作 / …）。 */
  section: string;
  /** 行标题（栏目名，如「学校」）；`isNew` 行可编辑。 */
  label: string;
  value: string;
  /** 长文本用多行输入（个人总结、经历描述…）。 */
  multiline?: boolean;
  /** 网申侧：目录外的新字段（下一轮接）。 */
  isNew?: boolean;
  /** 仅 `isNew` 行有意义：用户是否勾选"要新增这个字段"。 */
  selected?: boolean;
}

interface Props {
  rows: RecognitionReviewRow[];
  onChange: (rows: RecognitionReviewRow[]) => void;
}

export default function RecognitionReviewList({ rows, onChange }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  /** 按 `section` 分组，**保持出现顺序**（顺序就是资料页的分区顺序，不重排）。 */
  const groups = useMemo(() => {
    const map = new Map<string, RecognitionReviewRow[]>();
    for (const row of rows) {
      const bucket = map.get(row.section);
      if (bucket) bucket.push(row);
      else map.set(row.section, [row]);
    }
    return [...map.entries()];
  }, [rows]);

  const patch = (id: string, change: Partial<RecognitionReviewRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  };

  const renderRow = (row: RecognitionReviewRow) => {
    const valueInput = row.multiline ? (
      <Input.TextArea
        aria-label={row.label}
        value={row.value}
        autoSize={{ minRows: 2, maxRows: 8 }}
        onChange={(event) => patch(row.id, { value: event.target.value })}
      />
    ) : (
      <Input
        aria-label={row.label}
        value={row.value}
        onChange={(event) => patch(row.id, { value: event.target.value })}
      />
    );

    return (
      <div key={row.id} data-row-id={row.id} className="recognition-review-row">
        {row.isNew ? (
          <Checkbox
            aria-label={t("profileUi.review.selectAria", { label: row.label })}
            checked={row.selected ?? false}
            onChange={(event) => patch(row.id, { selected: event.target.checked })}
          />
        ) : null}
        <div className="recognition-review-label">
          {row.isNew ? (
            // 新字段的**名字**也要能改（模型抄错栏目名是常事）。aria-label 加前缀是为了
            // 与同一行的值输入区分开——两个都叫「是否有驾照」的话，按名字定位就二义了。
            <Input
              aria-label={t("profileUi.review.fieldNameAria", { label: row.label })}
              value={row.label}
              onChange={(event) => patch(row.id, { label: event.target.value })}
            />
          ) : (
            <Typography.Text type="secondary">{row.label}</Typography.Text>
          )}
          {row.isNew ? <Tag color="blue">{t("profileUi.review.newFieldTag")}</Tag> : null}
        </div>
        <div className="recognition-review-value">{valueInput}</div>
      </div>
    );
  };

  return (
    <Collapse
      className="recognition-review"
      // 默认全部展开：这是"让你核一遍"的清单，收起来等于让你多点三次。
      defaultActiveKey={groups.map(([section]) => section)}
      items={groups.map(([section, list]) => ({
        key: section,
        label: (
          <span className="recognition-review-section">
            {section}
            <Typography.Text type="secondary">
              {t("profileUi.review.itemCount", { count: list.length })}
            </Typography.Text>
          </span>
        ),
        children: <div className="recognition-review-rows">{list.map(renderRow)}</div>,
      }))}
    />
  );
}
