/** IEC 61131-3 Structured Text AST types */

export interface Position {
  line: number;      // 0-based
  character: number; // 0-based
}

export interface Range {
  start: Position;
  end: Position;
}

export interface AstNode {
  kind: string;
  range: Range;
}

/** A named identifier with its source range (used for EXTENDS/IMPLEMENTS references). */
export interface NamedRef {
  name: string;
  range: Range;
}

// ---------------------------------------------------------------------------
// Type references
// ---------------------------------------------------------------------------

export interface ArrayDim {
  low: string;
  high: string;
}

export interface TypeRef extends AstNode {
  kind: 'TypeRef';
  name: string;          // base type name, e.g. 'INT', 'BOOL', 'STRING'
  nameRange: Range;      // range of just the base type name token (not modifiers like POINTER TO)
  isPointer?: boolean;   // POINTER TO <name>
  isReference?: boolean; // REFERENCE TO <name>
  isArray?: boolean;     // ARRAY[dims] OF <name>
  arrayDims?: ArrayDim[];
  /** Anonymous inline enum type in VAR declarations, e.g. x : (A, B := 2); */
  inlineEnumValues?: EnumValue[];
}

// ---------------------------------------------------------------------------
// Top-level source file
// ---------------------------------------------------------------------------

export interface SourceFile extends AstNode {
  kind: 'SourceFile';
  declarations: TopLevelDeclaration[];
}

export type TopLevelDeclaration =
  | ProgramDeclaration
  | FunctionBlockDeclaration
  | FunctionDeclaration
  | TypeDeclarationBlock
  | InterfaceDeclaration
  | GvlDeclaration;

// ---------------------------------------------------------------------------
// Top-level declarations
// ---------------------------------------------------------------------------

export interface ProgramDeclaration extends AstNode {
  kind: 'ProgramDeclaration';
  name: string;
  pragmas: Pragma[];
  varBlocks: VarBlock[];
  body: Statement[];
}

export interface FunctionBlockDeclaration extends AstNode {
  kind: 'FunctionBlockDeclaration';
  name: string;
  pragmas: Pragma[];
  extendsRef?: NamedRef;
  implementsRefs: NamedRef[];
  varBlocks: VarBlock[];
  body: Statement[];
  methods: MethodDeclaration[];
  properties: PropertyDeclaration[];
  actions: ActionDeclaration[];
}

export interface FunctionDeclaration extends AstNode {
  kind: 'FunctionDeclaration';
  name: string;
  pragmas: Pragma[];
  returnType: TypeRef | null;
  varBlocks: VarBlock[];
  body: Statement[];
}

export interface GvlDeclaration extends AstNode {
  kind: 'GvlDeclaration';
  varBlocks: VarBlock[];
  name?: string;
}

// ---------------------------------------------------------------------------
// Variable declarations
// ---------------------------------------------------------------------------

export type VarKind =
  | 'VAR'
  | 'VAR_INPUT'
  | 'VAR_OUTPUT'
  | 'VAR_IN_OUT'
  | 'VAR_GLOBAL'
  | 'VAR_EXTERNAL'
  | 'VAR_TEMP'
  | 'VAR_STAT'
  | 'VAR_CONFIG';

export interface VarBlock extends AstNode {
  kind: 'VarBlock';
  varKind: VarKind;
  constant?: boolean;
  retain?: boolean;
  persistent?: boolean;
  declarations: VarDeclaration[];
}

