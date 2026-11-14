// SPDX-License-Identifier: Apache-2.0
/**
 * 联系方式同行分隔符（R-05）。
 *
 * 单独一个命名空间而不是塞进 `workbench`：`zh-CN.ts` 与 `zh-CN.workbench.ts` 都已接近
 * 500 行预算，新增一组下拉选项放在这里可以整块删除而不牵动其它文案。
 */
const contactSeparator = {
  "contactSeparator.label": "分隔符",
  "contactSeparator.option.space": "空格",
  "contactSeparator.option.bar": "竖线",
  "contactSeparator.option.dot": "圆点",
  "contactSeparator.hint":
    "联系方式落在同一行时，字段之间印什么。选「空格」与改动前一样；竖线 / 圆点用于把手机号、邮箱这类并排信息分得更开。",
};

export default contactSeparator;
