import {
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  SignatureHelpParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getOrParse } from './shared';
import { parse } from '../parser/parser';
import { STANDARD_FBS } from '../twincat/stdlib';
import {
  Expression,
  FunctionDeclaration,
  FunctionBlockDeclaration,
  MethodDeclaration,
  VarBlock,
  VarDeclaration,
  VarKind,
} from '../parser/ast';
import type { WorkspaceIndex } from '../twincat/workspaceIndex';
import type { LibrarySymbol, LibraryMethod } from '../twincat/libraryZipReader';

/**
 * Walk backwards from offset in text to find:
 * 1. The most recent unclosed `(` — that's the active call site
 * 2. The identifier immediately before that `(` — the callee name
 * 3. Optionally, a receiver before a `.` (for method calls like `inst.Method(`)
 * 4. The number of commas at the current nesting level — the active param index
 */
function findActiveCall(
  text: string,
  offset: number,
): { callee: string; receiver?: string; activeParam: number } | null {
  let depth = 0;
  let commas = 0;

  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') {
      depth++;
      continue;
    }
    if (ch === '(') {
      if (depth > 0) {
        depth--;
        continue;
      }
      // Found the opening paren — get the callee identifier before it
      const callee = getIdentifierBefore(text, i);
      if (!callee) return null;

      // Check if there's a dot before the callee (method call)
      const calleeStart = i - 1 - (text.slice(0, i).length - text.slice(0, i).trimEnd().length);
      const beforeCallee = i - 1;
      let dotPos = beforeCallee;
      // Walk back past whitespace to find the callee start
      while (dotPos >= 0 && /[\w]/.test(text[dotPos])) dotPos--;
      while (dotPos >= 0 && text[dotPos] === ' ') dotPos--;

      if (dotPos >= 0 && text[dotPos] === '.') {
        const receiver = getIdentifierBefore(text, dotPos);
        if (receiver) {
          return { callee, receiver, activeParam: commas };
        }
      }

      return { callee, activeParam: commas };
    }
    if (ch === ',' && depth === 0) {
      commas++;
    }
  }
  return null;
}

/**
 * Extract the identifier immediately before position `pos` in `text`,
 * skipping any leading whitespace.
 */
function getIdentifierBefore(text: string, pos: number): string {
  let end = pos - 1;
  while (end >= 0 && text[end] === ' ') end--;
  if (end < 0 || !/[\w]/.test(text[end])) return '';
  let start = end;
  while (start > 0 && /[\w]/.test(text[start - 1])) start--;
  return text.slice(start, end + 1);
}

type ParamDirection = 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT';

interface ParamInfo {
  name: string;
  type: string;
  description: string;
  direction: ParamDirection;
  optional?: boolean;
  defaultValue?: string;
}

interface CallableSignature {
  label: string;
  description: string;
  params: ParamInfo[];
  returnType?: string;
}

/**
 * Render an AST Expression to a simple string for default value display.
 */
function renderExpression(expr: Expression): string {
  switch (expr.kind) {
    case 'IntegerLiteral':
    case 'RealLiteral':
      return expr.raw;
    case 'StringLiteral':
      return expr.raw;
    case 'BoolLiteral':
      return expr.value ? 'TRUE' : 'FALSE';
    case 'NameExpression':
      return expr.name;
    case 'UnaryExpression':
      return `${expr.op}${renderExpression(expr.operand)}`;
    case 'BinaryExpression':
      return `${renderExpression(expr.left)} ${expr.op} ${renderExpression(expr.right)}`;
    default:
      return '...';
  }
}

/**
 * Build a CallableSignature from a FunctionDeclaration or FunctionBlockDeclaration AST node.
 */
