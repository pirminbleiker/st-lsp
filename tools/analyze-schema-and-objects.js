#!/usr/bin/env node
/**
 * Deep analysis:
 * 1. Decode the schema table to understand the serialization format
 * 2. Parse each POU's .object file using the schema
 * 3. Map varint indices to string table entries for parameter extraction
 */
'use strict';

const zlib = require('zlib');
const fs = require('fs');

function findEocd(b) {
  for (let i=b.length-22;i>=0;i--)
    if(b.readUInt32LE(i)===0x06054b50)return i;
  return -1;
}
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
function readEntry(b, e) {
  const lh=e.lo;
  if(lh+30>b.length||b.readUInt32LE(lh)!==0x04034b50)return Buffer.alloc(0);
  const fl=b.readUInt16LE(lh+26),el=b.readUInt16LE(lh+28),ds=lh+30+fl+el;
  const cd=b.slice(ds,ds+e.cs);
  if(e.method===0)return cd;
  if(e.method===8){try{return zlib.inflateRawSync(cd);}catch{return Buffer.alloc(0);}}
  return Buffer.alloc(0);
}
function readVarint(buf, off) {
  let v=0,s=0;
  while(off<buf.length){
    const b=buf[off++]; v|=(b&0x7f)<<s; if(!(b&0x80))break; s+=7;
  }
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

function hexDump(buf, maxBytes=64, base=0) {
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

// Schema table analysis
console.log('=== Schema Table (__shared_data_storage_schema_table__.auxiliary) ===\n');
const schEntry = entries.find(e=>e.filename==='__shared_data_storage_schema_table__.auxiliary');
if (schEntry) {
  const data = readEntry(buf, schEntry);
  console.log(`Size: ${data.length} bytes\n`);
  // Read schema: varint count, then pairs (idx, typeInfo)
  let p = 0;
  const r0 = readVarint(data, p); p = r0.offset;
  console.log(`Schema element count: ${r0.value}`);
  for (let i = 0; i < r0.value && p < data.length; i++) {
    const before = p;
    const ri = readVarint(data, p); p = ri.offset;
    const rt = readVarint(data, p); p = rt.offset;
    const str = strings.get(ri.value);
    console.log(`  [${i.toString().padStart(3)}] idx=${ri.value.toString().padStart(5)} type=${rt.value.toString().padStart(4)}  ${str ? `"${str}"` : ''}`);
  }
}

// POU object files: decode each .object file for known POUs
console.log('\n\n=== POU .object files (detailed) ===');
const META_MAGIC = 0x28092002;
const metaEntries = entries.filter(e=>e.filename.endsWith('.meta'));
const objEntries = entries.filter(e=>e.filename.endsWith('.object'));

// Get UUID → name map from meta files
const uuidToName = new Map();
for (const me of metaEntries) {
  const data = readEntry(buf, me);
  if (data.length < 20 || data.readUInt32LE(0) !== META_MAGIC) continue;
  let pos = 20;
  const hvs = [];
  for (let i=0;i<7&&pos<data.length;i++) {
    const r = readVarint(data, pos); hvs.push(r.value); pos = r.offset;
  }
  const name = strings.get(hvs[4]);
  const selfUuid = strings.get(hvs[2]);
  if (name && selfUuid) uuidToName.set(selfUuid, name);
}

// Now decode each object file
const TARGET = new Set(['TON','TOF','TP','CTU','CTD','CTUD','RS','SR','R_TRIG','F_TRIG','LTP','LTON','LTOF']);
for (const oe of objEntries) {
  const uuid = oe.filename.slice(0, 36);
  const name = uuidToName.get(uuid);
  if (!name || !TARGET.has(name)) continue;

  const data = readEntry(buf, oe);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${name} (${oe.filename.slice(0,8)}.object, ${data.length} bytes)`);
  console.log(hexDump(data, data.length));

  // Try to decode as META format
  if (data.length >= 20 && data.readUInt32LE(0) === META_MAGIC) {
    const payloadSize = data.readUInt32LE(16);
    console.log(`  META_MAGIC header, payload=${payloadSize}`);
    let p = 20;
    const vs = [];
    while (p < data.length && vs.length < 100) {
      const before = p;
      const r = readVarint(data, p);
      if (r.offset === before) break;
      vs.push({value: r.value, offset: before, str: strings.get(r.value)});
      p = r.offset;
    }
    console.log(`  Varints (${vs.length}):`);
    vs.forEach((v, i) => {
      const s = v.str !== undefined ? `  → "${v.str}"` : '';
      console.log(`    [${i.toString().padStart(2)}] @${v.offset.toString(16).padStart(4,'0')} = ${v.value.toString().padStart(8)}${s}`);
    });
  }
}
