/**
 * Code Action (QuickFix) handler for IEC 61131-3 Structured Text.
 *
 * Provides three quick-fix actions:
 *   1. Declare variable — triggered by "Undefined identifier 'X'" diagnostic
 *   2. Uppercase keyword — triggered by any lowercase keyword in the selection range
 *   3. Add missing END_IF / END_FOR / END_WHILE — triggered by parse error diagnostics
 */

import {
	CodeAction,
	CodeActionKind,
	CodeActionParams,
	TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parse } from '../parser/parser';
import { Lexer, TokenKind } from '../parser/lexer';
import {
	FunctionBlockDeclaration,
	FunctionDeclaration,
	Position,
	ProgramDeclaration,
	SourceFile,
} from '../parser/ast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Pou = ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function positionLe(a: Position, b: Position): boolean {
	return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

function rangesOverlap(
	aStart: Position, aEnd: Position,
	bStart: Position, bEnd: Position,
): boolean {
	return positionLe(aStart, bEnd) && positionLe(bStart, aEnd);
}

function findEnclosingPou(ast: SourceFile, pos: Position): Pou | null {
	for (const decl of ast.declarations) {
		const { start, end } = decl.range;
		if (!positionLe(start, pos) || !positionLe(pos, end)) continue;
		if (
			decl.kind === 'ProgramDeclaration' ||
			decl.kind === 'FunctionBlockDeclaration' ||
			decl.kind === 'FunctionDeclaration'
		) {
			return decl as Pou;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Action 1: Declare variable
// ---------------------------------------------------------------------------

const UNDEFINED_IDENTIFIER_RE = /^Undefined identifier '(.+)'$/;

function declareVariableActions(
	params: CodeActionParams,
	doc: TextDocument,
	ast: SourceFile,
): CodeAction[] {
	const actions: CodeAction[] = [];
	for (const diag of params.context.diagnostics) {
		const match = diag.message.match(UNDEFINED_IDENTIFIER_RE);
		if (!match) continue;
		const name = match[1];

		const pou = findEnclosingPou(ast, diag.range.start);
		if (!pou) continue;

		const varBlock = pou.varBlocks.find(vb => vb.varKind === 'VAR');
		let edit: TextEdit;

		if (varBlock) {
			// Insert the declaration before END_VAR
			const endVarLine = varBlock.range.end.line;
			edit = {
				range: {
					start: { line: endVarLine, character: 0 },
					end: { line: endVarLine, character: 0 },
				},
				newText: `\t${name} : UNKNOWN;\n`,
			};
		} else {
			// No VAR block — insert one after the POU header line
			const afterHeader = pou.range.start.line + 1;
			edit = {
				range: {
					start: { line: afterHeader, character: 0 },
					end: { line: afterHeader, character: 0 },
				},
				newText: `VAR\n\t${name} : UNKNOWN;\nEND_VAR\n`,
			};
		}

		actions.push({
			title: `Declare '${name}' as VAR`,
			kind: CodeActionKind.QuickFix,
			diagnostics: [diag],
			edit: {
				changes: { [doc.uri]: [edit] },
			},
		});
	}
	return actions;
}

// ---------------------------------------------------------------------------
// Action 2: Uppercase keyword
// ---------------------------------------------------------------------------

// Keywords that should always be uppercase in ST style
const KEYWORD_KINDS = new Set<TokenKind>([
	TokenKind.PROGRAM, TokenKind.END_PROGRAM,
	TokenKind.FUNCTION_BLOCK, TokenKind.END_FUNCTION_BLOCK,
	TokenKind.FUNCTION, TokenKind.END_FUNCTION,
	TokenKind.VAR, TokenKind.VAR_INPUT, TokenKind.VAR_OUTPUT,
	TokenKind.VAR_IN_OUT, TokenKind.VAR_GLOBAL, TokenKind.VAR_EXTERNAL,
	TokenKind.VAR_TEMP, TokenKind.VAR_STAT, TokenKind.END_VAR,
	TokenKind.IF, TokenKind.THEN, TokenKind.ELSE, TokenKind.ELSIF, TokenKind.END_IF,
	TokenKind.FOR, TokenKind.TO, TokenKind.BY, TokenKind.DO, TokenKind.END_FOR,
	TokenKind.WHILE, TokenKind.END_WHILE,
	TokenKind.REPEAT, TokenKind.UNTIL, TokenKind.END_REPEAT,
	TokenKind.CASE, TokenKind.OF, TokenKind.END_CASE,
	TokenKind.RETURN, TokenKind.EXIT, TokenKind.CONTINUE,
	TokenKind.NOT, TokenKind.AND, TokenKind.OR, TokenKind.XOR, TokenKind.MOD,
	TokenKind.TYPE, TokenKind.END_TYPE,
	TokenKind.STRUCT, TokenKind.END_STRUCT,
]);

function uppercaseKeywordActions(
	params: CodeActionParams,
	doc: TextDocument,
): CodeAction[] {
	const actions: CodeAction[] = [];
	const tokens = new Lexer(doc.getText()).tokenize();
	const { start: reqStart, end: reqEnd } = params.range;

	for (const tok of tokens) {
		if (!KEYWORD_KINDS.has(tok.kind)) continue;
		const upper = tok.text.toUpperCase();
		if (tok.text === upper) continue; // already uppercase
		if (!rangesOverlap(tok.range.start, tok.range.end, reqStart, reqEnd)) continue;

		actions.push({
			title: `Uppercase '${tok.text}' → '${upper}'`,
			kind: CodeActionKind.QuickFix,
			edit: {
				changes: {
					[doc.uri]: [{
						range: { start: tok.range.start, end: tok.range.end },
						newText: upper,
					}],
				},
			},
		});
	}
	return actions;
}

// ---------------------------------------------------------------------------
// Action 3: Add missing END_IF / END_FOR / END_WHILE
// ---------------------------------------------------------------------------

const MISSING_END_RE = /^Expected '(END_IF|END_FOR|END_WHILE)'$/;

function addMissingEndActions(
	params: CodeActionParams,
	doc: TextDocument,
	ast: SourceFile,
): CodeAction[] {
	const actions: CodeAction[] = [];
	for (const diag of params.context.diagnostics) {
		const match = diag.message.match(MISSING_END_RE);
		if (!match) continue;
		const endKeyword = match[1];

		const pou = findEnclosingPou(ast, diag.range.start);
		const insertLine = pou ? pou.range.end.line : diag.range.end.line + 1;

		actions.push({
			title: `Add missing '${endKeyword};'`,
			kind: CodeActionKind.QuickFix,
			diagnostics: [diag],
			edit: {
				changes: {
					[doc.uri]: [{
						range: {
							start: { line: insertLine, character: 0 },
							end: { line: insertLine, character: 0 },
						},
						newText: `${endKeyword};\n`,
					}],
				},
			},
		});
	}
	return actions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function handleCodeActions(
	params: CodeActionParams,
	doc: TextDocument | undefined,
): CodeAction[] {
	if (!doc) return [];
	const { ast } = parse(doc.getText());
	return [
		...declareVariableActions(params, doc, ast),
		...uppercaseKeywordActions(params, doc),
		...addMissingEndActions(params, doc, ast),
	];
}
