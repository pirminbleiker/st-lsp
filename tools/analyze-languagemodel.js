#!/usr/bin/env node
/**
 * Deep analysis of __languagemodel.auxiliary which likely contains
 * the full POU signature catalog for compiled TwinCAT libraries.
 *
 * Also: look at string table entries 450+ for more clues.
 * Also: scan meta files more carefully for the SignatureId (string[445]).
 */
'use strict';

const zlib = require('zlib');
const fs = require('fs');

function findEocd(b) { for(let i=b.length-22;i>=0;i--) if(b.readUInt32LE(i)===0x06054b50)return i; return -1; }
function readZipEntries(b) {
  const eocd=findEocd(b); if(eocd<0)return [];
  const n=b.readUInt16LE(eocd+10),cd=b.readUInt32LE(eocd+16);
  const entries=[]; let p=cd;
  for(let i=0;i<n;i++){
    if(p+46>b.length||b.readUInt32LE(p)!==0x02014b50)break;
    const method=b.readUInt16LE(p+10),cs=b.readUInt32LE(p+20);
    const us=b.readUInt32LE(p+24),fl=b.readUInt16LE(p+28);
    const el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32);
    const lo=b.readUInt32LE(p+42);
    const fn=b.slice(p+46,p+46+fl).toString('utf8');
    entries.push({filename:fn,method,cs,us,lo}); p+=46+fl+el+cl;
  }
  return entries;
}
function readEntry(b,e) {
  const lh=e.lo;
  if(lh+30>b.length||b.readUInt32LE(lh)!==0x04034b50)return Buffer.alloc(0);
  const fl=b.readUInt16LE(lh+26),el=b.readUInt16LE(lh+28),ds=lh+30+fl+el;
  const cd=b.slice(ds,ds+e.cs);
  if(e.method===0)return cd;
  if(e.method===8){try{return zlib.inflateRawSync(cd);}catch{return Buffer.alloc(0);}}
  return Buffer.alloc(0);
}
function readVarint(buf,off){
  let v=0,s=0;
  while(off<buf.length){ const b=buf[off++]; v|=(b&0x7f)<<s; if(!(b&0x80))break; s+=7; }
  return {value:v,offset:off};
}
function decodeStringTable(data) {
  const map=new Map(); if(!data.length)return map;
  let p=0;
  const r0=readVarint(data,p); p=r0.offset;
  for(let i=0;i<r0.value&&p<data.length;i++){
    const ri=readVarint(data,p); p=ri.offset;
    const rl=readVarint(data,p); p=rl.offset;
    if(p+rl.value>data.length)break;
    map.set(ri.value, data.slice(p,p+rl.value).toString('utf8'));
    p+=rl.value;
  }
  return map;
}

function hexDump(buf,maxBytes=64,base=0){
  const lines=[];
  for(let i=0;i<Math.min(buf.length,maxBytes);i+=16){
    const chunk=buf.slice(i,i+16);
    const hex=[...chunk].map(b=>b.toString(16).padStart(2,'0')).join(' ');
    const asc=[...chunk].map(b=>(b>=0x20&&b<=0x7e)?String.fromCharCode(b):'.').join('');
    lines.push(`  ${(base+i).toString(16).padStart(6,'0')}  ${hex.padEnd(48)}  ${asc}`);
  }
  return lines.join('\n');
}

const filePath = process.argv[2];
const buf = fs.readFileSync(filePath);
const entries = readZipEntries(buf);

const stEntry = entries.find(e=>e.filename==='__shared_data_storage_string_table__.auxiliary');
const stData = stEntry ? readEntry(buf,stEntry) : Buffer.alloc(0);
const strings = decodeStringTable(stData);

// Show string table entries 450-595
console.log('=== String table entries 450+ ===\n');
const sortedKeys = [...strings.keys()].sort((a,b)=>a-b);
for (const k of sortedKeys) {
  if (k >= 450) {
    console.log(`  [${k.toString().padStart(5)}] ${JSON.stringify(strings.get(k))}`);
  }
}

