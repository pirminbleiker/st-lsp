import {
	Connection,
	Diagnostic,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parse } from '../parser/parser';
import {
	AssignmentStatement,
	BinaryExpression,
	CallArgument,
	CallExpression,
	CallStatement,
	CaseStatement,
	Expression,
	ForStatement,
	FunctionBlockDeclaration,
	FunctionDeclaration,
	IfStatement,
	MemberExpression,
	NameExpression,
	ProgramDeclaration,
	RepeatStatement,
	SourceFile,
	Statement,
	SubscriptExpression,
	TypeDeclarationBlock,
	UnaryExpression,
	VarDeclaration,
	WhileStatement,
} from '../parser/ast';
import { BUILTIN_TYPES } from '../twincat/types';
import { STANDARD_FBS } from '../twincat/stdlib';
import { extractStFromTwinCAT, OffsetMap } from '../twincat/tcExtractor';

// ---------------------------------------------------------------------------
// Known-always-allowed identifier names (case-insensitive)
// ---------------------------------------------------------------------------

const ALWAYS_ALLOWED = new Set([
	'TRUE', 'FALSE', 'NULL',
	'SUPER', 'THIS',
]);

// Pre-build sets of builtin type names and standard FB names (uppercase)
const BUILTIN_TYPE_NAMES = new Set(BUILTIN_TYPES.map(t => t.name.toUpperCase()));
const STANDARD_FB_NAMES = new Set(STANDARD_FBS.map(fb => fb.name.toUpperCase()));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAllowedName(name: string): boolean {
	const upper = name.toUpperCase();
	return ALWAYS_ALLOWED.has(upper)
		|| BUILTIN_TYPE_NAMES.has(upper)
		|| STANDARD_FB_NAMES.has(upper);
}

/**
 * Collect all VarDeclaration names from a POU's var blocks (all sections).
 * Returns a Set of uppercase names.
 */
function collectPouVarNames(
	pou: ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration,
): Set<string> {
	const names = new Set<string>();
	for (const vb of pou.varBlocks) {
		for (const vd of vb.declarations) {
			names.add(vd.name.toUpperCase());
		}
	}
	return names;
}

/**
 * Collect duplicate VarDeclaration names within a single POU.
 * Returns a map from uppercase name → array of VarDeclaration nodes with that name.
 */
function findDuplicateVarDeclarations(
	pou: ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration,
): Map<string, VarDeclaration[]> {
	// Group all declarations by uppercase name
	const groups = new Map<string, VarDeclaration[]>();
	for (const vb of pou.varBlocks) {
		for (const vd of vb.declarations) {
			const key = vd.name.toUpperCase();
			let arr = groups.get(key);
			if (!arr) { arr = []; groups.set(key, arr); }
			arr.push(vd);
		}
	}
	// Keep only those with more than one declaration
	const duplicates = new Map<string, VarDeclaration[]>();
	for (const [key, arr] of groups) {
		if (arr.length > 1) duplicates.set(key, arr);
	}
	return duplicates;
}

// ---------------------------------------------------------------------------
// Expression walker — collect all NameExpression nodes that need checking
// ---------------------------------------------------------------------------

/**
 * Walk an expression tree and invoke `onName` for each NameExpression that
 * should be checked against the scope.
 *
 * Rules:
 * - MemberExpression: check only the BASE, not the member field name.
 * - CallExpression callee: check it (it's a function/FB being called).
 * - SubscriptExpression: check base and index.
 * - Literals and BoolLiteral: skip.
 */
function walkExpression(expr: Expression, onName: (n: NameExpression) => void): void {
	switch (expr.kind) {
		case 'NameExpression':
			onName(expr as NameExpression);
			break;
		case 'BinaryExpression': {
			const e = expr as BinaryExpression;
			walkExpression(e.left, onName);
			walkExpression(e.right, onName);
			break;
		}
		case 'UnaryExpression': {
			const e = expr as UnaryExpression;
			walkExpression(e.operand, onName);
			break;
		}
		case 'SubscriptExpression': {
			const e = expr as SubscriptExpression;
			walkExpression(e.base, onName);
			walkExpression(e.index, onName);
			break;
		}
		case 'MemberExpression': {
			// Only check the base, not the member field name
			const e = expr as MemberExpression;
			walkExpression(e.base, onName);
			break;
		}
		case 'CallExpression': {
			const e = expr as CallExpression;
			walkExpression(e.callee, onName);
			for (const arg of e.args) {
				walkCallArgument(arg, onName);
			}
			break;
		}
		// Literals: IntegerLiteral, RealLiteral, StringLiteral, BoolLiteral — no names
		default:
			break;
	}
}

function walkCallArgument(arg: CallArgument, onName: (n: NameExpression) => void): void {
	walkExpression(arg.value, onName);
}

/**
 * Walk a statement list and invoke `onName` for each NameExpression that
 * should be checked.
 */
function walkStatements(stmts: Statement[], onName: (n: NameExpression) => void): void {
	for (const stmt of stmts) {
		walkStatement(stmt, onName);
	}
}

