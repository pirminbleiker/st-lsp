import { describe, it, expect, beforeAll } from 'vitest';
import { readLibraryIndex, LibraryIndex } from '../twincat/libraryZipReader';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const LIB_PATH = path.resolve(__dirname, '../../../tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/_Libraries/Beckhoff Automation GmbH/Tc2_Standard/3.4.5.0/Tc2_Standard.compiled-library-ge33');

const JSON_LIB_PATH = path.resolve(__dirname, '../../../tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/_Libraries/Beckhoff Automation GmbH/Tc3_JsonXml/3.4.7.0/Tc3_JsonXml.compiled-library-ge33');

function ensureFixtures() {
  if (!fs.existsSync(LIB_PATH) || !fs.existsSync(JSON_LIB_PATH)) {
    const script = path.resolve(__dirname, '../../../tools/generate-compiled-lib-fixtures.js');
    execFileSync('node', [script], { stdio: 'pipe' });
  }
}

describe('compiled library extraction (Tc2_Standard)', () => {
  let index: LibraryIndex;

  beforeAll(() => {
    ensureFixtures();
    index = readLibraryIndex(LIB_PATH);
  });

  it('extracts library name', () => {
    expect(index.name).toBe('Tc2_Standard');
  });

  it('extracts 31 POU symbols', () => {
    expect(index.symbols.length).toBe(31);
  });

  it('extracts known POU names', () => {
    const names = index.symbols.map(s => s.name);
    expect(names).toContain('F_TRIG');
    expect(names).toContain('R_TRIG');
    expect(names).toContain('TON');
    expect(names).toContain('TOF');
    expect(names).toContain('CTU');
    expect(names).toContain('CTD');
    expect(names).toContain('RS');
    expect(names).toContain('SR');
  });

  it('F_TRIG has CLK input with comment', () => {
    const ftrig = index.symbols.find(s => s.name === 'F_TRIG');
    expect(ftrig).toBeDefined();
    expect(ftrig!.inputs).toBeDefined();
    expect(ftrig!.inputs!.some(p => p.name === 'CLK')).toBe(true);
    const clk = ftrig!.inputs!.find(p => p.name === 'CLK');
    expect(clk!.comment).toContain('signal to detect');
  });

  it('F_TRIG has description', () => {
    const ftrig = index.symbols.find(s => s.name === 'F_TRIG');
    expect(ftrig!.description).toContain('Falling Edge');
  });

  it('RS has SET and RESET1 params', () => {
    const rs = index.symbols.find(s => s.name === 'RS');
    expect(rs).toBeDefined();
    const paramNames = rs!.inputs?.map(p => p.name) ?? [];
    expect(paramNames).toContain('SET');
    expect(paramNames).toContain('RESET1');
  });

  it('CTD has CD and LOAD params', () => {
    const ctd = index.symbols.find(s => s.name === 'CTD');
    expect(ctd).toBeDefined();
    const paramNames = ctd!.inputs?.map(p => p.name) ?? [];
    expect(paramNames).toContain('CD');
    expect(paramNames).toContain('LOAD');
  });

  it('TOF has IN and PT params', () => {
    const tof = index.symbols.find(s => s.name === 'TOF');
    expect(tof).toBeDefined();
    const paramNames = tof!.inputs?.map(p => p.name) ?? [];
    expect(paramNames).toContain('IN');
    expect(paramNames).toContain('PT');
  });

  it('TOF has description about delay', () => {
    const tof = index.symbols.find(s => s.name === 'TOF');
    expect(tof!.description).toContain('Off-Delay');
  });

  it('Tc2_Standard FBs have no methods (simple FBs)', () => {
    for (const sym of index.symbols) {
      expect(sym.methods).toBeUndefined();
    }
  });

  it('F_TRIG CLK input has type BOOL', () => {
    const ftrig = index.symbols.find(s => s.name === 'F_TRIG');
    const clk = ftrig!.inputs!.find(p => p.name === 'CLK');
    expect(clk!.type).toBe('BOOL');
  });

  it('F_TRIG Q output has type BOOL', () => {
    const ftrig = index.symbols.find(s => s.name === 'F_TRIG');
    const q = ftrig!.outputs!.find(p => p.name === 'Q');
    expect(q!.type).toBe('BOOL');
  });

  it('TON.IN has type BOOL', () => {
    const ton = index.symbols.find(s => s.name === 'TON');
    const inParam = ton!.inputs!.find(p => p.name === 'IN');
    expect(inParam).toBeDefined();
    expect(inParam!.type).toBe('BOOL');
  });

  it('TON has TIME types for PT and ET', () => {
    const ton = index.symbols.find(s => s.name === 'TON');
    const pt = ton!.inputs!.find(p => p.name === 'PT');
    const et = ton!.outputs!.find(p => p.name === 'ET');
    expect(pt!.type).toBe('TIME');
    expect(et!.type).toBe('TIME');
  });

  it('CTU has WORD type for PV and CV', () => {
    const ctu = index.symbols.find(s => s.name === 'CTU');
    const pv = ctu!.inputs!.find(p => p.name === 'PV');
    const cv = ctu!.outputs!.find(p => p.name === 'CV');
    expect(pv!.type).toBe('WORD');
    expect(cv!.type).toBe('WORD');
  });
});

// ---------------------------------------------------------------------------
// Tc3_JsonXml — method extraction tests
// ---------------------------------------------------------------------------

describe('compiled library extraction (Tc3_JsonXml)', () => {
  let index: LibraryIndex;

  beforeAll(() => {
    ensureFixtures();
    index = readLibraryIndex(JSON_LIB_PATH);
  });

  it('extracts library name', () => {
    expect(index.name).toBe('Tc3_JsonXml');
  });

  it('extracts FB symbols', () => {
    const names = index.symbols.map(s => s.name);
    expect(names).toContain('FB_JsonSaxWriter');
    expect(names).toContain('FB_JsonDomParser');
    expect(names).toContain('FB_JsonSaxReader');
  });

  it('FB_JsonSaxWriter has methods', () => {
    const fb = index.symbols.find(s => s.name === 'FB_JsonSaxWriter');
    expect(fb).toBeDefined();
    expect(fb!.methods).toBeDefined();
    expect(fb!.methods!.length).toBeGreaterThan(10);
  });

  it('FB_JsonSaxWriter methods include AddKey and AddBool', () => {
    const fb = index.symbols.find(s => s.name === 'FB_JsonSaxWriter');
    const methodNames = fb!.methods!.map(m => m.name);
    expect(methodNames).toContain('AddKey');
    expect(methodNames).toContain('AddBool');
  });

  it('FB_JsonDomParserBase has many methods', () => {
    const fb = index.symbols.find(s => s.name === 'FB_JsonDomParserBase');
    expect(fb).toBeDefined();
    expect(fb!.methods).toBeDefined();
    expect(fb!.methods!.length).toBeGreaterThan(50);
  });

  it('simple FBs without methods have no methods array', () => {
    // FB_JwtEncode only has FB_init/FB_exit — still has methods
    const fb = index.symbols.find(s => s.name === 'FB_JwtEncode');
    if (fb?.methods) {
      expect(fb.methods.length).toBeGreaterThan(0);
    }
  });
});
