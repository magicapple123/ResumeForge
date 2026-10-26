// SPDX-License-Identifier: Apache-2.0
import ts from "typescript";

export type ResolvedCopyValue = ts.Expression | ts.FunctionDeclaration | ts.BindingElement;
type LocalValue = ResolvedCopyValue;
type Bindings = Map<string, LocalValue | undefined>;

/** Resolve local bindings without evaluating application code or following imports. */
export function createReferenceResolver(sourceFile: ts.SourceFile) {
  const scopes = new Map<ts.Node, Bindings>();
  const scopeOf = (node: ts.Node): ts.Node => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isBlock(current) && !ts.isFunctionLike(current)) {
      if (ts.isSourceFile(current)) return current;
      current = current.parent;
    }
    return current ?? sourceFile;
  };
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) {
      const scope = scopeOf(node);
      const bindings = scopes.get(scope) ?? new Map<string, LocalValue | undefined>();
      const register = (name: ts.BindingName, value: LocalValue | undefined): void => {
        if (ts.isIdentifier(name)) bindings.set(name.text, value);
        else {
          for (const element of name.elements) {
            if (ts.isBindingElement(element)) register(element.name, element);
          }
        }
      };
      if (ts.isFunctionDeclaration(node)) {
        if (node.name) register(node.name, node);
      } else register(node.name, node.initializer);
      scopes.set(scope, bindings);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const resolveName = (name: ts.Identifier): LocalValue | undefined => {
    let current: ts.Node | undefined = name;
    while (current) {
      const bindings = scopes.get(current);
      if (bindings?.has(name.text)) return bindings.get(name.text);
      current = current.parent;
    }
    return undefined;
  };

  const propertyValue = (value: ResolvedCopyValue, key: string): LocalValue | undefined => {
    if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(property.name) === key) {
          return property.initializer;
        }
        if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) {
          return resolveName(property.name);
        }
      }
    } else if (ts.isArrayLiteralExpression(value) && /^\d+$/.test(key)) {
      const element = value.elements[Number(key)];
      if (element && !ts.isOmittedExpression(element) && !ts.isSpreadElement(element))
        return element;
    }
    return undefined;
  };

  const resolveBinding = (
    element: ts.BindingElement,
    seen: Set<ts.Node>,
  ): LocalValue | undefined => {
    const pattern = element.parent;
    const owner = pattern.parent;
    const origin = ts.isBindingElement(owner)
      ? resolveBinding(owner, seen)
      : ts.isVariableDeclaration(owner) || ts.isParameter(owner)
        ? owner.initializer
        : undefined;
    const key = ts.isArrayBindingPattern(pattern)
      ? String(pattern.elements.indexOf(element))
      : element.propertyName
        ? propertyName(element.propertyName)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
    const value =
      origin && key !== undefined ? propertyValue(resolve(origin, seen), key) : undefined;
    return value ?? element.initializer;
  };

  const resolve = (expression: LocalValue, seen = new Set<ts.Node>()): ResolvedCopyValue => {
    if (seen.has(expression)) return expression;
    seen.add(expression);
    if (ts.isBindingElement(expression)) {
      const binding = resolveBinding(expression, seen);
      return binding ? resolve(binding, seen) : expression;
    }
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    ) {
      return resolve(expression.expression, seen);
    }
    if (ts.isIdentifier(expression)) {
      const binding = resolveName(expression);
      return binding ? resolve(binding, seen) : expression;
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const receiver = resolve(expression.expression, seen);
      const key = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)
          ? expression.argumentExpression.text
          : undefined;
      if (key !== undefined) {
        const value = propertyValue(receiver, key);
        if (value) return resolve(value, seen);
      }
    }
    return expression;
  };
  return resolve;
}

export function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}
