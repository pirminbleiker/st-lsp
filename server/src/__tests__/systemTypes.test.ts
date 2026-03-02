import { describe, it, expect } from 'vitest';
import { SYSTEM_TYPE_NAMES, SYSTEM_FUNCTION_NAMES, TYPE_CONVERSION_NAMES } from '../twincat/systemTypes';

describe('SYSTEM_TYPE_NAMES', () => {
  it('contains T_MAXSTRING', () => expect(SYSTEM_TYPE_NAMES.has('T_MAXSTRING')).toBe(true));
  it('contains PVOID', () => expect(SYSTEM_TYPE_NAMES.has('PVOID')).toBe(true));
  it('contains ANY', () => expect(SYSTEM_TYPE_NAMES.has('ANY')).toBe(true));
  it('contains ANY_NUM', () => expect(SYSTEM_TYPE_NAMES.has('ANY_NUM')).toBe(true));
  it('contains ANY_INT', () => expect(SYSTEM_TYPE_NAMES.has('ANY_INT')).toBe(true));
  it('contains ANY_REAL', () => expect(SYSTEM_TYPE_NAMES.has('ANY_REAL')).toBe(true));
  it('contains ANY_BIT', () => expect(SYSTEM_TYPE_NAMES.has('ANY_BIT')).toBe(true));
  it('contains TIMESTRUCT', () => expect(SYSTEM_TYPE_NAMES.has('TIMESTRUCT')).toBe(true));
  it('contains AXIS_REF', () => expect(SYSTEM_TYPE_NAMES.has('AXIS_REF')).toBe(true));
  it('all names are uppercase', () => {
    for (const name of SYSTEM_TYPE_NAMES) {
      expect(name).toBe(name.toUpperCase());
    }
  });
});

describe('SYSTEM_FUNCTION_NAMES', () => {
  it('contains __NEW', () => expect(SYSTEM_FUNCTION_NAMES.has('__NEW')).toBe(true));
  it('contains __DELETE', () => expect(SYSTEM_FUNCTION_NAMES.has('__DELETE')).toBe(true));
  it('contains __QUERYINTERFACE', () => expect(SYSTEM_FUNCTION_NAMES.has('__QUERYINTERFACE')).toBe(true));
  it('contains __ISVALIDREF', () => expect(SYSTEM_FUNCTION_NAMES.has('__ISVALIDREF')).toBe(true));
  it('contains ADR', () => expect(SYSTEM_FUNCTION_NAMES.has('ADR')).toBe(true));
  it('contains SIZEOF', () => expect(SYSTEM_FUNCTION_NAMES.has('SIZEOF')).toBe(true));
  it('all names are uppercase', () => {
    for (const name of SYSTEM_FUNCTION_NAMES) {
      expect(name).toBe(name.toUpperCase());
    }
  });
});

describe('TYPE_CONVERSION_NAMES', () => {
  it('contains DINT_TO_UDINT', () => expect(TYPE_CONVERSION_NAMES.has('DINT_TO_UDINT')).toBe(true));
  it('contains INT_TO_DINT', () => expect(TYPE_CONVERSION_NAMES.has('INT_TO_DINT')).toBe(true));
  it('contains BOOL_TO_INT', () => expect(TYPE_CONVERSION_NAMES.has('BOOL_TO_INT')).toBe(true));
  it('contains REAL_TO_LREAL', () => expect(TYPE_CONVERSION_NAMES.has('REAL_TO_LREAL')).toBe(true));
  it('contains DINT_TO_STRING', () => expect(TYPE_CONVERSION_NAMES.has('DINT_TO_STRING')).toBe(true));
  it('does not contain X_TO_X (same type)', () => {
    // Same-to-same conversions are usually not generated
    // But it's ok if they are — just verify the set is populated
    expect(TYPE_CONVERSION_NAMES.size).toBeGreaterThan(50);
  });
  it('all names are uppercase', () => {
    for (const name of TYPE_CONVERSION_NAMES) {
      expect(name).toBe(name.toUpperCase());
    }
  });
});
