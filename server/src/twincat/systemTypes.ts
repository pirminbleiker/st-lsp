/**
 * TwinCAT 3 system types and compiler intrinsics catalog.
 *
 * Covers types, functions, and identifiers that are always available in
 * TwinCAT 3 runtime without requiring an explicit library reference:
 *   - IEC 61131-3 generic types (ANY, ANY_NUM, etc.)
 *   - TwinCAT system types (T_MAXSTRING, PVOID, TIMESTRUCT, etc.)
 *   - Compiler intrinsics (__NEW, __DELETE, ADR, SIZEOF, etc.)
 *   - Auto-generated IEC type conversion functions (DINT_TO_UDINT, etc.)
 */

export interface SystemType {
  name: string;
  description: string;
}

export interface SystemFunction {
  name: string;
  description: string;
}

export const SYSTEM_TYPES: readonly SystemType[] = [
  // IEC 61131-3 generic types
  { name: 'ANY', description: 'IEC 61131-3 generic type — matches any data type.' },
  { name: 'ANY_NUM', description: 'IEC generic numeric type — matches any numeric type.' },
  { name: 'ANY_INT', description: 'IEC generic integer type — matches any integer type.' },
  { name: 'ANY_REAL', description: 'IEC generic real type — matches REAL or LREAL.' },
  { name: 'ANY_BIT', description: 'IEC generic bit type — matches BOOL, BYTE, WORD, DWORD, LWORD.' },
  { name: 'ANY_STRING', description: 'IEC generic string type — matches STRING or WSTRING.' },
  { name: 'ANY_DATE', description: 'IEC generic date type — matches DATE, DT, TOD.' },
  { name: 'ANY_ELEMENTARY', description: 'IEC generic elementary type.' },
  { name: 'ANY_MAGNITUDE', description: 'IEC generic magnitude type.' },
  // TwinCAT string/alias types
  { name: 'T_MAXSTRING', description: 'TwinCAT alias for STRING(255) — maximum-length string.' },
  { name: 'T_MINSTRING', description: 'TwinCAT alias for STRING(1) — minimum-length string.' },
  // TwinCAT pointer/memory types
  { name: 'PVOID', description: 'Pointer to VOID — generic untyped pointer (TwinCAT system type).' },
  { name: 'POINTER', description: 'IEC/TwinCAT pointer base keyword.' },
  { name: 'REFERENCE', description: 'IEC/TwinCAT reference base keyword.' },
  // TwinCAT AMS/network types
  { name: 'T_AMSNETID', description: 'TwinCAT AMS Net ID — STRING(23) type alias.' },
  { name: 'T_AMSPORT', description: 'TwinCAT AMS port number (UINT).' },
  { name: 'AMSADDR', description: 'TwinCAT AMS address structure (NetId + Port).' },
  { name: 'AMSNETID', description: 'TwinCAT AMS Net ID structure.' },
  // TwinCAT time types
  { name: 'TIMESTRUCT', description: 'TwinCAT local time structure (year, month, day, hour, minute, second, ms).' },
  { name: 'T_DCTIME64', description: 'TwinCAT distributed clock 64-bit timestamp.' },
  { name: 'DCTIME', description: 'TwinCAT distributed clock timestamp type.' },
  { name: 'T_FILETIME', description: 'Windows FILETIME — 64-bit value (100ns intervals since 1601-01-01).' },
  { name: 'FILETIME', description: 'Windows FILETIME structure — 64-bit timestamp (100ns intervals since 1601-01-01).' },
  // TwinCAT motion types
  { name: 'AXIS_REF', description: 'TwinCAT NC axis reference structure.' },
  { name: 'NCTOPLC_AXIS_REF', description: 'NC-to-PLC axis cyclic data structure.' },
  { name: 'PLCTONC_AXIS_REF', description: 'PLC-to-NC axis cyclic data structure.' },
  // TwinCAT extended integer types
  { name: 'XINT', description: 'TwinCAT platform-native signed integer (32- or 64-bit).' },
  { name: 'UXINT', description: 'TwinCAT platform-native unsigned integer.' },
  { name: 'XWORD', description: 'TwinCAT platform-native word.' },
  // TwinCAT JSON library types (Tc3_JsonXml)
  { name: 'SJSONVALUE', description: 'TwinCAT JSON library type (Tc3_JsonXml) — represents a JSON value.' },
  // Other common TwinCAT types
  { name: 'T_ARG', description: 'TwinCAT generic argument type for variable-argument functions.' },
  { name: 'E_ECAT_STATE', description: 'EtherCAT state enumeration.' },
];

