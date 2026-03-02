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
  FunctionDeclaration,
  FunctionBlockDeclaration,
  VarBlock,
  VarDeclaration,
} from '../parser/ast';

/**
 * Walk backwards from offset in text to find:
 * 1. The most recent unclosed `(` — that's the active call site
 * 2. The identifier immediately before that `(` — the callee name
 * 3. The number of commas at the current nesting level — the active param index
 */
function findActiveCall(
  text: string,
  offset: number,
): { callee: string; activeParam: number } | null {
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
      return callee ? { callee, activeParam: commas } : null;
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

interface ParamInfo {
  name: string;
  type: string;
  description: string;
}

interface CallableSignature {
  label: string;
  description: string;
  params: ParamInfo[];
}

/**
 * Build a CallableSignature from a FunctionDeclaration or FunctionBlockDeclaration AST node.
 */
function buildSignatureFromPou(
  decl: FunctionDeclaration | FunctionBlockDeclaration,
): CallableSignature {
  const inputParams: ParamInfo[] = [];
  for (const vb of decl.varBlocks) {
    const varBlock = vb as VarBlock;
    if (varBlock.varKind !== 'VAR_INPUT') continue;
    for (const vd of varBlock.declarations) {
      const varDecl = vd as VarDeclaration;
      inputParams.push({
        name: varDecl.name,
        type: varDecl.type.name,
        description: '',
      });
    }
  }
  const kindLabel =
    decl.kind === 'FunctionDeclaration' ? 'FUNCTION' : 'FUNCTION_BLOCK';
  return {
    label: decl.name,
    description: `${kindLabel} ${decl.name}`,
    params: inputParams,
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
 * Look up a callable by name in:
 *  1. Standard library FBs
 *  2. FUNCTIONs and FUNCTION_BLOCKs declared in the parsed AST (by type name)
 *  3. Variables whose declared type is a known FUNCTION_BLOCK (instance call)
 */
function lookupCallable(
  name: string,
  stSource: string,
): CallableSignature | null {
  const upper = name.toUpperCase();

  // 1. Standard library FBs (case-insensitive)
  const stdFb = STANDARD_FBS.find((fb) => fb.name === upper);
  if (stdFb) {
    return {
      label: stdFb.name,
      description: stdFb.description,
      params: stdFb.inputs.map((p) => ({
        name: p.name,
        type: p.type,
        description: p.description,
      })),
    };
  }

  // 2. User-defined FUNCTIONs and FUNCTION_BLOCKs in the current file — match by type name
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

  // 3. Variable instance call: resolve var name to its type, then look up by type
  const typeName = resolveVarType(name, stSource);
  if (typeName) {
    const typeUpper = typeName.toUpperCase();

    // Check standard FBs for the resolved type
    const stdFbForType = STANDARD_FBS.find((fb) => fb.name === typeUpper);
    if (stdFbForType) {
      return {
        label: stdFbForType.name,
        description: stdFbForType.description,
        params: stdFbForType.inputs.map((p) => ({
          name: p.name,
          type: p.type,
          description: p.description,
        })),
      };
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
 * Build a SignatureInformation object from a CallableSignature.
 */
function buildSignatureInformation(sig: CallableSignature): SignatureInformation {
  const paramLabels = sig.params.map((p) => `${p.name}: ${p.type}`);
  const fullLabel = `${sig.label}(${paramLabels.join(', ')})`;

  const parameters: ParameterInformation[] = sig.params.map((p) => ({
    label: `${p.name}: ${p.type}`,
    documentation: p.description
      ? { kind: 'markdown' as const, value: p.description }
      : undefined,
  }));

  return {
    label: fullLabel,
    documentation: { kind: 'markdown', value: sig.description },
    parameters,
  };
}

export function handleSignatureHelp(
  params: SignatureHelpParams,
  document: TextDocument | undefined,
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

  const sig = lookupCallable(activeCall.callee, stSource);
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
