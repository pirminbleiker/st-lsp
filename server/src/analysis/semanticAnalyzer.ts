import {
	Diagnostic,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';
import {
	ActionDeclaration,
	ArrayLiteral,
	AssignmentStatement,
	BinaryExpression,
	CallArgument,
	CallExpression,
	CallStatement,
	CaseStatement,
	EmptyStatement,
	EnumDeclaration,
	Expression,
	ForStatement,
	FunctionBlockDeclaration,
	FunctionDeclaration,
	GvlDeclaration,
	IfStatement,
	InterfaceDeclaration,
	MemberExpression,
	NameExpression,
	ProgramDeclaration,
	RepeatStatement,
	SourceFile,
	Statement,
	StructDeclaration,
	StructInitializer,
	SubscriptExpression,
	TypeDeclarationBlock,
	UnaryExpression,
	VarBlock,
	VarDeclaration,
	WhileStatement,
	Range,
} from '../parser/ast';
import { BUILTIN_TYPES } from '../twincat/types';
import { STANDARD_FBS } from '../twincat/stdlib';
import { SYSTEM_TYPE_NAMES, SYSTEM_FUNCTION_NAMES, TYPE_CONVERSION_NAMES } from '../twincat/systemTypes';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import type { LibraryRef } from '../twincat/projectReader';

// ---------------------------------------------------------------------------
// Known-always-allowed identifier names (case-insensitive)
// ---------------------------------------------------------------------------

const ALWAYS_ALLOWED = new Set([
	'TRUE', 'FALSE', 'NULL',
	'SUPER', 'THIS',
	'__SYSTEM',
]);

// Pre-build sets of builtin type names and standard FB names (uppercase)
const BUILTIN_TYPE_NAMES = new Set(BUILTIN_TYPES.map(t => t.name.toUpperCase()));
const STANDARD_FB_NAMES = new Set(STANDARD_FBS.map(fb => fb.name.toUpperCase()));

// ---------------------------------------------------------------------------
// Type-category helpers for type-mismatch check
// ---------------------------------------------------------------------------

type ExprCategory = 'bool' | 'numeric' | 'string' | 'unknown';

const NUMERIC_TYPES = new Set([
	'SINT', 'INT', 'DINT', 'LINT',
	'USINT', 'UINT', 'UDINT', 'ULINT',
	'BYTE', 'WORD', 'DWORD', 'LWORD',
	'REAL', 'LREAL',
	'TIME', 'LTIME', 'TIME_OF_DAY', 'TOD', 'DATE', 'DATE_AND_TIME', 'DT',
]);

// ---------------------------------------------------------------------------
// SemanticAnalyzer
// ---------------------------------------------------------------------------

export class SemanticAnalyzer {
	private readonly diagnostics: Diagnostic[] = [];
	private readonly ast: SourceFile;
	private readonly libraryRefs?: LibraryRef[];
	private readonly workspaceIndex?: WorkspaceIndex;
	private readonly currentUri?: string;

	/** All POU/type/enum/GVL names visible at file scope (uppercase). */
	private globalNames!: Set<string>;
	/** Known type names for Part A checks (builtins + globals + library types). */
	private knownTypes!: Set<string>;
	/** Map from uppercase symbol name → namespace for missing-library diagnostics. */
	private libFbToLib!: Map<string, string>;
	/** Set of referenced library namespace names (uppercase). */
	private referencedLibNames!: Set<string>;

	constructor(
		ast: SourceFile,
		libraryRefs?: LibraryRef[],
		workspaceIndex?: WorkspaceIndex,
		currentUri?: string,
	) {
		this.ast = ast;
		this.libraryRefs = libraryRefs;
		this.workspaceIndex = workspaceIndex;
		this.currentUri = currentUri;
	}

	/** Run all semantic checks and return the collected diagnostics. */
	analyze(): Diagnostic[] {
		this.buildGlobalNames();
		this.buildKnownTypes();
		this.buildLibraryMaps();
		this.checkDuplicatePouNames();
		this.checkPouBodies();
		this.checkExtendsImplements();
		this.checkUnnecessarySemicolons();
		return this.diagnostics;
	}

	// -----------------------------------------------------------------------
	// Phase 1: Build scope tables
	// -----------------------------------------------------------------------

	private buildGlobalNames(): void {
		this.globalNames = new Set<string>();

		for (const decl of this.ast.declarations) {
			if (
				decl.kind === 'ProgramDeclaration' ||
				decl.kind === 'FunctionBlockDeclaration' ||
				decl.kind === 'FunctionDeclaration' ||
				decl.kind === 'InterfaceDeclaration'
			) {
				this.globalNames.add((decl as { name: string }).name.toUpperCase());
			} else if (decl.kind === 'TypeDeclarationBlock') {
				const tdb = decl as TypeDeclarationBlock;
				for (const td of tdb.declarations) {
					this.globalNames.add(td.name.toUpperCase());
					if (td.kind === 'EnumDeclaration') {
						for (const ev of (td as EnumDeclaration).values) {
							this.globalNames.add(ev.name.toUpperCase());
						}
					}
				}
			} else if (decl.kind === 'GvlDeclaration') {
				const gvl = decl as GvlDeclaration;
				if (gvl.name) {
					this.globalNames.add(gvl.name.toUpperCase());
				}
				for (const vb of gvl.varBlocks) {
					for (const vd of vb.declarations) {
						this.globalNames.add(vd.name.toUpperCase());
					}
				}
			}
		}

		// Add cross-file POU/type/interface names from workspace index
		if (this.workspaceIndex) {
			const normalised = this.currentUri?.startsWith('file://') ? this.currentUri : (this.currentUri ? `file://${this.currentUri}` : undefined);
			for (const fileUri of this.workspaceIndex.getProjectFiles()) {
				if (fileUri === normalised || fileUri === this.currentUri) continue;
				const cached = this.workspaceIndex.getAst?.(fileUri);
				if (!cached) continue;
				for (const decl of cached.ast.declarations) {
					if (
						decl.kind === 'ProgramDeclaration' ||
						decl.kind === 'FunctionBlockDeclaration' ||
						decl.kind === 'FunctionDeclaration' ||
						decl.kind === 'InterfaceDeclaration'
					) {
						this.globalNames.add((decl as { name: string }).name.toUpperCase());
					} else if (decl.kind === 'TypeDeclarationBlock') {
						const tdb = decl as TypeDeclarationBlock;
						for (const td of tdb.declarations) {
							this.globalNames.add(td.name.toUpperCase());
							if (td.kind === 'EnumDeclaration') {
								for (const ev of (td as EnumDeclaration).values) {
									this.globalNames.add(ev.name.toUpperCase());
								}
							}
						}
					} else if (decl.kind === 'GvlDeclaration') {
						const gvl = decl as GvlDeclaration;
						if (gvl.name) {
							this.globalNames.add(gvl.name.toUpperCase());
						}
						for (const vb of gvl.varBlocks) {
							for (const vd of vb.declarations) {
								this.globalNames.add(vd.name.toUpperCase());
							}
						}
					}
				}
			}
		}
	}

	private buildKnownTypes(): void {
		const libraryTypeNames = this.currentUri && this.workspaceIndex
			? this.workspaceIndex.getLibraryTypeNames(this.currentUri)
			: new Set<string>();
		this.knownTypes = new Set<string>([
			...BUILTIN_TYPE_NAMES,
			...STANDARD_FB_NAMES,
			...SYSTEM_TYPE_NAMES,
			...this.globalNames,
			...libraryTypeNames,
		]);
	}

	private buildLibraryMaps(): void {
		this.libFbToLib = new Map<string, string>();
		this.referencedLibNames = new Set<string>();
		const libSymbols = this.currentUri && this.workspaceIndex
			? this.workspaceIndex.getLibrarySymbols(this.currentUri)
			: [];
		if (this.libraryRefs && this.libraryRefs.length > 0 && libSymbols.length > 0) {
			for (const ref of this.libraryRefs) {
				this.referencedLibNames.add(ref.name.toUpperCase());
			}
			for (const sym of libSymbols) {
				this.libFbToLib.set(sym.name.toUpperCase(), sym.namespace);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Phase 2: Duplicate POU names
	// -----------------------------------------------------------------------

	private checkDuplicatePouNames(): void {
		const pouNameGroups = new Map<string, Array<{ name: string; range: Range }>>();
		for (const decl of this.ast.declarations) {
			if (
				decl.kind === 'ProgramDeclaration' ||
				decl.kind === 'FunctionBlockDeclaration' ||
				decl.kind === 'FunctionDeclaration'
			) {
				const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
				const key = pou.name.toUpperCase();
				let arr = pouNameGroups.get(key);
				if (!arr) { arr = []; pouNameGroups.set(key, arr); }
				arr.push({ name: pou.name, range: decl.range });
			}
		}
		for (const [, pouDecls] of pouNameGroups) {
			if (pouDecls.length > 1) {
				for (let i = 1; i < pouDecls.length; i++) {
					const d = pouDecls[i];
					this.addDiagnostic(
						DiagnosticSeverity.Warning,
						d.range,
						`Duplicate POU name '${d.name}'`,
					);
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Phase 3: Per-POU checks
	// -----------------------------------------------------------------------

	private checkPouBodies(): void {
		for (const decl of this.ast.declarations) {
			if (
				decl.kind !== 'ProgramDeclaration' &&
				decl.kind !== 'FunctionBlockDeclaration' &&
				decl.kind !== 'FunctionDeclaration'
			) {
				continue;
			}

			const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;

			this.checkDuplicateVarDeclarations(pou);
			this.checkUnknownTypes(pou.varBlocks);
			this.checkMissingLibraryRefs(pou.varBlocks);

			// Build scope
			const scope = new Set<string>(this.globalNames);
			this.addPouVarNames(pou, scope);
			this.addInlineEnumNames(pou.varBlocks, scope);
			scope.add(pou.name.toUpperCase());
			for (const name of collectForLoopVars(pou.body)) {
				scope.add(name);
			}

			let extendsUnresolvable = false;
			if (decl.kind === 'FunctionBlockDeclaration') {
				const fb = decl as FunctionBlockDeclaration;
				for (const m of fb.methods) scope.add(m.name.toUpperCase());
				for (const p of fb.properties) scope.add(p.name.toUpperCase());
				for (const a of fb.actions) scope.add(a.name.toUpperCase());
				this.addInheritedMembers(fb, scope);
				if (fb.extendsRef && !this.globalNames.has(fb.extendsRef.name.toUpperCase())) {
					extendsUnresolvable = true;
				}
			}

			// Undefined identifiers in body
			this.checkUndefinedIdentifiers(pou.body, scope, extendsUnresolvable);

			// Variable initialization validation
			this.checkVarInitializations(pou, scope, extendsUnresolvable);

			// Type mismatch on assignments
			this.checkAssignmentTypeMismatches(pou.body, buildVarCategoryMap(pou));

			// Methods and actions (FB only)
			if (decl.kind === 'FunctionBlockDeclaration') {
				const fb = decl as FunctionBlockDeclaration;
				this.checkActionBodies(fb, scope, extendsUnresolvable);
				this.checkMethodBodies(fb, pou, scope, extendsUnresolvable);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Individual check methods
	// -----------------------------------------------------------------------

	private checkDuplicateVarDeclarations(pou: { varBlocks: VarBlock[] }): void {
		const duplicates = findDuplicateVarDeclarations(pou);
		for (const [, dupeDecls] of duplicates) {
			for (let i = 1; i < dupeDecls.length; i++) {
				const vd = dupeDecls[i];
				this.addDiagnostic(
					DiagnosticSeverity.Error,
					vd.range,
					`Duplicate variable declaration '${vd.name}'`,
				);
			}
		}
	}

	private checkUnknownTypes(varBlocks: VarBlock[]): void {
		for (const vb of varBlocks) {
			for (const vd of vb.declarations) {
				const typeName = vd.type.name.toUpperCase();
				if (typeName === '__INLINE_ENUM') continue;
				if (!this.knownTypes.has(typeName)) {
					this.addDiagnostic(
						DiagnosticSeverity.Warning,
						vd.type.range,
						`Unknown type: "${vd.type.name}"`,
					);
				}
			}
		}
	}

	private checkMissingLibraryRefs(varBlocks: VarBlock[]): void {
		if (this.libFbToLib.size === 0) return;
		for (const vb of varBlocks) {
			for (const vd of vb.declarations) {
				const typeName = vd.type.name.toUpperCase();
				if (!this.knownTypes.has(typeName)) continue;
				const libName = this.libFbToLib.get(typeName);
				if (libName && !this.referencedLibNames.has(libName.toUpperCase())) {
					this.addDiagnostic(
						DiagnosticSeverity.Warning,
						vd.type.range,
						`"${vd.type.name}" requires library reference to "${libName}"`,
					);
				}
			}
		}
	}

	private checkUndefinedIdentifiers(
		stmts: Statement[],
		scope: Set<string>,
		extendsUnresolvable: boolean,
	): void {
		walkStatements(stmts, (nameExpr: NameExpression) => {
			const upper = nameExpr.name.toUpperCase();
			if (isAllowedName(nameExpr.name)) return;
			if (scope.has(upper)) return;
			if (extendsUnresolvable) return;
			this.addDiagnostic(
				DiagnosticSeverity.Warning,
				nameExpr.range,
				`Undefined identifier '${nameExpr.name}'`,
			);
		});
	}

	private checkVarInitializations(
		pou: ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration,
		scope: Set<string>,
		extendsUnresolvable: boolean,
	): void {
		for (const vb of pou.varBlocks) {
			for (const vd of vb.declarations) {
				if (!vd.initialValue) continue;

				const initScope = new Set<string>(this.globalNames);

				let foundThisBlock = false;
				for (const vbPrev of pou.varBlocks) {
					if (foundThisBlock) break;
					if (vbPrev === vb) {
						foundThisBlock = true;
						for (const vdPrev of vb.declarations) {
							if (vdPrev === vd) break;
							initScope.add(vdPrev.name.toUpperCase());
						}
					} else {
						for (const vdPrev of vbPrev.declarations) {
							initScope.add(vdPrev.name.toUpperCase());
						}
					}
				}

				// Add inline enum member names from earlier declarations
				for (const vdPrev of vb.declarations) {
					if (vdPrev === vd) break;
					if (vdPrev.type.inlineEnumValues) {
						for (const ev of vdPrev.type.inlineEnumValues) {
							initScope.add(ev.name.toUpperCase());
						}
					}
				}

				// Add inline enum members from THIS declaration
				if (vd.type.inlineEnumValues) {
					for (const ev of vd.type.inlineEnumValues) {
						initScope.add(ev.name.toUpperCase());
					}
				}

				initScope.add(pou.name.toUpperCase());
				if (pou.kind === 'FunctionBlockDeclaration') {
					const fb = pou as FunctionBlockDeclaration;
					for (const m of fb.methods) initScope.add(m.name.toUpperCase());
					for (const p of fb.properties) initScope.add(p.name.toUpperCase());
					for (const a of fb.actions) initScope.add(a.name.toUpperCase());
					this.addInheritedMembers(fb, initScope);
				}

				// Check identifiers in initializer
				walkExpression(vd.initialValue, (nameExpr: NameExpression) => {
					const upper = nameExpr.name.toUpperCase();
					if (isAllowedName(nameExpr.name)) return;
					if (initScope.has(upper)) return;
					if (extendsUnresolvable) return;
					this.addDiagnostic(
						DiagnosticSeverity.Warning,
						nameExpr.range,
						`Undefined identifier '${nameExpr.name}'`,
					);
				});

				// Type compatibility check
				const declaredType = varTypeCategory(vd.type.name);
				if (declaredType !== 'unknown') {
					const initializerType = inferExprCategory(vd.initialValue, buildVarCategoryMap(pou));
					if (initializerType !== 'unknown') {
						this.reportTypeMismatch(declaredType, initializerType, vd.initialValue.range, 'initialize');
					}
				}
			}
		}
	}

	private checkAssignmentTypeMismatches(
		stmts: Statement[],
		varCats: Map<string, ExprCategory>,
	): void {
		walkAssignments(stmts, (assign: AssignmentStatement) => {
			if (assign.left.kind !== 'NameExpression') return;
			const lhsCat = varCats.get((assign.left as NameExpression).name.toUpperCase());
			if (!lhsCat || lhsCat === 'unknown') return;
			const rhsCat = inferExprCategory(assign.right, varCats);
			if (rhsCat === 'unknown') return;
			if (lhsCat === 'bool' && rhsCat === 'numeric') {
				this.addDiagnostic(
					DiagnosticSeverity.Warning,
					assign.range,
					'Type mismatch: cannot assign numeric expression to BOOL variable',
				);
			} else if (lhsCat === 'numeric' && rhsCat === 'bool') {
				this.addDiagnostic(
					DiagnosticSeverity.Warning,
					assign.range,
					'Type mismatch: cannot assign BOOL expression to numeric variable',
				);
			} else if (lhsCat === 'numeric' && rhsCat === 'string') {
				this.addDiagnostic(
					DiagnosticSeverity.Warning,
					assign.range,
					'Type mismatch: cannot assign STRING expression to numeric variable',
				);
			}
		});
	}

	private checkActionBodies(
		fb: FunctionBlockDeclaration,
		scope: Set<string>,
		extendsUnresolvable: boolean,
	): void {
		for (const action of fb.actions) {
			const actionScope = new Set<string>(scope);
			for (const name of collectForLoopVars((action as ActionDeclaration).body)) {
				actionScope.add(name);
			}
			this.checkUndefinedIdentifiers((action as ActionDeclaration).body, actionScope, extendsUnresolvable);
		}
	}

	private checkMethodBodies(
		fb: FunctionBlockDeclaration,
		pou: ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration,
		scope: Set<string>,
		extendsUnresolvable: boolean,
	): void {
		for (const method of fb.methods) {
			const methodScope = new Set<string>(scope);
			for (const vb of method.varBlocks) {
				for (const vd of vb.declarations) {
					methodScope.add(vd.name.toUpperCase());
				}
			}
			for (const name of collectForLoopVars(method.body)) {
				methodScope.add(name);
			}
			methodScope.add(method.name.toUpperCase());

			// Duplicate declarations in method
			this.checkDuplicateVarDeclarations(method);

			// Undefined identifiers
			this.checkUndefinedIdentifiers(method.body, methodScope, extendsUnresolvable);

			// Unknown types in method
			this.checkUnknownTypes(method.varBlocks);

			// Type mismatch on assignments in method
			const methodVarCats = buildVarCategoryMap(pou, method.varBlocks);
			this.checkAssignmentTypeMismatches(method.body, methodVarCats);

			// Method variable initialization validation
			this.checkMethodVarInitializations(method, methodScope, extendsUnresolvable, methodVarCats);
		}
	}

	private checkMethodVarInitializations(
		method: { varBlocks: VarBlock[]; body: Statement[] },
		methodScope: Set<string>,
		extendsUnresolvable: boolean,
		methodVarCats: Map<string, ExprCategory>,
	): void {
		for (const vb of method.varBlocks) {
			for (const vd of vb.declarations) {
				if (!vd.initialValue) continue;

				const methodInitScope = new Set<string>(methodScope);
				methodInitScope.delete(vd.name.toUpperCase());

				let foundThisBlock = false;
				for (const vbPrev of method.varBlocks) {
					if (foundThisBlock) break;
					if (vbPrev === vb) {
						foundThisBlock = true;
						for (const vdPrev of vb.declarations) {
							if (vdPrev === vd) break;
							methodInitScope.add(vdPrev.name.toUpperCase());
						}
					} else {
						for (const vdPrev of vbPrev.declarations) {
							methodInitScope.add(vdPrev.name.toUpperCase());
						}
					}
				}

				walkExpression(vd.initialValue, (nameExpr: NameExpression) => {
					const upper = nameExpr.name.toUpperCase();
					if (isAllowedName(nameExpr.name)) return;
					if (methodInitScope.has(upper)) return;
					if (extendsUnresolvable) return;
					this.addDiagnostic(
						DiagnosticSeverity.Warning,
						nameExpr.range,
						`Undefined identifier '${nameExpr.name}'`,
					);
				});

				const declaredType = varTypeCategory(vd.type.name);
				if (declaredType !== 'unknown') {
					const initializerType = inferExprCategory(vd.initialValue, methodVarCats);
					if (initializerType !== 'unknown') {
						this.reportTypeMismatch(declaredType, initializerType, vd.initialValue.range, 'initialize');
					}
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Phase 4: EXTENDS/IMPLEMENTS validation
	// -----------------------------------------------------------------------

	private checkExtendsImplements(): void {
		if (!this.workspaceIndex) return;

		for (const decl of this.ast.declarations) {
			if (decl.kind === 'FunctionBlockDeclaration') {
				const fb = decl as FunctionBlockDeclaration;
				if (fb.extendsRef && !this.globalNames.has(fb.extendsRef.name.toUpperCase())) {
					this.addDiagnostic(
						DiagnosticSeverity.Warning,
						fb.extendsRef.range,
						`Cannot resolve type '${fb.extendsRef.name}'`,
					);
				}
				for (const ref of fb.implementsRefs) {
					if (!this.globalNames.has(ref.name.toUpperCase())) {
						this.addDiagnostic(
							DiagnosticSeverity.Warning,
							ref.range,
							`Cannot resolve type '${ref.name}'`,
						);
					}
				}
			} else if (decl.kind === 'InterfaceDeclaration') {
				const intf = decl as InterfaceDeclaration;
				for (const ref of intf.extendsRefs) {
					if (!this.globalNames.has(ref.name.toUpperCase())) {
						this.addDiagnostic(
							DiagnosticSeverity.Warning,
							ref.range,
							`Cannot resolve type '${ref.name}'`,
						);
					}
				}
			} else if (decl.kind === 'TypeDeclarationBlock') {
				const tdb = decl as TypeDeclarationBlock;
				for (const td of tdb.declarations) {
					if (td.kind === 'StructDeclaration') {
						const s = td as StructDeclaration;
						if (s.extendsRef && !this.globalNames.has(s.extendsRef.name.toUpperCase())) {
							this.addDiagnostic(
								DiagnosticSeverity.Warning,
								s.extendsRef.range,
								`Cannot resolve type '${s.extendsRef.name}'`,
							);
						}
					}
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Phase 5: Semicolon diagnostics
	// -----------------------------------------------------------------------

	private checkUnnecessarySemicolons(): void {
		for (const decl of this.ast.declarations) {
			if (decl.kind === 'ProgramDeclaration') {
				this.reportUnnecessarySemicolons((decl as ProgramDeclaration).body);
			} else if (decl.kind === 'FunctionBlockDeclaration') {
				const fb = decl as FunctionBlockDeclaration;
				this.reportUnnecessarySemicolons(fb.body);
				for (const method of fb.methods) {
					this.reportUnnecessarySemicolons(method.body);
				}
				for (const action of fb.actions) {
					this.reportUnnecessarySemicolons(action.body);
				}
			} else if (decl.kind === 'FunctionDeclaration') {
				this.reportUnnecessarySemicolons((decl as FunctionDeclaration).body);
			}
		}
	}

	private reportUnnecessarySemicolons(stmts: Statement[]): void {
		for (const emptyStmt of findUnnecessarySemicolons(stmts)) {
			this.diagnostics.push({
				severity: DiagnosticSeverity.Warning,
				range: {
					start: { line: emptyStmt.range.start.line, character: emptyStmt.range.start.character },
					end:   { line: emptyStmt.range.end.line,   character: emptyStmt.range.end.character },
				},
				message: 'Unnecessary semicolon',
				source: 'st-lsp',
				code: 'unnecessary-semicolon',
			});
		}
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private addDiagnostic(
		severity: DiagnosticSeverity,
		range: { start: { line: number; character: number }; end: { line: number; character: number } },
		message: string,
	): void {
		this.diagnostics.push({
			severity,
			range: {
				start: { line: range.start.line, character: range.start.character },
				end:   { line: range.end.line,   character: range.end.character },
			},
			message,
			source: 'st-lsp',
		});
	}

	private reportTypeMismatch(
		declaredType: ExprCategory,
		initializerType: ExprCategory,
		range: { start: { line: number; character: number }; end: { line: number; character: number } },
		verb: 'initialize' | 'assign',
	): void {
		let message: string | undefined;
		if (declaredType === 'bool' && initializerType === 'numeric') {
			message = `Type mismatch: cannot ${verb} BOOL variable with numeric expression`;
		} else if (declaredType === 'numeric' && initializerType === 'bool') {
			message = `Type mismatch: cannot ${verb} numeric variable with BOOL expression`;
		} else if (declaredType === 'numeric' && initializerType === 'string') {
			message = `Type mismatch: cannot ${verb} numeric variable with STRING expression`;
		}
		if (message) {
			this.addDiagnostic(DiagnosticSeverity.Warning, range, message);
		}
	}

	private addPouVarNames(
		pou: ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration,
		scope: Set<string>,
	): void {
		for (const vb of pou.varBlocks) {
			for (const vd of vb.declarations) {
				scope.add(vd.name.toUpperCase());
			}
		}
	}

	private addInlineEnumNames(varBlocks: VarBlock[], scope: Set<string>): void {
		for (const vb of varBlocks) {
			for (const vd of vb.declarations) {
				if (vd.type.inlineEnumValues) {
					for (const ev of vd.type.inlineEnumValues) {
						scope.add(ev.name.toUpperCase());
					}
				}
			}
		}
	}

	private addInheritedMembers(
		fb: FunctionBlockDeclaration,
		scope: Set<string>,
		depth = 0,
	): void {
		if (!fb.extendsRef || depth > 10) return;
		const parentName = fb.extendsRef.name.toUpperCase();

		let parentFb: FunctionBlockDeclaration | undefined;
		for (const d of this.ast.declarations) {
			if (d.kind === 'FunctionBlockDeclaration' &&
				(d as FunctionBlockDeclaration).name.toUpperCase() === parentName) {
				parentFb = d as FunctionBlockDeclaration;
				break;
			}
		}

		if (!parentFb && this.workspaceIndex) {
			outer: for (const fileUri of this.workspaceIndex.getProjectFiles()) {
				const cached = this.workspaceIndex.getAst?.(fileUri);
				if (!cached) continue;
				for (const d of cached.ast.declarations) {
					if (d.kind === 'FunctionBlockDeclaration' &&
						(d as FunctionBlockDeclaration).name.toUpperCase() === parentName) {
						parentFb = d as FunctionBlockDeclaration;
						break outer;
					}
				}
			}
		}

		if (!parentFb) return;

		for (const m of parentFb.methods) scope.add(m.name.toUpperCase());
		for (const p of parentFb.properties) scope.add(p.name.toUpperCase());
		for (const a of parentFb.actions) scope.add(a.name.toUpperCase());
		for (const vb of parentFb.varBlocks) {
			for (const vd of vb.declarations) {
				scope.add(vd.name.toUpperCase());
			}
		}

		this.addInheritedMembers(parentFb, scope, depth + 1);
	}
}

// ---------------------------------------------------------------------------
// Pure utility functions (no class dependency)
// ---------------------------------------------------------------------------

function isAllowedName(name: string): boolean {
	const upper = name.toUpperCase();
	return ALWAYS_ALLOWED.has(upper)
		|| BUILTIN_TYPE_NAMES.has(upper)
		|| STANDARD_FB_NAMES.has(upper)
		|| SYSTEM_TYPE_NAMES.has(upper)
		|| SYSTEM_FUNCTION_NAMES.has(upper)
		|| TYPE_CONVERSION_NAMES.has(upper);
}

function findDuplicateVarDeclarations(
	pou: { varBlocks: VarBlock[] },
): Map<string, VarDeclaration[]> {
	const groups = new Map<string, VarDeclaration[]>();
	for (const vb of pou.varBlocks) {
		for (const vd of vb.declarations) {
			const key = vd.name.toUpperCase();
			let arr = groups.get(key);
			if (!arr) { arr = []; groups.set(key, arr); }
			arr.push(vd);
		}
	}
	const duplicates = new Map<string, VarDeclaration[]>();
	for (const [key, arr] of groups) {
		if (arr.length > 1) duplicates.set(key, arr);
	}
	return duplicates;
}

// ---------------------------------------------------------------------------
// Expression walker
// ---------------------------------------------------------------------------

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
			for (const idx of e.indices) walkExpression(idx, onName);
			break;
		}
		case 'MemberExpression': {
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
		case 'ArrayLiteral': {
			const e = expr as ArrayLiteral;
			for (const elem of e.elements) walkExpression(elem, onName);
			break;
		}
		case 'StructInitializer': {
			const e = expr as StructInitializer;
			for (const field of e.fields) {
				walkCallArgument(field, onName);
			}
			break;
		}
		default:
			break;
	}
}

function walkCallArgument(arg: CallArgument, onName: (n: NameExpression) => void): void {
	walkExpression(arg.value, onName);
}

// ---------------------------------------------------------------------------
// Statement walker
// ---------------------------------------------------------------------------

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
		default:
			break;
	}
}

// ---------------------------------------------------------------------------
// FOR loop variable collector
// ---------------------------------------------------------------------------

function collectForLoopVars(stmts: Statement[]): Set<string> {
	const names = new Set<string>();
	for (const stmt of stmts) {
		if (stmt.kind === 'ForStatement') {
			const s = stmt as ForStatement;
			names.add(s.variable.toUpperCase());
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
// Unnecessary semicolon finder
// ---------------------------------------------------------------------------

function findUnnecessarySemicolons(stmts: Statement[]): EmptyStatement[] {
	const CONTROL_KINDS = new Set([
		'IfStatement', 'ForStatement', 'WhileStatement', 'RepeatStatement', 'CaseStatement',
	]);
	const empty: EmptyStatement[] = [];
	for (let i = 0; i < stmts.length; i++) {
		const stmt = stmts[i];
		if (stmt.kind === 'EmptyStatement') {
			const prev = i > 0 ? stmts[i - 1] : undefined;
			if (prev && CONTROL_KINDS.has(prev.kind)) {
				continue;
			}
			empty.push(stmt as EmptyStatement);
		}
		if (stmt.kind === 'IfStatement') {
			const s = stmt as IfStatement;
			empty.push(...findUnnecessarySemicolons(s.then));
			for (const elsif of s.elsifs) {
				empty.push(...findUnnecessarySemicolons(elsif.body));
			}
			if (s.else) empty.push(...findUnnecessarySemicolons(s.else));
		} else if (stmt.kind === 'ForStatement') {
			const s = stmt as ForStatement;
			empty.push(...findUnnecessarySemicolons(s.body));
		} else if (stmt.kind === 'WhileStatement') {
			const s = stmt as WhileStatement;
			empty.push(...findUnnecessarySemicolons(s.body));
		} else if (stmt.kind === 'RepeatStatement') {
			const s = stmt as RepeatStatement;
			empty.push(...findUnnecessarySemicolons(s.body));
		} else if (stmt.kind === 'CaseStatement') {
			const s = stmt as CaseStatement;
			for (const clause of s.cases) {
				empty.push(...findUnnecessarySemicolons(clause.body));
			}
			if (s.else) empty.push(...findUnnecessarySemicolons(s.else));
		}
	}
	return empty;
}

// ---------------------------------------------------------------------------
// Type category helpers
// ---------------------------------------------------------------------------

function varTypeCategory(typeName: string): ExprCategory {
	const upper = typeName.toUpperCase();
	if (upper === 'BOOL') return 'bool';
	if (upper === 'STRING' || upper === 'WSTRING') return 'string';
	if (NUMERIC_TYPES.has(upper)) return 'numeric';
	return 'unknown';
}

function inferExprCategory(expr: Expression, varTypes: Map<string, ExprCategory>): ExprCategory {
	switch (expr.kind) {
		case 'BoolLiteral': return 'bool';
		case 'IntegerLiteral': return 'numeric';
		case 'RealLiteral': return 'numeric';
		case 'StringLiteral': return 'string';
		case 'NameExpression': {
			const cat = varTypes.get((expr as NameExpression).name.toUpperCase());
			return cat ?? 'unknown';
		}
		case 'UnaryExpression': {
			const e = expr as UnaryExpression;
			if (e.op.toUpperCase() === 'NOT') return 'bool';
			const inner = inferExprCategory(e.operand, varTypes);
			return inner === 'numeric' ? 'numeric' : 'unknown';
		}
		case 'BinaryExpression': {
			const e = expr as BinaryExpression;
			const compOps = new Set(['=', '<>', '<', '<=', '>', '>=']);
			const boolOps = new Set(['AND', 'OR', 'XOR']);
			if (compOps.has(e.op)) return 'bool';
			if (boolOps.has(e.op)) return 'bool';
			const l = inferExprCategory(e.left, varTypes);
			const r = inferExprCategory(e.right, varTypes);
			if (l === 'numeric' && r === 'numeric') return 'numeric';
			return 'unknown';
		}
		default: return 'unknown';
	}
}

function buildVarCategoryMap(
	pou: ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration,
	extraBlocks?: VarBlock[],
): Map<string, ExprCategory> {
	const map = new Map<string, ExprCategory>();
	for (const vb of [...pou.varBlocks, ...(extraBlocks ?? [])]) {
		for (const vd of vb.declarations) {
			map.set(vd.name.toUpperCase(), varTypeCategory(vd.type.name));
		}
	}
	return map;
}

// ---------------------------------------------------------------------------
// Assignment walker
// ---------------------------------------------------------------------------

function walkAssignments(stmts: Statement[], onAssign: (s: AssignmentStatement) => void): void {
	for (const stmt of stmts) {
		walkAssignmentInStatement(stmt, onAssign);
	}
}

function walkAssignmentInStatement(stmt: Statement, onAssign: (s: AssignmentStatement) => void): void {
	switch (stmt.kind) {
		case 'AssignmentStatement':
			onAssign(stmt as AssignmentStatement);
			break;
		case 'IfStatement': {
			const s = stmt as IfStatement;
			walkAssignments(s.then, onAssign);
			for (const elsif of s.elsifs) walkAssignments(elsif.body, onAssign);
			if (s.else) walkAssignments(s.else, onAssign);
			break;
		}
		case 'ForStatement':
			walkAssignments((stmt as ForStatement).body, onAssign);
			break;
		case 'WhileStatement':
			walkAssignments((stmt as WhileStatement).body, onAssign);
			break;
		case 'RepeatStatement':
			walkAssignments((stmt as RepeatStatement).body, onAssign);
			break;
		case 'CaseStatement': {
			const s = stmt as CaseStatement;
			for (const clause of s.cases) walkAssignments(clause.body, onAssign);
			if (s.else) walkAssignments(s.else, onAssign);
			break;
		}
		default: break;
	}
}