function buildSignatureFromPou(
  decl: FunctionDeclaration | FunctionBlockDeclaration,
): CallableSignature {
  const params: ParamInfo[] = [];
  const relevantKinds: VarKind[] = ['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT'];

  for (const vb of decl.varBlocks) {
    const varBlock = vb as VarBlock;
    if (!relevantKinds.includes(varBlock.varKind)) continue;
    for (const vd of varBlock.declarations) {
      const varDecl = vd as VarDeclaration;
      const hasDefault = varDecl.initialValue != null;
      params.push({
        name: varDecl.name,
        type: varDecl.type.name,
        description: '',
        direction: varBlock.varKind as ParamDirection,
        optional: hasDefault ? true : undefined,
        defaultValue: hasDefault ? renderExpression(varDecl.initialValue!) : undefined,
      });
    }
  }

  const kindLabel =
    decl.kind === 'FunctionDeclaration' ? 'FUNCTION' : 'FUNCTION_BLOCK';

  const returnType =
    decl.kind === 'FunctionDeclaration' && decl.returnType
      ? decl.returnType.name
      : undefined;

  return {
    label: decl.name,
    description: `${kindLabel} ${decl.name}`,
    params,
    returnType,
  };
}

/**
 * Build a CallableSignature from an AST MethodDeclaration.
 */
function buildSignatureFromMethod(
  method: MethodDeclaration,
  parentName: string,
): CallableSignature {
  const params: ParamInfo[] = [];
  const relevantKinds: VarKind[] = ['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT'];

  for (const vb of method.varBlocks) {
    const varBlock = vb as VarBlock;
    if (!relevantKinds.includes(varBlock.varKind)) continue;
    for (const vd of varBlock.declarations) {
      const varDecl = vd as VarDeclaration;
      const hasDefault = varDecl.initialValue != null;
      params.push({
        name: varDecl.name,
        type: varDecl.type.name,
        description: '',
        direction: varBlock.varKind as ParamDirection,
        optional: hasDefault ? true : undefined,
        defaultValue: hasDefault ? renderExpression(varDecl.initialValue!) : undefined,
      });
    }
  }

  return {
    label: `${parentName}.${method.name}`,
    description: `METHOD ${method.name}`,
    params,
    returnType: method.returnType?.name,
  };
}

/**
 * Build a CallableSignature from a LibrarySymbol (from zip-based library index).
 */
function buildSignatureFromLibrarySymbol(symbol: LibrarySymbol): CallableSignature {
  const params: ParamInfo[] = [];

  for (const p of symbol.inputs ?? []) {
    params.push({ name: p.name, type: p.type, description: p.comment ?? '', direction: 'VAR_INPUT' });
  }
  for (const p of symbol.outputs ?? []) {
    params.push({ name: p.name, type: p.type, description: p.comment ?? '', direction: 'VAR_OUTPUT' });
  }
  for (const p of symbol.inOuts ?? []) {
    params.push({ name: p.name, type: p.type, description: p.comment ?? '', direction: 'VAR_IN_OUT' });
  }

  return {
    label: symbol.name,
    description: symbol.description ?? `${symbol.kind} ${symbol.name}`,
    params,
    returnType: symbol.returnType,
  };
}

/**
 * Build a CallableSignature from a LibraryMethod.
 */
function buildSignatureFromLibraryMethod(
  method: LibraryMethod,
  parentName: string,
): CallableSignature {
  const params: ParamInfo[] = [];

  for (const p of method.inputs ?? []) {
    params.push({ name: p.name, type: p.type, description: p.comment ?? '', direction: 'VAR_INPUT' });
  }
  for (const p of method.outputs ?? []) {
    params.push({ name: p.name, type: p.type, description: p.comment ?? '', direction: 'VAR_OUTPUT' });
  }

  return {
    label: `${parentName}.${method.name}`,
    description: method.description ?? `METHOD ${method.name}`,
    params,
    returnType: method.returnType,
  };
}

/**
 * Resolve a variable name to its declared type name using all VAR blocks in the AST.
 * Returns the type name string if found, otherwise null.
 */
function resolveVarType(
  varName: string,
  stSource: string,
): string | null {
  const { ast } = parse(stSource);
  const upper = varName.toUpperCase();

  for (const decl of ast.declarations) {
    if (
      decl.kind !== 'ProgramDeclaration' &&
      decl.kind !== 'FunctionBlockDeclaration' &&
      decl.kind !== 'FunctionDeclaration'
    ) {
      continue;
    }
    const pou = decl as
      | import('../parser/ast').ProgramDeclaration
      | FunctionDeclaration
      | FunctionBlockDeclaration;
    for (const vb of pou.varBlocks) {
      for (const vd of vb.declarations) {
        const varDecl = vd as VarDeclaration;
        if (varDecl.name.toUpperCase() === upper) {
          return varDecl.type.name;
        }
      }
    }
  }
  return null;
}

