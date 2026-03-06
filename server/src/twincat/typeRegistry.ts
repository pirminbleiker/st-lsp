/**
 * Type registry for compiled TwinCAT library parameters.
 *
 * Parameter data types are NOT encoded in compiled-library binary files
 * (they reside in the encrypted __languagemodel.auxiliary). This module
 * provides ground-truth type mappings for IEC 61131-3 standard function
 * blocks so the LSP can display accurate type information.
 */

/** Per-POU parameter type map: paramName -> IEC type string. */
type ParamTypeMap = Record<string, string>;

/**
 * Ground-truth parameter types for IEC 61131-3 standard FBs.
 * Covers Tc2_Standard and common TwinCAT extensions.
 */
const STANDARD_FB_TYPES: Record<string, ParamTypeMap> = {
  // Bistable
  SR:    { S1: 'BOOL', R: 'BOOL', Q1: 'BOOL' },
  RS:    { SET: 'BOOL', RESET1: 'BOOL', Q1: 'BOOL' },

  // Edge detection
  R_TRIG: { CLK: 'BOOL', Q: 'BOOL' },
  F_TRIG: { CLK: 'BOOL', Q: 'BOOL' },

  // Counters
  CTU:   { CU: 'BOOL', RESET: 'BOOL', PV: 'WORD', Q: 'BOOL', CV: 'WORD' },
  CTD:   { CD: 'BOOL', LOAD: 'BOOL', PV: 'WORD', Q: 'BOOL', CV: 'WORD' },
  CTUD:  { CU: 'BOOL', CD: 'BOOL', RESET: 'BOOL', LOAD: 'BOOL', PV: 'WORD', QU: 'BOOL', QD: 'BOOL', CV: 'WORD' },

  // Timers
  TP:    { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' },
  TON:   { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' },
  TOF:   { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' },

  // LTIME timer variants (TwinCAT extended)
  LTP:   { IN: 'BOOL', PT: 'LTIME', Q: 'BOOL', ET: 'LTIME' },
  LTON:  { IN: 'BOOL', PT: 'LTIME', Q: 'BOOL', ET: 'LTIME' },
  LTOF:  { IN: 'BOOL', PT: 'LTIME', Q: 'BOOL', ET: 'LTIME' },

  // Semaphore
  SEMA:  { CLAIM: 'BOOL', RELEASE: 'BOOL', BUSY: 'BOOL' },

  // DWORD counter variants
  LCTU:  { CU: 'BOOL', RESET: 'BOOL', PV: 'DWORD', Q: 'BOOL', CV: 'DWORD' },
  LCTD:  { CD: 'BOOL', LOAD: 'BOOL', PV: 'DWORD', Q: 'BOOL', CV: 'DWORD' },
  LCTUD: { CU: 'BOOL', CD: 'BOOL', RESET: 'BOOL', LOAD: 'BOOL', PV: 'DWORD', QU: 'BOOL', QD: 'BOOL', CV: 'DWORD' },

  // Standard functions (Tc2_Standard)
  CONCAT: { STR1: 'STRING', STR2: 'STRING' },
  DELETE: { STR: 'STRING', LEN: 'INT', POS: 'INT' },
  FIND:   { STR1: 'STRING', STR2: 'STRING' },
  INSERT: { STR1: 'STRING', STR2: 'STRING', POS: 'INT' },
  LEFT:   { STR: 'STRING', SIZE: 'INT' },
  LEN:    { STR: 'STRING' },
  MID:    { STR: 'STRING', LEN: 'INT', POS: 'INT' },
  REPLACE:{ STR1: 'STRING', STR2: 'STRING', LEN: 'INT', POS: 'INT' },
  RIGHT:  { STR: 'STRING', SIZE: 'INT' },
};

/**
 * Resolve the IEC 61131-3 data type for a parameter of a known standard FB.
 *
 * @param pouName   Name of the POU (e.g. "TON", "CTU").
 * @param paramName Name of the parameter (e.g. "PT", "CV").
 * @returns The type string (e.g. "TIME", "WORD") or empty string if unknown.
 */
export function resolveParamType(pouName: string, paramName: string): string {
  const pou = STANDARD_FB_TYPES[pouName] ?? STANDARD_FB_TYPES[pouName.toUpperCase()];
  if (!pou) return '';
  return pou[paramName] ?? pou[paramName.toUpperCase()] ?? '';
}

/**
 * Check whether a POU has ground-truth type information available.
 */
export function hasTypeInfo(pouName: string): boolean {
  return pouName in STANDARD_FB_TYPES || pouName.toUpperCase() in STANDARD_FB_TYPES;
}
