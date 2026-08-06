import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface SourceLocation {
  file: string;
  line: number;
}

export interface IpcRegistration {
  channel: string;
  kind: 'handle' | 'on';
  source: SourceLocation;
}

export interface PreloadMethod {
  method: string;
  channels: string[];
  source: SourceLocation;
}

export interface ElectronCapabilitySourceInventory {
  ipcRegistrations: IpcRegistration[];
  preloadMethods: PreloadMethod[];
  mcpTools: string[];
}

function location(node: ts.Node, desktopRoot: string): SourceLocation {
  const sourceFile = node.getSourceFile();
  return {
    file: path.relative(desktopRoot, sourceFile.fileName).replaceAll(path.sep, '/'),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  };
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function resolveString(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): string | null {
  const current = unwrap(expression);
  if (seen.has(current)) {
    return null;
  }
  seen.add(current);
  if (ts.isStringLiteralLike(current)) {
    return current.text;
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveString(current.left, checker, seen);
    const right = resolveString(current.right, checker, seen);
    return left !== null && right !== null ? left + right : null;
  }
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const constant = checker.getConstantValue(current);
    if (typeof constant === 'string') {
      return constant;
    }
  }

  let symbol = checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(current)
      ? current.name
      : ts.isElementAccessExpression(current)
        ? current.argumentExpression
        : current,
  );
  if (!symbol) {
    return null;
  }
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  for (const declaration of symbol.declarations ?? []) {
    if (
      (ts.isVariableDeclaration(declaration)
        || ts.isPropertyAssignment(declaration)
        || ts.isParameter(declaration)
        || ts.isBindingElement(declaration))
      && declaration.initializer
    ) {
      const value = resolveString(declaration.initializer, checker, seen);
      if (value !== null) {
        return value;
      }
    }
    if (ts.isEnumMember(declaration) && declaration.initializer) {
      const value = resolveString(declaration.initializer, checker, seen);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function callOn(
  node: ts.Node,
  receiver: string,
  methods: readonly string[],
): node is ts.CallExpression & { expression: ts.PropertyAccessExpression } {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === receiver
    && methods.includes(node.expression.name.text);
}

function createProgram(desktopRoot: string): ts.Program {
  const configPath = path.join(desktopRoot, 'tsconfig.main.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  const config = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    desktopRoot,
    undefined,
    configPath,
  );
  const mainRoot = path.join(desktopRoot, 'src/main');
  const mainFiles = fs.readdirSync(mainRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`));
  return ts.createProgram(
    [
      path.join(desktopRoot, 'src/preload/index.ts'),
      path.join(desktopRoot, 'src/mcp/standalone/src/handlers/index.ts'),
      ...mainFiles,
    ],
    { ...config.options, allowJs: false, skipLibCheck: true },
  );
}

function findApiObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression {
  let api: ts.ObjectLiteralExpression | undefined;
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) {
      return;
    }
    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === 'api'
        && declaration.initializer
      ) {
        const initializer = unwrap(declaration.initializer);
        if (ts.isObjectLiteralExpression(initializer)) {
          api = initializer;
        }
      }
    }
  });
  if (!api) {
    throw new Error(`Unable to find the preload api object in ${sourceFile.fileName}`);
  }
  return api;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!property.name) {
    return null;
  }
  if (
    ts.isIdentifier(property.name)
    || ts.isStringLiteralLike(property.name)
    || ts.isNumericLiteral(property.name)
  ) {
    return property.name.text;
  }
  return null;
}

function referencedChannels(node: ts.Node, checker: ts.TypeChecker): string[] {
  const channels = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (callOn(current, 'ipcRenderer', ['invoke', 'send', 'on', 'once'])) {
      const argument = current.arguments[0];
      const channel = argument ? resolveString(argument, checker) : null;
      if (channel !== null) {
        channels.add(channel);
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return [...channels].sort();
}

function preloadMethods(
  api: ts.ObjectLiteralExpression,
  checker: ts.TypeChecker,
  desktopRoot: string,
): PreloadMethod[] {
  const result: PreloadMethod[] = [];
  const visit = (object: ts.ObjectLiteralExpression, prefix: string[]): void => {
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        throw new Error(`Preload API spread is not statically reviewable: ${property.getText()}`);
      }
      const name = propertyName(property);
      if (name === null) {
        throw new Error(`Computed preload API property is not statically reviewable: ${property.getText()}`);
      }
      const method = [...prefix, name];
      if (ts.isMethodDeclaration(property)) {
        result.push({
          method: method.join('.'),
          channels: referencedChannels(property, checker),
          source: location(property, desktopRoot),
        });
      } else if (ts.isPropertyAssignment(property)) {
        const initializer = unwrap(property.initializer);
        if (ts.isObjectLiteralExpression(initializer)) {
          visit(initializer, method);
        } else if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          result.push({
            method: method.join('.'),
            channels: referencedChannels(initializer, checker),
            source: location(property, desktopRoot),
          });
        }
      }
    }
  };
  visit(api, []);
  return result.sort((left, right) => left.method.localeCompare(right.method));
}

function assertSinglePreloadContract(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): void {
  const exposures: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (callOn(node, 'contextBridge', ['exposeInMainWorld'])) {
      exposures.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (exposures.length !== 1) {
    throw new Error(
      `Expected one contextBridge exposure in ${sourceFile.fileName}, found ${exposures.length}`,
    );
  }
  const [worldName, exposedValue] = exposures[0].arguments;
  const exposedExpression = exposedValue ? unwrap(exposedValue) : null;
  if (
    !worldName
    || resolveString(worldName, checker) !== 'electronAPI'
    || !exposedExpression
    || !ts.isIdentifier(exposedExpression)
    || exposedExpression.text !== 'api'
  ) {
    throw new Error('The preload contextBridge must expose the reviewed api object as electronAPI');
  }
}

export function extractElectronCapabilitySources(
  desktopRoot: string,
): ElectronCapabilitySourceInventory {
  const program = createProgram(desktopRoot);
  const checker = program.getTypeChecker();
  const preloadPath = path.join(desktopRoot, 'src/preload/index.ts');
  const handlerPath = path.join(desktopRoot, 'src/mcp/standalone/src/handlers/index.ts');
  const preloadSource = program.getSourceFile(preloadPath);
  const handlerSource = program.getSourceFile(handlerPath);
  if (!preloadSource || !handlerSource) {
    throw new Error('Capability source files are missing from the TypeScript program');
  }
  assertSinglePreloadContract(preloadSource, checker);

  const ipcRegistrations: IpcRegistration[] = [];
  const mcpTools = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (callOn(node, 'ipcMain', ['handle', 'on'])) {
        const argument = node.arguments[0];
        const channel = argument ? resolveString(argument, checker) : null;
        if (channel === null) {
          const relativeSource = path.relative(desktopRoot, sourceFile.fileName).replaceAll('\\', '/');
          let ancestor: ts.Node | undefined = node.parent;
          while (ancestor && !ts.isPropertyAssignment(ancestor)) {
            ancestor = ancestor.parent;
          }
          const isVerifiedPackageRegistrarAdapter = (
            relativeSource === 'src/main/ipc/index.ts'
            && argument !== undefined
            && ts.isIdentifier(argument)
            && argument.text === 'channel'
            && ancestor !== undefined
            && ts.isPropertyAssignment(ancestor)
            && ts.isIdentifier(ancestor.name)
            && ancestor.name.text === 'registerIpcHandler'
          );
          if (isVerifiedPackageRegistrarAdapter) {
            ts.forEachChild(node, visit);
            return;
          }
          const source = location(node, desktopRoot);
          throw new Error(`Unresolved IPC registration at ${source.file}:${source.line}`);
        }
        ipcRegistrations.push({
          channel,
          kind: node.expression.name.text as 'handle' | 'on',
          source: location(node, desktopRoot),
        });
      }
      if (
        sourceFile === handlerSource
        && ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'registerTool'
      ) {
        const argument = node.arguments[0];
        const tool = argument ? resolveString(argument, checker) : null;
        if (tool === null) {
          const source = location(node, desktopRoot);
          throw new Error(`Unresolved MCP tool registration at ${source.file}:${source.line}`);
        }
        mcpTools.add(tool);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  ipcRegistrations.sort((left, right) => (
    left.channel.localeCompare(right.channel)
    || left.source.file.localeCompare(right.source.file)
    || left.source.line - right.source.line
  ));
  return {
    ipcRegistrations,
    preloadMethods: preloadMethods(findApiObject(preloadSource), checker, desktopRoot),
    mcpTools: [...mcpTools].sort(),
  };
}
