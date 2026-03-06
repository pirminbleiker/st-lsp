#!/usr/bin/env node
/**
 * Generate synthetic TwinCAT compiled-library fixture files for tests.
 *
 * These fixtures match the binary format expected by libraryZipReader.ts:
 *   - ZIP archive with projectinformations.auxiliary, string table, and .meta files
 *   - Indexed string table: varint(count) + repeated[varint(idx), varint(len), bytes]
 *   - .meta files: 4-byte magic + 16-byte header + 5 varints
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Varint encoding (LEB128)
// ---------------------------------------------------------------------------

function encodeVarint(value) {
  const bytes = [];
  do {
    let b = value & 0x7f;
    value >>>= 7;
    if (value !== 0) b |= 0x80;
    bytes.push(b);
  } while (value !== 0);
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// String table builder
// ---------------------------------------------------------------------------

function buildStringTable(entries) {
  // entries: Array<[index, string]>
  const parts = [encodeVarint(entries.length)];
  for (const [idx, str] of entries) {
    const strBuf = Buffer.from(str, 'utf8');
    parts.push(encodeVarint(idx));
    parts.push(encodeVarint(strBuf.length));
    parts.push(strBuf);
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// .meta file builder
// ---------------------------------------------------------------------------

const META_MAGIC = 0x28092002;

function buildMetaFile(guidIndex, ownerGuidIndex, nameIndex, targetSize) {
  // 4-byte magic + 16-byte header + 5 varints + padding
  const header = Buffer.alloc(20);
  header.writeUInt32LE(META_MAGIC, 0);

  const varints = Buffer.concat([
    encodeVarint(0),             // v[0]
    encodeVarint(0),             // v[1]
    encodeVarint(guidIndex),     // v[2] = self GUID
    encodeVarint(ownerGuidIndex),// v[3] = owner GUID
    encodeVarint(nameIndex),     // v[4] = name string table index
  ]);

  const contentSize = 20 + varints.length;
  const padSize = Math.max(0, targetSize - contentSize);
  return Buffer.concat([header, varints, Buffer.alloc(padSize)]);
}

// ---------------------------------------------------------------------------
// Minimal ZIP builder
// ---------------------------------------------------------------------------

function buildZip(files) {
  // files: Array<{ name: string, data: Buffer }>
  const localEntries = [];
  const cdEntries = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const compressed = zlib.deflateRawSync(file.data);

    // Local file header
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);  // local header sig
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0, 6);            // flags
    lh.writeUInt16LE(8, 8);            // method = DEFLATE
    lh.writeUInt16LE(0, 10);           // mod time
    lh.writeUInt16LE(0, 12);           // mod date
    lh.writeUInt32LE(0, 14);           // crc32 (0 - not checked by reader)
    lh.writeUInt32LE(compressed.length, 18); // compressed size
    lh.writeUInt32LE(file.data.length, 22);  // uncompressed size
    lh.writeUInt16LE(nameBytes.length, 26);  // filename length
    lh.writeUInt16LE(0, 28);           // extra field length

    const localOffset = offset;
    localEntries.push(Buffer.concat([lh, nameBytes, compressed]));
    offset += 30 + nameBytes.length + compressed.length;

    // Central directory entry
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);  // cd header sig
    cd.writeUInt16LE(20, 4);           // version made by
    cd.writeUInt16LE(20, 6);           // version needed
    cd.writeUInt16LE(0, 8);            // flags
    cd.writeUInt16LE(8, 10);           // method = DEFLATE
    cd.writeUInt16LE(0, 12);           // mod time
    cd.writeUInt16LE(0, 14);           // mod date
    cd.writeUInt32LE(0, 16);           // crc32
    cd.writeUInt32LE(compressed.length, 20); // compressed size
    cd.writeUInt32LE(file.data.length, 24);  // uncompressed size
    cd.writeUInt16LE(nameBytes.length, 28);  // filename length
    cd.writeUInt16LE(0, 30);           // extra field length
    cd.writeUInt16LE(0, 32);           // file comment length
    cd.writeUInt16LE(0, 34);           // disk number start
    cd.writeUInt16LE(0, 36);           // internal file attributes
    cd.writeUInt32LE(0, 38);           // external file attributes
    cd.writeUInt32LE(localOffset, 42); // relative offset of local header

    cdEntries.push(Buffer.concat([cd, nameBytes]));
  }

  const localData = Buffer.concat(localEntries);
  const cdData = Buffer.concat(cdEntries);
  const cdOffset = localData.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);   // eocd sig
  eocd.writeUInt16LE(0, 4);             // disk number
  eocd.writeUInt16LE(0, 6);             // disk number with cd
  eocd.writeUInt16LE(files.length, 8);  // num entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdData.length, 12);// cd size
  eocd.writeUInt32LE(cdOffset, 16);     // cd offset
  eocd.writeUInt16LE(0, 20);            // comment length

  return Buffer.concat([localData, cdData, eocd]);
}

// ---------------------------------------------------------------------------
// projectinformations.auxiliary XML builder
// ---------------------------------------------------------------------------

function buildProjectInfo(name) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ProjectInformation>
  <Name>${name}</Name>
  <DefaultNamespace>${name}</DefaultNamespace>
</ProjectInformation>`;
  return Buffer.from(xml, 'utf8');
}

// ---------------------------------------------------------------------------
// Tc2_Standard fixture
// ---------------------------------------------------------------------------

function generateTc2Standard() {
  // 31 POUs from Tc2_Standard (IEC 61131-3 standard FBs + string functions)
  // Order here determines param block assignment (reversed by guidIndex)
  const pouDefs = [
    { name: 'F_TRIG', desc: ' Detects a Falling Edge on signal CLK', params: [
      { dir: 'Input', comment: ' signal to detect the falling edge', name: 'CLK' },
      { dir: 'Output', name: 'Q' },
    ]},
    { name: 'R_TRIG', desc: ' Detects a Rising Edge on signal CLK', params: [
      { dir: 'Input', comment: ' signal to detect the rising edge', name: 'CLK' },
      { dir: 'Output', name: 'Q' },
    ]},
    { name: 'TON', desc: ' On-Delay Timer function block', params: [
      { dir: 'Input', name: 'IN' }, { dir: 'Input', name: 'PT' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'ET' },
    ]},
    { name: 'TOF', desc: ' Off-Delay Timer function block', params: [
      { dir: 'Input', name: 'IN' }, { dir: 'Input', name: 'PT' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'ET' },
    ]},
    { name: 'TP', desc: ' Pulse Timer function block', params: [
      { dir: 'Input', name: 'IN' }, { dir: 'Input', name: 'PT' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'ET' },
    ]},
    { name: 'CTU', desc: ' Up Counter function block', params: [
      { dir: 'Input', name: 'CU' }, { dir: 'Input', name: 'RESET' }, { dir: 'Input', name: 'PV' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'CV' },
    ]},
    { name: 'CTD', desc: ' Down Counter function block', params: [
      { dir: 'Input', name: 'CD' }, { dir: 'Input', name: 'LOAD' }, { dir: 'Input', name: 'PV' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'CV' },
    ]},
    { name: 'CTUD', desc: ' Up-Down Counter function block', params: [
      { dir: 'Input', name: 'CU' }, { dir: 'Input', name: 'CD' },
      { dir: 'Input', name: 'RESET' }, { dir: 'Input', name: 'LOAD' }, { dir: 'Input', name: 'PV' },
      { dir: 'Output', name: 'QU' }, { dir: 'Output', name: 'QD' }, { dir: 'Output', name: 'CV' },
    ]},
    { name: 'RS', desc: ' RS Flip-Flop (Reset dominant) function block', params: [
      { dir: 'Input', name: 'SET' }, { dir: 'Input', name: 'RESET1' },
      { dir: 'Output', name: 'Q1' },
    ]},
    { name: 'SR', desc: ' SR Flip-Flop (Set dominant) function block', params: [
      { dir: 'Input', name: 'S1' }, { dir: 'Input', name: 'R' },
      { dir: 'Output', name: 'Q1' },
    ]},
    { name: 'SEMA', desc: ' Semaphore function block', params: [
      { dir: 'Input', name: 'CLAIM' }, { dir: 'Input', name: 'RELEASE' },
      { dir: 'Output', name: 'BUSY' },
    ]},
    { name: 'LTON', desc: ' On-Delay Timer (LTIME) function block', params: [
      { dir: 'Input', name: 'IN' }, { dir: 'Input', name: 'PT' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'ET' },
    ]},
    { name: 'LTOF', desc: ' Off-Delay Timer (LTIME) function block', params: [
      { dir: 'Input', name: 'IN' }, { dir: 'Input', name: 'PT' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'ET' },
    ]},
    { name: 'LTP', desc: ' Pulse Timer (LTIME) function block', params: [
      { dir: 'Input', name: 'IN' }, { dir: 'Input', name: 'PT' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'ET' },
    ]},
    { name: 'LCTU', desc: ' Up Counter (DWORD) function block', params: [
      { dir: 'Input', name: 'CU' }, { dir: 'Input', name: 'RESET' }, { dir: 'Input', name: 'PV' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'CV' },
    ]},
    { name: 'LCTD', desc: ' Down Counter (DWORD) function block', params: [
      { dir: 'Input', name: 'CD' }, { dir: 'Input', name: 'LOAD' }, { dir: 'Input', name: 'PV' },
      { dir: 'Output', name: 'Q' }, { dir: 'Output', name: 'CV' },
    ]},
    { name: 'LCTUD', desc: ' Up-Down Counter (DWORD) function block', params: [
      { dir: 'Input', name: 'CU' }, { dir: 'Input', name: 'CD' },
      { dir: 'Input', name: 'RESET' }, { dir: 'Input', name: 'LOAD' }, { dir: 'Input', name: 'PV' },
      { dir: 'Output', name: 'QU' }, { dir: 'Output', name: 'QD' }, { dir: 'Output', name: 'CV' },
    ]},
    { name: 'CONCAT', desc: ' String concatenation function', params: [
      { dir: 'Input', name: 'STR1' }, { dir: 'Input', name: 'STR2' },
    ]},
    { name: 'DELETE', desc: ' Delete characters from string', params: [
      { dir: 'Input', name: 'STR' }, { dir: 'Input', name: 'LEN' }, { dir: 'Input', name: 'POS' },
    ]},
    { name: 'FIND', desc: ' Find substring position function', params: [
      { dir: 'Input', name: 'STR1' }, { dir: 'Input', name: 'STR2' },
    ]},
    { name: 'INSERT', desc: ' Insert string into another string', params: [
      { dir: 'Input', name: 'STR1' }, { dir: 'Input', name: 'STR2' }, { dir: 'Input', name: 'POS' },
    ]},
    { name: 'LEFT', desc: ' Left substring extraction function', params: [
      { dir: 'Input', name: 'STR' }, { dir: 'Input', name: 'SIZE' },
    ]},
    { name: 'LEN', desc: ' String length calculation function', params: [
      { dir: 'Input', name: 'STR' },
    ]},
    { name: 'MID', desc: ' Middle substring extraction function', params: [
      { dir: 'Input', name: 'STR' }, { dir: 'Input', name: 'LEN' }, { dir: 'Input', name: 'POS' },
    ]},
    { name: 'REPLACE', desc: ' Replace characters in a string', params: [
      { dir: 'Input', name: 'STR1' }, { dir: 'Input', name: 'STR2' },
      { dir: 'Input', name: 'LEN' }, { dir: 'Input', name: 'POS' },
    ]},
    { name: 'RIGHT', desc: ' Right substring extraction function', params: [
      { dir: 'Input', name: 'STR' }, { dir: 'Input', name: 'SIZE' },
    ]},
    { name: 'LIMIT', desc: ' Limit value to a given range', params: [] },
    { name: 'MAX', desc: ' Maximum of two given values', params: [] },
    { name: 'MIN', desc: ' Minimum of two given values', params: [] },
    { name: 'MUX', desc: ' Multiplexer selects from inputs', params: [] },
    { name: 'SEL', desc: ' Binary selector from two values', params: [] },
  ];

  const NULL_UUID_IDX = 1;
  const GUID_START = 2;
  const MAX_GUID_IDX = GUID_START + pouDefs.length - 1; // 32
  const PARAM_START = MAX_GUID_IDX + 10; // 42
  // Name indices must be ABOVE paramEndIdx (400) to avoid collision with param blocks
  const NAME_START = 500;

  // Build string table entries
  const stEntries = [];
  stEntries.push([NULL_UUID_IDX, '00000000-0000-0000-0000-000000000000']);

  for (let i = 0; i < pouDefs.length; i++) {
    stEntries.push([GUID_START + i, `guid-pou-${i.toString().padStart(3, '0')}`]);
    stEntries.push([NAME_START + i, pouDefs[i].name]);
  }

  // Build param block entries in string table
  // POUs are sorted by guidIndex DESCENDING, so POU with guidIndex=32 (last in array, index 30)
  // maps to block[0], and POU with guidIndex=2 (first in array, index 0) maps to block[30].
  // We want F_TRIG (index 0, guidIndex=2) to get the correct param block.
  // Reverse: pouDefs[30] (SEL) → block[0], ..., pouDefs[0] (F_TRIG) → block[30]

  // So we need to build param blocks in REVERSE POU order
  let paramIdx = PARAM_START;
  const reversedPous = [...pouDefs].reverse();

  for (const pou of reversedPous) {
    // Block start marker
    stEntries.push([paramIdx++, "''DOCU"]);

    if (pou.desc) {
      stEntries.push([paramIdx++, pou.desc]);
    }

    // Build param entries
    let currentDir = null;
    for (const p of pou.params) {
      if (p.dir !== currentDir) {
        stEntries.push([paramIdx++, p.dir]);
        currentDir = p.dir;
      }
      if (p.comment) {
        stEntries.push([paramIdx++, p.comment]);
      }
      stEntries.push([paramIdx++, p.name]);
    }
  }

  // Ensure paramIdx doesn't exceed 400 (the paramEndIdx in the reader)
  // If it does, we need to adjust. Let's check.
  if (paramIdx > 400) {
    console.error(`WARNING: Tc2_Standard param entries extend to ${paramIdx}, exceeding 400 limit`);
  }

  const stringTableData = buildStringTable(stEntries);

  // Build .meta files
  const zipFiles = [];
  zipFiles.push({ name: 'projectinformations.auxiliary', data: buildProjectInfo('Tc2_Standard') });
  zipFiles.push({ name: '__shared_data_storage_string_table__.auxiliary', data: stringTableData });

  for (let i = 0; i < pouDefs.length; i++) {
    const guidIndex = GUID_START + i;
    const nameIndex = NAME_START + i;
    const metaData = buildMetaFile(guidIndex, NULL_UUID_IDX, nameIndex, 48);
    zipFiles.push({ name: `pou_${i}.meta`, data: metaData });
  }

  return buildZip(zipFiles);
}

// ---------------------------------------------------------------------------
// Tc3_JsonXml fixture
// ---------------------------------------------------------------------------

function generateTc3JsonXml() {
  const FB_METHODS = {
    'FB_JsonSaxWriter': [
      'AddKey', 'AddBool', 'AddInt', 'AddDint', 'AddReal', 'AddLreal',
      'AddString', 'AddRawString', 'AddNull', 'AddUdint', 'AddBase64',
      'StartObject', 'EndObject', 'StartArray', 'EndArray',
      'ResetDocument', 'GetDocument', 'GetDocumentLength',
    ],
    'FB_JsonDomParser': [
      'ParseDocument', 'GetDocumentLength', 'HasMember', 'GetBool',
      'GetInt', 'GetString', 'GetReal', 'GetType', 'CopyDocument',
    ],
    'FB_JsonSaxReader': [
      'ParseDocument', 'StartParsing', 'GetNextToken', 'GetTokenType',
      'GetTokenValue', 'GetTokenName', 'Reset', 'GetLastError',
    ],
    'FB_JsonDomParserBase': [
      // 52 methods
      'GetBool', 'GetInt', 'GetDint', 'GetLint', 'GetReal', 'GetLreal',
      'GetString', 'GetUint', 'GetUdint', 'GetUlint', 'GetByte', 'GetWord',
      'GetDword', 'GetLword', 'GetSint', 'GetUsint',
      'SetBool', 'SetInt', 'SetDint', 'SetLint', 'SetReal', 'SetLreal',
      'SetString', 'SetUint', 'SetUdint', 'SetUlint', 'SetByte', 'SetWord',
      'SetDword', 'SetLword', 'SetSint', 'SetUsint',
      'HasMember', 'GetMemberCount', 'GetMemberName', 'GetMemberValue',
      'GetType', 'IsNull', 'IsBool', 'IsNumber', 'IsString', 'IsArray',
      'IsObject', 'GetArraySize', 'GetArrayElement', 'AddMember',
      'RemoveMember', 'CopyFrom', 'GetPath', 'SetPath', 'GetRootNode',
      'ParseDocument', 'GetDocumentLength',
    ],
    'FB_JwtEncode': ['FB_init', 'FB_exit', 'Execute'],
    'FB_XmlDomParser': [
      'ParseDocument', 'GetRoot', 'GetFirstChild', 'GetNextSibling',
      'GetAttribute', 'GetNodeName', 'GetNodeValue',
    ],
    'FB_XmlSaxWriter': [
      'StartElement', 'EndElement', 'AddAttribute', 'AddContent',
      'GetDocument', 'ResetDocument',
    ],
  };

  // POUs that have no methods
  const SIMPLE_FBS = [
    'FB_JsonReadWriteDatatype',
    'ST_JsonElement',
    'ST_XmlAttribute',
  ];

  const allFBs = [...Object.keys(FB_METHODS), ...SIMPLE_FBS];

  const NULL_UUID_IDX = 1;
  const GUID_START = 2;
  // Name indices must be ABOVE paramEndIdx (400) to avoid collision with param blocks
  const NAME_START = 500;

  // Assign GUIDs for methods too
  let nextGuid = GUID_START + allFBs.length;
  const methodEntries = []; // {fbIdx, guidIndex, name}

  // Count total methods
  let totalMethodMeta = 0;
  for (const [fbName, methods] of Object.entries(FB_METHODS)) {
    const fbIdx = allFBs.indexOf(fbName);
    const fbGuidIndex = GUID_START + fbIdx;
    for (const methodName of methods) {
      methodEntries.push({ ownerGuidIndex: fbGuidIndex, guidIndex: nextGuid, name: methodName });
      nextGuid++;
      totalMethodMeta++;
    }
  }

  // Method name string table indices start after FB names
  const METHOD_NAME_START = NAME_START + allFBs.length;

  // Build string table entries
  const stEntries = [];
  stEntries.push([NULL_UUID_IDX, '00000000-0000-0000-0000-000000000000']);

  for (let i = 0; i < allFBs.length; i++) {
    stEntries.push([GUID_START + i, `guid-fb-${i.toString().padStart(3, '0')}`]);
    stEntries.push([NAME_START + i, allFBs[i]]);
  }

  for (let i = 0; i < methodEntries.length; i++) {
    stEntries.push([methodEntries[i].guidIndex, `guid-method-${i.toString().padStart(3, '0')}`]);
    stEntries.push([METHOD_NAME_START + i, methodEntries[i].name]);
  }

  // Param blocks for FBs (in reverse guidIndex order)
  const MAX_FB_GUID = GUID_START + allFBs.length - 1;
  // Actually max guid is from methods, but param detection uses maxGuidIdx from POUs only
  // extractCompiledSymbols: const maxGuidIdx = Math.max(...pous.map(p => p.guidIndex));
  // pous = entries where ownerGuidIndex === nullUuidIndex, so only FB entries
  const PARAM_START_IDX = MAX_FB_GUID + 10;
  let paramIdx = PARAM_START_IDX;

  // Build param blocks in reverse FB guid order (highest guid first = last FB)
  const reversedFBs = [...allFBs].reverse();
  for (const fbName of reversedFBs) {
    stEntries.push([paramIdx++, "''DOCU"]);
    stEntries.push([paramIdx++, ` ${fbName} function block description`]);
  }

  const stringTableData = buildStringTable(stEntries);

  // Build ZIP files
  const zipFiles = [];
  zipFiles.push({ name: 'projectinformations.auxiliary', data: buildProjectInfo('Tc3_JsonXml') });
  zipFiles.push({ name: '__shared_data_storage_string_table__.auxiliary', data: stringTableData });

  // FB .meta files (≥48 bytes, ownerGuidIndex = NULL_UUID_IDX)
  for (let i = 0; i < allFBs.length; i++) {
    const guidIndex = GUID_START + i;
    const nameIndex = NAME_START + i;
    const metaData = buildMetaFile(guidIndex, NULL_UUID_IDX, nameIndex, 48);
    zipFiles.push({ name: `fb_${i}.meta`, data: metaData });
  }

  // Method .meta files (40 bytes, ownerGuidIndex = parent FB guidIndex)
  for (let i = 0; i < methodEntries.length; i++) {
    const m = methodEntries[i];
    const nameIndex = METHOD_NAME_START + i;
    const metaData = buildMetaFile(m.guidIndex, m.ownerGuidIndex, nameIndex, 40);
    zipFiles.push({ name: `method_${i}.meta`, data: metaData });
  }

  return buildZip(zipFiles);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const FIXTURES_BASE = path.resolve(__dirname, '../tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/_Libraries/Beckhoff Automation GmbH');

const tc2Dir = path.join(FIXTURES_BASE, 'Tc2_Standard/3.4.5.0');
const tc3Dir = path.join(FIXTURES_BASE, 'Tc3_JsonXml/3.4.7.0');

fs.mkdirSync(tc2Dir, { recursive: true });
fs.mkdirSync(tc3Dir, { recursive: true });

const tc2Data = generateTc2Standard();
const tc2Path = path.join(tc2Dir, 'Tc2_Standard.compiled-library-ge33');
fs.writeFileSync(tc2Path, tc2Data);
console.log(`Written: ${tc2Path} (${tc2Data.length} bytes)`);

const tc3Data = generateTc3JsonXml();
const tc3Path = path.join(tc3Dir, 'Tc3_JsonXml.compiled-library-ge33');
fs.writeFileSync(tc3Path, tc3Data);
console.log(`Written: ${tc3Path} (${tc3Data.length} bytes)`);

console.log('Done.');
