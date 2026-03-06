import { Expression } from '../parser/ast';

/**
 * Format a constant expression as a human-readable string.
 * Used to display initializer values in hover and completion detail.
 * Expressions are shown as text (not evaluated).
 */
export function formatConstantValue(expr: Expression): string {
  switch (expr.kind) {
    case 'IntegerLiteral': return expr.raw;
    case 'RealLiteral':    return expr.raw;
    case 'StringLiteral':  return expr.raw;
    case 'BoolLiteral':    return expr.value ? 'TRUE' : 'FALSE';
    case 'NameExpression': return expr.name;
    case 'UnaryExpression':
      return `${expr.op}${formatConstantValue(expr.operand)}`;
    case 'BinaryExpression':
      return `${formatConstantValue(expr.left)} ${expr.op} ${formatConstantValue(expr.right)}`;
    case 'StructInitializer':
      return `(${expr.fields.map(f => f.name ? `${f.name} := ${formatConstantValue(f.value)}` : formatConstantValue(f.value)).join(', ')})`;
    default:
      return '...';
  }
}
