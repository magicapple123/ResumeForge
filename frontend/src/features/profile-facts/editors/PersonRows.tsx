// SPDX-License-Identifier: Apache-2.0
/**
 * 论文作者 / 专利发明人共用的可增删行编辑（顺序即署名顺序）。
 *
 * 用 antd `Form.List` 而不是自己管数组：上移/下移改的是表单里的真实顺序，保存时
 * 原样提交 `authors[] / inventors[]`——不改写、不排序、不按姓名去重。
 *
 * 键盘可达：上移/下移/删除都是原生 `Button`，Tab 可到、Enter/空格可触发；
 * 首行上移与末行下移用 `disabled` 而不是隐藏（隐藏会让焦点跳位）。
 */
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Checkbox, Form, Input, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  /** 表单字段名：`authors`（论文）或 `inventors`（专利）。 */
  name: string;
  role: "author" | "inventor";
}

export default function PersonRows({ name, role }: Props) {
  useLocale();
  const isAuthor = role === "author";
  const label = t(isAuthor ? "research.authors.label" : "research.inventors.label");
  const addLabel = t(isAuthor ? "research.authors.add" : "research.inventors.add");
  const emptyLabel = t(isAuthor ? "research.authors.empty" : "research.inventors.empty");
  const unit = t(isAuthor ? "profileFacts.people.authorUnit" : "profileFacts.people.inventorUnit");
  const nameAria = (index: number) => t("profileFacts.people.nameAria", { index: index + 1, unit });
  const removeAria = (index: number) =>
    t("profileFacts.people.removeAria", { index: index + 1, unit });
  const moveUpAria = (index: number) =>
    t("profileFacts.people.moveUpAria", { index: index + 1, unit });
  const moveDownAria = (index: number) =>
    t("profileFacts.people.moveDownAria", { index: index + 1, unit });

  return (
    <Form.Item label={`${label} · ${t("profileFacts.people.orderHint")}`}>
      <Form.List name={name}>
        {(fields, { add, remove, move }) => (
          <div className="profile-facts-people">
            {fields.length === 0 ? (
              <Typography.Text type="secondary" className="profile-facts-people-empty">
                {emptyLabel}
              </Typography.Text>
            ) : null}
            {/* 一行一条：姓名输入 + 本人 / 通讯 + 上移 / 下移 / 删除。行操作靠右，
                窄容器下整组换行，不把姓名输入压窄。 */}
            <div className="profile-facts-people-rows">
              {fields.map((field, index) => (
                <div className="profile-facts-person-row" key={field.key}>
                  <Form.Item
                    noStyle
                    name={[field.name, "name"]}
                    rules={[
                      {
                        required: true,
                        whitespace: true,
                        message: t("profileFacts.people.nameRequired"),
                      },
                    ]}
                  >
                    <Input
                      className="profile-facts-person-name"
                      aria-label={nameAria(index)}
                      placeholder={t("profileFacts.people.namePlaceholder")}
                    />
                  </Form.Item>
                  <Form.Item noStyle name={[field.name, "is_self"]} valuePropName="checked">
                    <Checkbox>{t("research.authors.self")}</Checkbox>
                  </Form.Item>
                  <Form.Item noStyle name={[field.name, "corresponding"]} valuePropName="checked">
                    <Checkbox>{t("research.authors.corresponding")}</Checkbox>
                  </Form.Item>
                  <div className="profile-facts-person-actions">
                    <Button
                      size="small"
                      icon={<ArrowUpOutlined />}
                      aria-label={moveUpAria(index)}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    />
                    <Button
                      size="small"
                      icon={<ArrowDownOutlined />}
                      aria-label={moveDownAria(index)}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, index + 1)}
                    />
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={removeAria(index)}
                      onClick={() => remove(field.name)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="dashed"
              size="small"
              className="profile-facts-person-add"
              icon={<PlusOutlined />}
              onClick={() => add({ name: "", is_self: false, corresponding: false })}
            >
              {addLabel}
            </Button>
          </div>
        )}
      </Form.List>
    </Form.Item>
  );
}