function walkStatement(stmt: Statement, onName: (n: NameExpression) => void): void {
	switch (stmt.kind) {
		case 'AssignmentStatement': {
			const s = stmt as AssignmentStatement;
			walkExpression(s.left, onName);
			walkExpression(s.right, onName);
			break;
		}
		case 'CallStatement': {
			const s = stmt as CallStatement;
			walkExpression(s.callee, onName);
			for (const arg of s.args) {
				walkCallArgument(arg, onName);
			}
			break;
		}
		case 'IfStatement': {
			const s = stmt as IfStatement;
			walkExpression(s.condition, onName);
			walkStatements(s.then, onName);
			for (const elsif of s.elsifs) {
				walkExpression(elsif.condition, onName);
				walkStatements(elsif.body, onName);
			}
			if (s.else) walkStatements(s.else, onName);
			break;
		}
		case 'ForStatement': {
			const s = stmt as ForStatement;
			// The loop variable itself is declared inline, add it as a known name by
			// treating it as always-known here (we add it to scope below at call site).
			// For the expressions, walk them:
			walkExpression(s.from, onName);
			walkExpression(s.to, onName);
			if (s.by) walkExpression(s.by, onName);
			walkStatements(s.body, onName);
			break;
		}
		case 'WhileStatement': {
			const s = stmt as WhileStatement;
			walkExpression(s.condition, onName);
			walkStatements(s.body, onName);
			break;
		}
		case 'RepeatStatement': {
			const s = stmt as RepeatStatement;
			walkStatements(s.body, onName);
			walkExpression(s.condition, onName);
			break;
		}
		case 'CaseStatement': {
			const s = stmt as CaseStatement;
			walkExpression(s.expression, onName);
			for (const clause of s.cases) {
				for (const val of clause.values) {
					if (val.kind === 'single') {
						walkExpression(val.value, onName);
					} else {
						walkExpression(val.low, onName);
						walkExpression(val.high, onName);
					}
				}
				walkStatements(clause.body, onName);
			}
			if (s.else) walkStatements(s.else, onName);
			break;
		}
		// ReturnStatement, ExitStatement, ContinueStatement, EmptyStatement: no expressions
		default:
			break;
	}
}

// ---------------------------------------------------------------------------
// Collect FOR loop variable names used in a statement list
// ---------------------------------------------------------------------------

/**
 * Collect implicit FOR loop variable names from a body so they can be added
 * to the scope (they are declared inline, not in VAR blocks).
 */
function collectForLoopVars(stmts: Statement[]): Set<string> {
	const names = new Set<string>();
	for (const stmt of stmts) {
		if (stmt.kind === 'ForStatement') {
			const s = stmt as ForStatement;
			names.add(s.variable.toUpperCase());
			// Recurse into the body
			for (const v of collectForLoopVars(s.body)) names.add(v);
		} else if (stmt.kind === 'IfStatement') {
			const s = stmt as IfStatement;
			for (const v of collectForLoopVars(s.then)) names.add(v);
			for (const elsif of s.elsifs) {
				for (const v of collectForLoopVars(elsif.body)) names.add(v);
			}
			if (s.else) for (const v of collectForLoopVars(s.else)) names.add(v);
		} else if (stmt.kind === 'WhileStatement') {
			const s = stmt as WhileStatement;
			for (const v of collectForLoopVars(s.body)) names.add(v);
		} else if (stmt.kind === 'RepeatStatement') {
			const s = stmt as RepeatStatement;
			for (const v of collectForLoopVars(s.body)) names.add(v);
		} else if (stmt.kind === 'CaseStatement') {
			const s = stmt as CaseStatement;
			for (const clause of s.cases) {
				for (const v of collectForLoopVars(clause.body)) names.add(v);
			}
			if (s.else) for (const v of collectForLoopVars(s.else)) names.add(v);
		}
	}
	return names;
}

// ---------------------------------------------------------------------------
// Semantic analysis
// ---------------------------------------------------------------------------

