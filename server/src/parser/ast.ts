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
  isPointer?: boolean;   // POINTER TO <name>
  isReference?: boolean; // REFERENCE TO <name>
  isArray?: boolean;     // ARRAY[dims] OF <name>
  arrayDims?: ArrayDim[];
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
  | FunctionDeclaration;

// ---------------------------------------------------------------------------
// Top-level declarations
// ---------------------------------------------------------------------------

export interface ProgramDeclaration extends AstNode {
  kind: 'ProgramDeclaration';
  name: string;
  varBlocks: VarBlock[];
  body: Statement[];
}

export interface FunctionBlockDeclaration extends AstNode {
  kind: 'FunctionBlockDeclaration';
  name: string;
  varBlocks: VarBlock[];
  body: Statement[];
}

export interface FunctionDeclaration extends AstNode {
  kind: 'FunctionDeclaration';
  name: string;
  returnType: TypeRef | null;
  varBlocks: VarBlock[];
  body: Statement[];
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
  | 'VAR_EXTERNAL';

export interface VarBlock extends AstNode {
  kind: 'VarBlock';
  varKind: VarKind;
  declarations: VarDeclaration[];
}

export interface VarDeclaration extends AstNode {
  kind: 'VarDeclaration';
  name: string;
  type: TypeRef;
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
  | EmptyStatement;

export interface AssignmentStatement extends AstNode {
  kind: 'AssignmentStatement';
  left: Expression;
  right: Expression;
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
  | BoolLiteral;

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
  index: Expression;
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

// ---------------------------------------------------------------------------
// Parse errors
// ---------------------------------------------------------------------------

export interface ParseError {
  message: string;
  range: Range;
}