// Analyze __languagemodel.auxiliary
console.log('\n\n=== __languagemodel.auxiliary ===\n');
const lmEntry = entries.find(e=>e.filename==='__languagemodel.auxiliary');
if (lmEntry) {
  const data = readEntry(buf, lmEntry);
  console.log(`Size: ${data.length} bytes\n`);

  // Try to interpret as a sequence of length-prefixed items
  // Check for various magic numbers
  console.log('First 32 bytes:');
  console.log(hexDump(data, 32));

  // Check if it starts with META_MAGIC
  if (data.length >= 4) {
    console.log(`First DWORD: 0x${data.readUInt32LE(0).toString(16)}`);
    if (data.readUInt32LE(0) === 0x28092002) console.log('  --> META_MAGIC!');
  }

  // Try to decode as varints referencing string table
  console.log('\nFirst 100 varints:');
  let p = 0;
  let nonzero = 0;
  for (let i = 0; i < 100 && p < data.length; i++) {
    const before = p;
    const r = readVarint(data, p);
    if (r.offset === before) break;
    const str = strings.get(r.value);
    const s = str !== undefined ? `  → "${str}"` : '';
    console.log(`  [${i.toString().padStart(3)}] @${before.toString(16).padStart(4,'0')} = ${r.value.toString().padStart(8)}${s}`);
    p = r.offset;
    if (r.value !== 0) nonzero++;
  }

  // Look for recognizable patterns: ST keywords
  console.log('\nSearching for ST-related bytes in languagemodel:');
  // Look for "BOOL" in ASCII bytes
  const lmStr = data.toString('latin1');
  const patterns = ['TON', 'TOF', 'CTU', 'BOOL', 'TIME', 'Input', 'Output'];
  for (const p of patterns) {
    const idx = lmStr.indexOf(p);
    if (idx >= 0) {
      console.log(`  Found "${p}" at offset 0x${idx.toString(16)}`);
      console.log(hexDump(data.slice(Math.max(0,idx-4), idx+20), 40, Math.max(0,idx-4)));
    }
  }

  // Look for BMP magic
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0x42 && data[i+1] === 0x4d) {
      console.log(`  BMP at offset 0x${i.toString(16)}`);
      break;
    }
  }

  // Try to decode structure: uint16 count + items
  if (data.length >= 4) {
    const count = data.readUInt16LE(0);
    console.log(`\nIf starts with uint16 count: ${count} items`);
    // Check second uint16
    const c2 = data.readUInt16LE(2);
    console.log(`Second uint16: ${c2}`);
  }

  // Scan for sequences of identical fixed-size records
  // A "record" might start with a specific byte pattern
  // Let's look for POU name strings encoded with length prefix
  console.log('\nLooking for length-prefixed strings in languagemodel:');
  const found = [];
  for (let i = 0; i < data.length - 4; i++) {
    const len = data[i];
    if (len < 2 || len > 40 || i + 1 + len > data.length) continue;
    let ok = true;
    for (let j = 0; j < len; j++) {
      const c = data[i + 1 + j];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    const s = data.slice(i+1, i+1+len).toString('ascii');
    if (/^[A-Z_][A-Z0-9_]*$/.test(s)) {
      found.push({offset: i, str: s});
    }
  }
  console.log(`Found ${found.length} uppercase identifier strings:`);
  for (const f of found.slice(0, 50)) {
    console.log(`  @${f.offset.toString(16).padStart(4,'0')} "${f.str}"`);
  }
}

// Check the large object file for SignatureId info
console.log('\n\n=== Large .object file (root) - search for SignatureId patterns ===');
const objEntries = entries.filter(e=>e.filename.endsWith('.object'));
const rootObj = objEntries.sort((a,b)=>b.us-a.us)[0];
const rootData = readEntry(buf, rootObj);
console.log(`Root obj: ${rootObj.filename}, ${rootData.length} bytes`);

// Find SignatureId references in the XML
const bomIdx = rootData.indexOf(Buffer.from([0xff, 0xfe]));
if (bomIdx >= 0) {
  const xml = rootData.slice(bomIdx).toString('utf16le');
  const patterns = ['SignatureId', 'VariableId', 'ScopeId', 'TypeGuid', 'Name'];
  for (const p of patterns) {
    const idx = xml.indexOf(p);
    if (idx >= 0) {
      console.log(`\nFound "${p}" at char ${idx}:`);
      console.log(xml.slice(Math.max(0,idx-20), idx+100).replace(/\n/g,'\\n'));
    }
  }
}
