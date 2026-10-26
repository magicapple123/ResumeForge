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
  return name === "t" || name === "translate";
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

export function hasCopyText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}
