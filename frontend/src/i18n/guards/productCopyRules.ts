// SPDX-License-Identifier: Apache-2.0
import ts from "typescript";
import { propertyName } from "./productCopyReferences";

/** These are UI contracts, not a language or spelling heuristic. */
export const COPY_PROPERTIES: ReadonlySet<string> = new Set([
  "label",
  "title",
  "subtitle",
  "heading",
  "description",
  "placeholder",
  "tooltip",
  "help",
  "extra",
  "content",
  "children",
  "message",
  "reason",
  "action",
  "body",
  "summary",
  "emptyText",
  "loadingText",
  "okText",
  "cancelText",
  "confirmText",
  "retryLabel",
  "ariaLabel",
  "aria-label",
  "aria-description",
  "alt",
  "__html",
]);

const TECHNICAL_PROPERTIES = new Set(["style", "styles", "className", "classNames", "css"]);
const NOTIFICATION_METHODS = new Set([
  "success",
  "error",
  "warning",
  "warn",
  "info",
  "loading",
  "open",
  "confirm",
]);
const NAMESPACE_TRANSLATION_HELPERS = new Set(["at", "bt", "ot", "pt", "rt"]);

function accessParts(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    return [...accessParts(expression.expression), expression.name.text];
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    return [
      ...accessParts(expression.expression),
      argument && ts.isStringLiteralLike(argument) ? argument.text : "*",
    ];
  }
  return [];
}

/** Message APIs, user-facing errors and browser dialogs consume their first argument. */
export function isCopyCall(expression: ts.Expression, construct = false): boolean {
  const parts = accessParts(expression);
  const last = parts[parts.length - 1] ?? "";
  if (construct) return /^(?:Error|TypeError|RangeError|ApiError|Notification)$/.test(last);
  if (parts.length === 1) {
    return /^(?:alert|confirm|prompt|setError|setErrorMessage|setSuccessMessage)$/.test(last);
  }
  const receiver = parts[parts.length - 2] ?? "";
  return (
    /^(?:message|notification|modal|toast)(?:Api)?$/i.test(receiver) &&
    (last === "*" || NOTIFICATION_METHODS.has(last))
  );
}

export function isTranslationCall(expression: ts.Expression): boolean {
  const parts = accessParts(expression);
  const name = parts[parts.length - 1];
  if (name === "t" || name === "translate") return true;
  // Namespace helpers are thin wrappers around module-level t(). Their first
  // argument is a compile-time message key, never product copy.
  return parts.length === 1 && NAMESPACE_TRANSLATION_HELPERS.has(name ?? "");
}

/** CSS/script bodies and console payloads are technical even if a field is named title. */
export function isTechnicalContext(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isJsxAttribute(current) && TECHNICAL_PROPERTIES.has(current.name.getText())) return true;
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      ts.isObjectLiteralExpression(current.initializer) &&
      /^(?:styles?|css)$|(?:Styles?|CSS)$/.test(current.name.text)
    ) {
      return true;
    }
    if (ts.isPropertyAssignment(current)) {
      const name = propertyName(current.name);
      if (name && TECHNICAL_PROPERTIES.has(name)) return true;
    }
    if (ts.isJsxElement(current)) {
      const tag = current.openingElement.tagName.getText();
      if (tag === "style" || tag === "script") return true;
    }
    if (ts.isCallExpression(current)) {
      if (accessParts(current.expression)[0] === "console") return true;
      if (isTranslationCall(current.expression)) return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * 形如 `editor.field.school` 的 locale key：全小写开头、点分或连字符分段、无空格。
 *
 * 这类字符串是**指向语言包的引用**，本身不是要显示给用户的文案。不排除它们，
 * 从字面量改写成 key 的迁移会被判成"新增产品文案"——2026-10-27 迁 `profileText`
 * 的三张字段表时就是这样撞上的：值换成了 `editor.field.xxx`，指纹反而多出两条。
 */
const LOCALE_KEY = /^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$/;

export function hasCopyText(value: string): boolean {
  if (LOCALE_KEY.test(value.trim())) return false;
  return /[\p{L}\p{N}]/u.test(value);
}