/**
 * Build a CallableSignature from a standard library FB, including all directions.
 */
function buildSignatureFromStdFb(
  fb: (typeof STANDARD_FBS)[number],
): CallableSignature {
  const params: ParamInfo[] = [];

  for (const p of fb.inputs) {
    params.push({ name: p.name, type: p.type, description: p.description, direction: 'VAR_INPUT' });
  }
  for (const p of fb.outputs) {
    params.push({ name: p.name, type: p.type, description: p.description, direction: 'VAR_OUTPUT' });
  }

  return {
    label: fb.name,
    description: fb.description,
    params,
  };
}

/**
 * Look up a callable by name in:
 *  1. Standard library FBs
 *  2. Library symbols from workspace index
 *  3. FUNCTIONs and FUNCTION_BLOCKs declared in the parsed AST (by type name)
 *  4. Variables whose declared type is a known FUNCTION_BLOCK (instance call)
 *
 * For method calls (receiver.method), looks up the method on the receiver's type.
 */
function lookupCallable(
  name: string,
  stSource: string,
  receiver?: string,
  libSymbols?: LibrarySymbol[],
): CallableSignature | null {
  const upper = name.toUpperCase();

  // If this is a method call (receiver.method), resolve the receiver type first
  if (receiver) {
    return lookupMethodCall(receiver, name, stSource, libSymbols);
  }

  // 1. Standard library FBs (case-insensitive)
  const stdFb = STANDARD_FBS.find((fb) => fb.name === upper);
  if (stdFb) {
    return buildSignatureFromStdFb(stdFb);
  }

  // 2. Library symbols from workspace index
  if (libSymbols) {
    const libSym = libSymbols.find((s) => s.name.toUpperCase() === upper);
    if (libSym) {
      return buildSignatureFromLibrarySymbol(libSym);
    }
  }

  // 3. User-defined FUNCTIONs and FUNCTION_BLOCKs in the current file — match by type name
  const { ast } = parse(stSource);
  for (const decl of ast.declarations) {
    if (
      decl.kind === 'FunctionDeclaration' ||
      decl.kind === 'FunctionBlockDeclaration'
    ) {
      const pou = decl as FunctionDeclaration | FunctionBlockDeclaration;
      if (pou.name.toUpperCase() === upper) {
        return buildSignatureFromPou(pou);
      }
    }
  }

  // 4. Variable instance call: resolve var name to its type, then look up by type
  const typeName = resolveVarType(name, stSource);
  if (typeName) {
    const typeUpper = typeName.toUpperCase();

    // Check standard FBs for the resolved type
    const stdFbForType = STANDARD_FBS.find((fb) => fb.name === typeUpper);
    if (stdFbForType) {
      return buildSignatureFromStdFb(stdFbForType);
    }

    // Check library symbols for the resolved type
    if (libSymbols) {
      const libSym = libSymbols.find((s) => s.name.toUpperCase() === typeUpper);
      if (libSym) {
        return buildSignatureFromLibrarySymbol(libSym);
      }
    }

    // Check user-defined FUNCTION_BLOCKs for the resolved type
    for (const decl of ast.declarations) {
      if (decl.kind === 'FunctionBlockDeclaration') {
        const fb = decl as FunctionBlockDeclaration;
        if (fb.name.toUpperCase() === typeUpper) {
          return buildSignatureFromPou(fb);
        }
      }
    }
  }

  return null;
}

/**
 * Look up a method call: resolve the receiver's type, then find the method.
 */
