// SPDX-License-Identifier: Apache-2.0
import ts from "typescript";
import {
  createReferenceResolver,
  propertyName,
  type ResolvedCopyValue,
} from "./productCopyReferences";
import {
  COPY_PROPERTIES,
  hasCopyText,
  isCopyCall,
  isTechnicalContext,
  isTranslationCall,
} from "./productCopyRules";

export interface ProductCopyFinding {
  text: string;
  line: number;
  kind: string;
  fingerprint: string;
}

function assertParseable(sourceFile: ts.SourceFile): void {
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === sourceFile.fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === sourceFile.fileName,
    readFile: () => undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram([sourceFile.fileName], { noLib: true, noResolve: true }, host);
  const errors = program.getSyntacticDiagnostics(sourceFile);
  if (errors.length) {
    const detail = errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, " "));
    throw new SyntaxError(`Cannot parse ${sourceFile.fileName}: ${detail.join("; ")}`);
  }
}

/** A semantic identity stays stable when comments, imports or blank lines move. */
function identity(node: ts.Node): string[] {
  const names: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current) || ts.isFunctionDeclaration(current)) {
      if (current.name) names.push(current.name.getText());
    } else if (ts.isPropertyAssignment(current)) {
      names.push(propertyName(current.name) ?? "computed");
    } else if (ts.isJsxAttribute(current)) {
      names.push(`@${current.name.getText()}`);
    } else if (ts.isJsxElement(current)) {
      names.push(`<${current.openingElement.tagName.getText()}>`);
    } else if (ts.isJsxSelfClosingElement(current)) {
      names.push(`<${current.tagName.getText()}/>`);
    }
    current = current.parent;
  }
  return names.reverse();
}

/** Only output positions are followed: translation keys and branch conditions are not copy. */
export function scanProductCopy(source: string, fileName = "source.tsx"): ProductCopyFinding[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  assertParseable(sourceFile);
  const resolve = createReferenceResolver(sourceFile);
  const findings: ProductCopyFinding[] = [];
  const recorded = new Set<ts.Node>();

  const add = (node: ts.Node, text: string, kind: string, referenced = false): void => {
    if (recorded.has(node) || !hasCopyText(text) || (!referenced && isTechnicalContext(node)))
      return;
    recorded.add(node);
    findings.push({
      text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      kind,
      fingerprint: JSON.stringify([kind, ...identity(node), text]),
    });
  };

  const consume = (
    expression: ResolvedCopyValue,
    visited = new Set<ts.Node>(),
    referenced = false,
  ): void => {
    if (visited.has(expression) || (!referenced && isTechnicalContext(expression))) return;
    visited.add(expression);
    const value = resolve(expression);
    if (value !== expression) {
      consume(value, visited, true);
      return;
    }
    if (ts.isStringLiteralLike(value)) {
      add(value, value.text, "literal", referenced);
    } else if (ts.isTemplateExpression(value)) {
      const text = [value.head.text, ...value.templateSpans.map((span) => span.literal.text)].join(
        "{}",
      );
      add(value, text, "template", referenced);
      for (const span of value.templateSpans) consume(span.expression, visited, referenced);
    } else if (ts.isConditionalExpression(value)) {
      consume(value.whenTrue, visited, referenced);
      consume(value.whenFalse, visited, referenced);
    } else if (ts.isBinaryExpression(value)) {
      const operator = value.operatorToken.kind;
      if (
        operator !== ts.SyntaxKind.PlusToken &&
        operator !== ts.SyntaxKind.BarBarToken &&
        operator !== ts.SyntaxKind.QuestionQuestionToken &&
        operator !== ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        return;
      }
      if (value.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
        consume(value.left, visited, referenced);
      }
      consume(value.right, visited, referenced);
    } else if (ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements) {
        if (!ts.isOmittedExpression(element) && !ts.isSpreadElement(element))
          consume(element, visited, referenced);
      }
    } else if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          COPY_PROPERTIES.has(propertyName(property.name) ?? "")
        ) {
          consume(property.initializer, visited, referenced);
        }
      }
    } else if (ts.isCallExpression(value)) {
      if (isTranslationCall(value.expression)) return;
      const callable = resolve(value.expression);
      if (
        ts.isFunctionDeclaration(callable) ||
        ts.isArrowFunction(callable) ||
        ts.isFunctionExpression(callable)
      ) {
        consume(callable, visited, referenced);
      }
      for (const argument of value.arguments) consume(argument, visited, referenced);
    } else if (
      ts.isArrowFunction(value) ||
      ts.isFunctionExpression(value) ||
      ts.isFunctionDeclaration(value)
    ) {
      if (!value.body) return;
      if (ts.isBlock(value.body)) {
        const returns = (node: ts.Node): void => {
          if (ts.isReturnStatement(node) && node.expression)
            consume(node.expression, visited, referenced);
          else if (!ts.isFunctionLike(node)) ts.forEachChild(node, returns);
        };
        ts.forEachChild(value.body, returns);
      } else consume(value.body, visited, referenced);
    }
  };

  const visit = (node: ts.Node): void => {
    if (isTechnicalContext(node)) return;
    if (ts.isJsxText(node)) {
      add(node, node.text.replace(/\s+/g, " ").trim(), "jsx");
    } else if (ts.isJsxAttribute(node) && COPY_PROPERTIES.has(node.name.getText())) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        add(node.initializer, node.initializer.text, "literal");
      } else if (
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        consume(node.initializer.expression);
      }
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      consume(node.expression);
    } else if (
      ts.isPropertyAssignment(node) &&
      COPY_PROPERTIES.has(propertyName(node.name) ?? "")
    ) {
      consume(node.initializer);
    } else if (ts.isCallExpression(node) && isCopyCall(node.expression)) {
      if (node.arguments[0]) consume(node.arguments[0]);
    } else if (ts.isNewExpression(node) && isCopyCall(node.expression, true)) {
      if (node.arguments?.[0]) consume(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings.sort(
    (left, right) => left.line - right.line || left.text.localeCompare(right.text),
  );
}