function runSemanticAnalysis(ast: SourceFile): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	// Collect all POU names and type names from the SourceFile (for cross-references)
	const globalNames = new Set<string>();
	for (const decl of ast.declarations) {
		if (
			decl.kind === 'ProgramDeclaration' ||
			decl.kind === 'FunctionBlockDeclaration' ||
			decl.kind === 'FunctionDeclaration' ||
			decl.kind === 'InterfaceDeclaration'
		) {
			globalNames.add((decl as { name: string }).name.toUpperCase());
		} else if (decl.kind === 'TypeDeclarationBlock') {
			const tdb = decl as TypeDeclarationBlock;
			for (const td of tdb.declarations) {
				globalNames.add(td.name.toUpperCase());
			}
		}
	}

	for (const decl of ast.declarations) {
		if (
			decl.kind !== 'ProgramDeclaration' &&
			decl.kind !== 'FunctionBlockDeclaration' &&
			decl.kind !== 'FunctionDeclaration'
		) {
			continue;
		}

		const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;

		// --- Duplicate variable declarations ---
		const duplicates = findDuplicateVarDeclarations(pou);
		for (const [, dupeDecls] of duplicates) {
			// Report an error on each duplicate (all occurrences after the first)
			for (let i = 1; i < dupeDecls.length; i++) {
				const vd = dupeDecls[i];
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					range: {
						start: { line: vd.range.start.line, character: vd.range.start.character },
						end:   { line: vd.range.end.line,   character: vd.range.end.character },
					},
					message: `Duplicate variable declaration '${vd.name}'`,
					source: 'st-lsp',
				});
			}
		}

		// --- Undefined identifier warnings ---

		// Build the scope for this POU
		const scope = new Set<string>(globalNames);

		// Add POU's own var names
		for (const name of collectPouVarNames(pou)) {
			scope.add(name);
		}

		// Add the POU's own name (acts as return variable for FUNCTION)
		scope.add(pou.name.toUpperCase());

		// Add FOR loop variable names from the body
		for (const name of collectForLoopVars(pou.body)) {
			scope.add(name);
		}

		// Walk the body statements and check each NameExpression
		walkStatements(pou.body, (nameExpr: NameExpression) => {
			const upper = nameExpr.name.toUpperCase();

			// Skip always-allowed names and scope-known names
			if (isAllowedName(nameExpr.name)) return;
			if (scope.has(upper)) return;

			diagnostics.push({
				severity: DiagnosticSeverity.Warning,
				range: {
					start: { line: nameExpr.range.start.line, character: nameExpr.range.start.character },
					end:   { line: nameExpr.range.end.line,   character: nameExpr.range.end.character },
				},
				message: `Undefined identifier '${nameExpr.name}'`,
				source: 'st-lsp',
			});
		});

		// Also check method bodies for FunctionBlockDeclarations
		if (decl.kind === 'FunctionBlockDeclaration') {
			const fb = decl as FunctionBlockDeclaration;
			for (const method of fb.methods) {
				// Build method scope: FB scope + method's own vars
				const methodScope = new Set<string>(scope);
				for (const vb of method.varBlocks) {
					for (const vd of vb.declarations) {
						methodScope.add(vd.name.toUpperCase());
					}
				}
				// Add FOR loop vars in method body
				for (const name of collectForLoopVars(method.body)) {
					methodScope.add(name);
				}
				// Add method's own name (return variable)
				methodScope.add(method.name.toUpperCase());

				// Duplicate declarations in method
				const methodDupes = new Map<string, VarDeclaration[]>();
				for (const vb of method.varBlocks) {
					for (const vd of vb.declarations) {
						const key = vd.name.toUpperCase();
						let arr = methodDupes.get(key);
						if (!arr) { arr = []; methodDupes.set(key, arr); }
						arr.push(vd);
					}
				}
				for (const [, dupeDecls] of methodDupes) {
					if (dupeDecls.length > 1) {
						for (let i = 1; i < dupeDecls.length; i++) {
							const vd = dupeDecls[i];
							diagnostics.push({
								severity: DiagnosticSeverity.Error,
								range: {
									start: { line: vd.range.start.line, character: vd.range.start.character },
									end:   { line: vd.range.end.line,   character: vd.range.end.character },
								},
								message: `Duplicate variable declaration '${vd.name}'`,
								source: 'st-lsp',
							});
						}
					}
				}

				walkStatements(method.body, (nameExpr: NameExpression) => {
					const upper = nameExpr.name.toUpperCase();
					if (isAllowedName(nameExpr.name)) return;
					if (methodScope.has(upper)) return;
					diagnostics.push({
						severity: DiagnosticSeverity.Warning,
						range: {
							start: { line: nameExpr.range.start.line, character: nameExpr.range.start.character },
							end:   { line: nameExpr.range.end.line,   character: nameExpr.range.end.character },
						},
						message: `Undefined identifier '${nameExpr.name}'`,
						source: 'st-lsp',
					});
				});
			}
		}
	}

	return diagnostics;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function applyOffsets(diagnostics: Diagnostic[], offsets: OffsetMap): Diagnostic[] {
	return diagnostics.map(d => ({
		...d,
		range: {
			start: {
				line: offsets[d.range.start.line] ?? d.range.start.line,
				character: d.range.start.character,
			},
			end: {
				line: offsets[d.range.end.line] ?? d.range.end.line,
				character: d.range.end.character,
			},
		},
	}));
}

export function validateDocument(connection: Connection, document: TextDocument): void {
	let text = document.getText();
	const extraction = extractStFromTwinCAT(document.uri, text);
	text = extraction.stCode;

	const { ast, errors } = parse(text);

	const parseDiags: Diagnostic[] = errors.map(err => ({
		severity: DiagnosticSeverity.Error,
		range: {
			start: { line: err.range.start.line, character: err.range.start.character },
			end:   { line: err.range.end.line,   character: err.range.end.character },
		},
		message: err.message,
		source: 'st-lsp',
	}));

	// Only run semantic analysis when there are no parse errors, to avoid
	// cascading false positives from partially parsed ASTs.
	const semanticDiags = errors.length === 0 ? runSemanticAnalysis(ast) : [];

	const diagnostics = applyOffsets([...parseDiags, ...semanticDiags], extraction.offsets);
	connection.sendDiagnostics({ uri: document.uri, diagnostics });
}