function lookupMethodCall(
  receiver: string,
  methodName: string,
  stSource: string,
  libSymbols?: LibrarySymbol[],
): CallableSignature | null {
  const methodUpper = methodName.toUpperCase();

  // Resolve the receiver variable to its type
  const typeName = resolveVarType(receiver, stSource);
  if (!typeName) return null;
  const typeUpper = typeName.toUpperCase();

  // Check standard library FBs for methods
  const stdFb = STANDARD_FBS.find((fb) => fb.name === typeUpper);
  if (stdFb?.methods) {
    const method = stdFb.methods.find((m) => m.name.toUpperCase() === methodUpper);
    if (method) {
      return {
        label: `${stdFb.name}.${method.name}`,
        description: method.description,
        params: method.params.map((p) => ({
          name: p.name,
          type: p.type,
          description: p.description,
          direction: 'VAR_INPUT' as ParamDirection,
        })),
        returnType: method.returnType,
      };
    }
  }

  // Check library symbols for methods
  if (libSymbols) {
    const libSym = libSymbols.find((s) => s.name.toUpperCase() === typeUpper);
    if (libSym?.methods) {
      const method = libSym.methods.find((m) => m.name.toUpperCase() === methodUpper);
      if (method) {
        return buildSignatureFromLibraryMethod(method, libSym.name);
      }
    }
  }

  // Check user-defined FB methods in the AST
  const { ast } = parse(stSource);
  for (const decl of ast.declarations) {
    if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;
      if (fb.name.toUpperCase() === typeUpper) {
        for (const m of fb.methods) {
          if (m.name.toUpperCase() === methodUpper) {
            return buildSignatureFromMethod(m, fb.name);
          }
        }
      }
    }
  }

  return null;
}

/**
 * Format a parameter label for display, including direction and optional status.
 */
function formatParamLabel(p: ParamInfo): string {
  const parts: string[] = [];

  // Add direction prefix for non-input params
  if (p.direction === 'VAR_OUTPUT') {
    parts.push('OUT');
  } else if (p.direction === 'VAR_IN_OUT') {
    parts.push('INOUT');
  }

  // Name with optional marker
  const name = p.optional ? `${p.name}?` : p.name;
  parts.push(`${name}: ${p.type}`);

  // Default value
  if (p.defaultValue != null) {
    parts.push(`:= ${p.defaultValue}`);
  }

  return parts.join(' ');
}

/**
 * Build a SignatureInformation object from a CallableSignature.
 */
function buildSignatureInformation(sig: CallableSignature): SignatureInformation {
  const paramLabels = sig.params.map(formatParamLabel);
  const returnSuffix = sig.returnType ? ` : ${sig.returnType}` : '';
  const fullLabel = `${sig.label}(${paramLabels.join(', ')})${returnSuffix}`;

  const parameters: ParameterInformation[] = sig.params.map((p) => {
    const label = formatParamLabel(p);
    return {
      label,
      documentation: p.description
        ? { kind: 'markdown' as const, value: p.description }
        : undefined,
    };
  });

  return {
    label: fullLabel,
    documentation: { kind: 'markdown', value: sig.description },
    parameters,
  };
}

export function handleSignatureHelp(
  params: SignatureHelpParams,
  document: TextDocument | undefined,
  workspaceIndex?: WorkspaceIndex,
): SignatureHelp | null {
  if (!document) return null;

  const { extraction, mapper } = getOrParse(document!);
  const stSource = extraction.source;

  // Convert the cursor position to extracted-source coordinates, then compute
  // the character offset within the extracted source.
  const { line, character } = params.position;
  const extractedPos = mapper.originalToExtracted(line, character) ?? { line, character };
  // Compute offset in stSource from extracted position
  const stLines = stSource.split('\n');
  let extractedOffset = 0;
  for (let i = 0; i < extractedPos.line && i < stLines.length; i++) {
    extractedOffset += stLines[i].length + 1; // +1 for newline
  }
  extractedOffset += extractedPos.character;

  const activeCall = findActiveCall(stSource, extractedOffset);
  if (!activeCall) return null;

  const libSymbols = workspaceIndex?.getLibrarySymbols(params.textDocument.uri);

  const sig = lookupCallable(
    activeCall.callee,
    stSource,
    activeCall.receiver,
    libSymbols,
  );
  if (!sig) return null;

  const sigInfo = buildSignatureInformation(sig);

  // Clamp activeParam to valid range (0-based index within params array)
  const activeParam = Math.min(
    activeCall.activeParam,
    sig.params.length > 0 ? sig.params.length - 1 : 0,
  );

  return {
    signatures: [sigInfo],
    activeSignature: 0,
    activeParameter: activeParam,
  };
}
