/**
 * Beckhoff TwinCAT 3 built-in type catalogue.
 *
 * Each entry provides hover documentation: type name, size in bytes,
 * value range, and a human-readable description.
 */

export interface BuiltinType {
  name: string;
  /** Size in bytes (undefined for variable-length types) */
  size?: number;
  /** Human-readable value range or notes */
  range: string;
  description: string;
}

export const BUILTIN_TYPES: readonly BuiltinType[] = [
  // Boolean
  {
    name: 'BOOL',
    size: 1,
    range: 'FALSE (0) or TRUE (1)',
    description: 'Boolean type. Occupies 1 byte; only the LSB is significant.',
  },

  // Unsigned integers
  {
    name: 'BYTE',
    size: 1,
    range: '0 … 255',
    description: 'Unsigned 8-bit integer (alias: USINT).',
  },
  {
    name: 'USINT',
    size: 1,
    range: '0 … 255',
    description: 'Unsigned 8-bit integer.',
  },
  {
    name: 'UINT',
    size: 2,
    range: '0 … 65 535',
    description: 'Unsigned 16-bit integer.',
  },
  {
    name: 'WORD',
    size: 2,
    range: '0 … 65 535',
    description: 'Unsigned 16-bit integer (alias: UINT). Commonly used for bit-fields.',
  },
  {
    name: 'UDINT',
    size: 4,
    range: '0 … 4 294 967 295',
    description: 'Unsigned 32-bit integer.',
  },
  {
    name: 'DWORD',
    size: 4,
    range: '0 … 4 294 967 295',
    description: 'Unsigned 32-bit integer (alias: UDINT). Commonly used for bit-fields.',
  },
  {
    name: 'ULINT',
    size: 8,
    range: '0 … 18 446 744 073 709 551 615',
    description: 'Unsigned 64-bit integer.',
  },
  {
    name: 'LWORD',
    size: 8,
    range: '0 … 18 446 744 073 709 551 615',
    description: 'Unsigned 64-bit integer (alias: ULINT).',
  },

  // Signed integers
  {
    name: 'SINT',
    size: 1,
    range: '-128 … 127',
    description: 'Signed 8-bit integer.',
  },
  {
    name: 'INT',
    size: 2,
    range: '-32 768 … 32 767',
    description: 'Signed 16-bit integer.',
  },
  {
    name: 'DINT',
    size: 4,
    range: '-2 147 483 648 … 2 147 483 647',
    description: 'Signed 32-bit integer.',
  },
  {
    name: 'LINT',
    size: 8,
    range: '-9 223 372 036 854 775 808 … 9 223 372 036 854 775 807',
    description: 'Signed 64-bit integer.',
  },

  // Floating-point
  {
    name: 'REAL',
    size: 4,
    range: '±1.175e-38 … ±3.403e+38 (IEEE 754 single)',
    description: 'Single-precision 32-bit floating-point number (IEEE 754).',
  },
  {
    name: 'LREAL',
    size: 8,
    range: '±2.225e-308 … ±1.798e+308 (IEEE 754 double)',
    description: 'Double-precision 64-bit floating-point number (IEEE 754).',
  },

  // Time types
  {
    name: 'TIME',
    size: 4,
    range: 'T#0ms … T#49d17h2m47s295ms',
    description:
      'Duration stored as unsigned 32-bit millisecond count. Literals: T#1s, T#500ms.',
  },
  {
    name: 'LTIME',
    size: 8,
    range: 'LTIME#0ns … LTIME#213503d23h34m33s709ms551us615ns',
    description:
      'High-resolution duration stored as unsigned 64-bit nanosecond count.',
  },
  {
    name: 'TIME_OF_DAY',
    size: 4,
    range: 'TOD#00:00:00 … TOD#23:59:59.999',
    description: 'Time-of-day in milliseconds since midnight (IEC 61131-3).',
  },
  {
    name: 'TOD',
    size: 4,
    range: 'TOD#00:00:00 … TOD#23:59:59.999',
    description: 'Alias for TIME_OF_DAY.',
  },
  {
    name: 'DATE',
    size: 4,
    range: 'D#1970-01-01 … D#2106-02-06',
    description: 'Calendar date stored as days since 1970-01-01.',
  },
  {
    name: 'DATE_AND_TIME',
    size: 4,
    range: 'DT#1970-01-01-00:00:00 … DT#2106-02-06-06:28:15',
    description: 'Date and time of day combined (seconds since 1970-01-01).',
  },
  {
    name: 'DT',
    size: 4,
    range: 'DT#1970-01-01-00:00:00 … DT#2106-02-06-06:28:15',
    description: 'Alias for DATE_AND_TIME.',
  },

  // String types
  {
    name: 'STRING',
    size: undefined,
    range: 'Up to 255 characters by default (configurable)',
    description:
      "Variable-length string of single-byte characters. Declare with explicit length: STRING(80). Default length is 80 in TwinCAT's PLC runtime.",
  },
  {
    name: 'WSTRING',
    size: undefined,
    range: 'Up to 255 UTF-16 characters by default (configurable)',
    description:
      'Variable-length wide (UTF-16) string. Declare with explicit length: WSTRING(80).',
  },
];

/**
 * Look up a built-in type by name (case-insensitive).
 */
export function findBuiltinType(name: string): BuiltinType | undefined {
  const upper = name.toUpperCase();
  return BUILTIN_TYPES.find((t) => t.name === upper);
}

/**
 * Return hover documentation markdown for a built-in type.
 */
export function builtinTypeHover(type: BuiltinType): string {
  const sizeStr = type.size !== undefined ? `${type.size} byte${type.size !== 1 ? 's' : ''}` : 'variable length';
  return [
    `**${type.name}** — ${type.description}`,
    '',
    `| Property | Value |`,
    `|----------|-------|`,
    `| Size     | ${sizeStr} |`,
    `| Range    | ${type.range} |`,
  ].join('\n');
}