export const SYSTEM_FUNCTIONS: readonly SystemFunction[] = [
  // Compiler intrinsics (double-underscore prefix)
  { name: '__NEW', description: 'TwinCAT compiler intrinsic — dynamically allocates a new FB/struct instance on the heap.' },
  { name: '__DELETE', description: 'TwinCAT compiler intrinsic — frees a dynamically allocated instance.' },
  { name: '__QUERYINTERFACE', description: 'TwinCAT compiler intrinsic — queries whether an interface reference supports a given interface (OOP).' },
  { name: '__QUERYPOINTER', description: 'TwinCAT compiler intrinsic — queries a pointer from an interface reference.' },
  { name: '__ISVALIDREF', description: 'TwinCAT compiler intrinsic — checks if a REFERENCE is valid (not pointing to nothing).' },
  { name: '__VARINFO', description: 'TwinCAT compiler intrinsic — returns symbol information (name, type, address) for a variable.' },
  { name: '__POUNAME', description: 'TwinCAT compiler intrinsic — returns the name of the current POU as a string.' },
  { name: '__POSITION', description: 'TwinCAT compiler intrinsic — returns the current source position as a string.' },
  { name: '__GETCPUPATH', description: 'TwinCAT compiler intrinsic — returns the runtime AMS net ID.' },
  // Standard address/size operators
  { name: 'ADR', description: 'Returns the address (PVOID/pointer) of the given variable.' },
  { name: 'ADRINST', description: 'Returns the address of an FB instance.' },
  { name: 'SIZEOF', description: 'Returns the size in bytes of the given variable or type.' },
  { name: 'ALIGNOF', description: 'Returns the alignment requirement of the given variable or type.' },
  // Standard memory functions (always available in TwinCAT without a library import)
  { name: 'MEMCPY', description: 'Copies n bytes from source to destination.' },
  { name: 'MEMSET', description: 'Fills n bytes of memory with the constant byte value.' },
  { name: 'MEMMOVE', description: 'Moves n bytes (handles overlapping regions).' },
  { name: 'MEMCMP', description: 'Compares n bytes of two memory areas; returns 0 if equal.' },
  // Type-query helpers
  { name: 'ISEMPTY', description: 'Checks if a string is empty.' },
  // IEC 61131-3 standard functions (always available in TwinCAT via Tc2_Standard)
  { name: 'MIN', description: 'Returns the lesser of IN0 and IN1.' },
  { name: 'MAX', description: 'Returns the greater of IN0 and IN1.' },
  { name: 'ABS', description: 'Returns the absolute value of IN.' },
  { name: 'TRUNC', description: 'Truncates a floating-point number toward zero.' },
  { name: 'MOVE', description: 'Returns the value of IN unchanged.' },
  { name: 'LIMIT', description: 'Clamps IN between MN and MX.' },
  { name: 'SEL', description: 'Binary selector: returns IN0 if G=FALSE, IN1 if G=TRUE.' },
  { name: 'MUX', description: 'Multiplexer: selects one of multiple inputs based on K.' },
  // String functions
  { name: 'LEN', description: 'Returns the current length (number of characters) of STR.' },
  { name: 'LEFT', description: 'Returns the leftmost SIZE characters of STR.' },
  { name: 'RIGHT', description: 'Returns the rightmost SIZE characters of STR.' },
  { name: 'MID', description: 'Returns LEN characters from STR starting at position POS.' },
  { name: 'CONCAT', description: 'Concatenates two or more strings.' },
  { name: 'INSERT', description: 'Inserts STR2 into STR1 at position POS.' },
  { name: 'DELETE', description: 'Deletes LEN characters from STR starting at position POS.' },
  { name: 'REPLACE', description: 'Replaces LEN characters in STR1 starting at POS with STR2.' },
  { name: 'FIND', description: 'Returns the position of STR2 within STR1, or 0 if not found.' },
];

// ── Pre-built lookup sets (uppercase for case-insensitive matching) ─────────

export const SYSTEM_TYPE_NAMES: ReadonlySet<string> = new Set(
  SYSTEM_TYPES.map(t => t.name.toUpperCase()),
);

export const SYSTEM_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  SYSTEM_FUNCTIONS.map(f => f.name.toUpperCase()),
);

// ── Auto-generated IEC type-conversion function names ─────────────────────

/**
 * IEC 61131-3 defines standard type-conversion functions for every
 * combination of elementary types: <SRC>_TO_<DEST>.
 *
 * TwinCAT 3 supports all of these plus additional conversions to/from
 * WSTRING, LREAL, LINT, ULINT, LTIME, LWORD, etc.
 *
 * We generate all combinations from the set of elementary IEC types.
 */
const IEC_ELEMENTARY_TYPES = [
  'BOOL',
  'BYTE', 'WORD', 'DWORD', 'LWORD',
  'USINT', 'UINT', 'UDINT', 'ULINT',
  'SINT', 'INT', 'DINT', 'LINT',
  'REAL', 'LREAL',
  'STRING', 'WSTRING',
  'TIME', 'LTIME',
  'TIME_OF_DAY', 'TOD',
  'DATE',
  'DATE_AND_TIME', 'DT',
] as const;

function generateTypeConversionNames(): Set<string> {
  const names = new Set<string>();
  for (const src of IEC_ELEMENTARY_TYPES) {
    for (const dest of IEC_ELEMENTARY_TYPES) {
      if (src !== dest) {
        names.add(`${src}_TO_${dest}`);
      }
    }
  }
  return names;
}

export const TYPE_CONVERSION_NAMES: ReadonlySet<string> = generateTypeConversionNames();