export interface VarDeclaration extends AstNode {
  kind: 'VarDeclaration';
  name: string;
  /** Precise range covering only the declaration name identifier. */
  nameRange: Range;
  pragmas: Pragma[];
  type: TypeRef;
  /** Optional FB constructor-style args after type, e.g. x : MyFB(A := 1); */
  initArgs?: CallArgument[];
  initialValue?: Expression;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export type Statement =
  | AssignmentStatement
  | CallStatement
  | IfStatement
  | ForStatement
  | WhileStatement
  | RepeatStatement
  | CaseStatement
  | ReturnStatement
  | ExitStatement
  | ContinueStatement
  | EmptyStatement;

export interface AssignmentStatement extends AstNode {
  kind: 'AssignmentStatement';
  left: Expression;
  right: Expression;
  isRefAssign?: boolean; // REF= reference assignment operator
}

export interface CallStatement extends AstNode {
  kind: 'CallStatement';
  callee: Expression;
  args: CallArgument[];
}

export interface CallArgument {
  name?: string;       // named parameter, e.g. foo(in1 := x)
  value: Expression;
  isOutput?: boolean;  // => output binding
}

export interface IfStatement extends AstNode {
  kind: 'IfStatement';
  condition: Expression;
  then: Statement[];
  elsifs: ElsifClause[];
  else?: Statement[];
}

export interface ElsifClause {
  condition: Expression;
  body: Statement[];
}

export interface ForStatement extends AstNode {
  kind: 'ForStatement';
  variable: string;
  /** Precise range covering only the loop variable identifier. */
  variableRange: Range;
  from: Expression;
  to: Expression;
  by?: Expression;
  body: Statement[];
}

export interface WhileStatement extends AstNode {
  kind: 'WhileStatement';
  condition: Expression;
  body: Statement[];
}

export interface RepeatStatement extends AstNode {
  kind: 'RepeatStatement';
  body: Statement[];
  condition: Expression;
}

export interface CaseStatement extends AstNode {
  kind: 'CaseStatement';
  expression: Expression;
  cases: CaseClause[];
  else?: Statement[];
}

export interface CaseClause {
  values: CaseValue[];
  body: Statement[];
}

export type CaseValue =
  | { kind: 'single'; value: Expression }
  | { kind: 'range'; low: Expression; high: Expression };

export interface ReturnStatement extends AstNode {
  kind: 'ReturnStatement';
}

export interface ExitStatement extends AstNode {
  kind: 'ExitStatement';
}

export interface ContinueStatement extends AstNode {
  kind: 'ContinueStatement';
}

export interface EmptyStatement extends AstNode {
  kind: 'EmptyStatement';
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expression =
  | BinaryExpression
  | UnaryExpression
  | SubscriptExpression
  | MemberExpression
  | CallExpression
  | NameExpression
  | IntegerLiteral
  | RealLiteral
  | StringLiteral
  | BoolLiteral
  | ArrayLiteral;

export interface BinaryExpression extends AstNode {
  kind: 'BinaryExpression';
  op: string;
  left: Expression;
  right: Expression;
}

export interface UnaryExpression extends AstNode {
  kind: 'UnaryExpression';
  op: string; // '-' | 'NOT'
  operand: Expression;
}

export interface SubscriptExpression extends AstNode {
  kind: 'SubscriptExpression';
  base: Expression;
  indices: Expression[]; // one or more comma-separated indices (multi-dim: arr[i,j])
}

export interface MemberExpression extends AstNode {
  kind: 'MemberExpression';
  base: Expression;
  member: string;
}

export interface CallExpression extends AstNode {
  kind: 'CallExpression';
  callee: Expression;
  args: CallArgument[];
}

export interface NameExpression extends AstNode {
  kind: 'NameExpression';
  name: string;
}

export interface IntegerLiteral extends AstNode {
  kind: 'IntegerLiteral';
  value: number;
  raw: string;
}

export interface RealLiteral extends AstNode {
  kind: 'RealLiteral';
  value: number;
  raw: string;
}

export interface StringLiteral extends AstNode {
  kind: 'StringLiteral';
  value: string;
  raw: string;
}

export interface BoolLiteral extends AstNode {
  kind: 'BoolLiteral';
  value: boolean;
}

export interface ArrayLiteral extends AstNode {
  kind: 'ArrayLiteral';
  elements: Expression[];
}

// ---------------------------------------------------------------------------
// TYPE...END_TYPE declarations
// ---------------------------------------------------------------------------

export interface StructDeclaration extends AstNode {
  kind: 'StructDeclaration';
  name: string;
  extendsRef?: NamedRef;
  fields: VarDeclaration[];
}

export interface EnumValue {
  name: string;
  value?: Expression;
  range: Range;
}

export interface EnumDeclaration extends AstNode {
  kind: 'EnumDeclaration';
  name: string;
  baseType?: TypeRef;
  values: EnumValue[];
}

export interface AliasDeclaration extends AstNode {
  kind: 'AliasDeclaration';
  name: string;
  type: TypeRef;
}

export interface UnionDeclaration extends AstNode {
  kind: 'UnionDeclaration';
  name: string;
  fields: VarDeclaration[];
}

export type TypeDeclaration = StructDeclaration | EnumDeclaration | AliasDeclaration | UnionDeclaration;

export interface TypeDeclarationBlock extends AstNode {
  kind: 'TypeDeclarationBlock';
  declarations: TypeDeclaration[];
}

// ---------------------------------------------------------------------------
// INTERFACE declaration
// ---------------------------------------------------------------------------

export interface MethodDeclaration extends AstNode {
  kind: 'MethodDeclaration';
  name: string;
  returnType?: TypeRef;
  modifiers: string[];
  varBlocks: VarBlock[];
  body: Statement[];
}

export interface ActionDeclaration extends AstNode {
  kind: 'ActionDeclaration';
  name: string;
  body: Statement[];
}

export interface PropertyAccessor {
  varBlocks: VarBlock[];
  body: Statement[];
}

export interface PropertyDeclaration extends AstNode {
  kind: 'PropertyDeclaration';
  name: string;
  type: TypeRef;
  modifiers: string[];
  getAccessor?: PropertyAccessor;
  setAccessor?: PropertyAccessor;
}

export interface InterfaceDeclaration extends AstNode {
  kind: 'InterfaceDeclaration';
  name: string;
  extendsRefs: NamedRef[];
  methods: MethodDeclaration[];
  properties: PropertyDeclaration[];
}

// ---------------------------------------------------------------------------
// Pragma attributes
// ---------------------------------------------------------------------------

/** A TwinCAT {attribute '...'} pragma attached to a declaration. */
export interface Pragma extends AstNode {
  kind: 'Pragma';
  /** Attribute name, e.g. 'hide', 'monitoring', 'obsolete'. */
  name: string;
  /** Optional value after ':=', e.g. 'call' in {attribute 'monitoring' := 'call'}. */
  value?: string;
  /** The raw pragma text including braces. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Parse errors
// ---------------------------------------------------------------------------

export interface ParseError {
  message: string;
  range: Range;
  severity?: 'error' | 'warning';
}
