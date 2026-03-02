/**
 * TwinCAT XML source extractor.
 *
 * Extracts Structured Text (ST) source code from TwinCAT 3 XML file formats:
 *   .TcPOU  – Function blocks, programs, functions (Declaration + Implementation)
 *   .TcGVL  – Global variable lists (Declaration only)
 *   .TcDUT  – Data unit types / type definitions (Declaration only)
 *   .TcIO   – Interfaces (.TcIO) (Declaration only)
 *   .st     – Plain ST files (pass-through, no extraction)
 *
 * For each extracted file the module builds a line-number map so that the LSP
 * can translate positions in the *extracted* source back to positions in the
 * *original* XML file for diagnostics, hover info, etc.
 */

import * as path from 'path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExtractedSection {
  /** Whether this section holds declarations, executable code, or an action body. */
  kind: 'declaration' | 'implementation' | 'action';
  /** The raw ST text from this section (no surrounding XML). */
  content: string;
  /**
   * 0-based line in the *original* file where this section's first content
   * line begins.
   */
  startLine: number;
  /**
   * 0-based character offset within `startLine` where this section's content
   * begins. This is 0 when the CDATA opens on its own line, or > 0 when the
   * ST content starts on the same line as `<![CDATA[`.
   */
  startChar: number;
  /**
   * 0-based line in the *extracted* source where this section's first content
   * line appears.
   */
  extractedStartLine: number;
  /** Action name — only present when kind === 'action'. */
  actionName?: string;
}

// ---------------------------------------------------------------------------
// XmlRange — matches the shape of vscode-languageserver-types Range
// ---------------------------------------------------------------------------

/** A character-level range in an XML source file (0-based line/character). */
export interface XmlRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface ExtractionResult {
  /**
   * Combined ST source ready for the lexer/parser.
   * For files that have both a Declaration and an Implementation the two are
   * joined with a single newline.
   */
  source: string;
  /**
   * Maps each 0-based line index in `source` to the corresponding 0-based
   * line index in the original file.
   *
   * lineMap[n] = original file line for extracted line n
   */
  lineMap: number[];
  /** Individual sections in the order they were extracted. */
  sections: ExtractedSection[];
  /**
   * True when the file was treated as plain ST with no XML extraction.
   * In this case source === original content and lineMap[n] === n.
   */
  passthrough: boolean;
  /**
   * The name of the container element (POU, GVL, DUT, etc.) as found in the
   * XML `Name` attribute.  Undefined for passthrough (.st) files.
   */
  containerName?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CDATA_OPEN = '<![CDATA[';
const CDATA_OPEN_LEN = CDATA_OPEN.length; // 9
const CDATA_CLOSE = ']]>';

/** Return the 0-based line number at character position `pos` in `str`. */
function lineAtPos(str: string, pos: number): number {
  let line = 0;
  for (let i = 0; i < pos; i++) {
    if (str[i] === '\n') line++;
  }
  return line;
}

interface RawCData {
  content: string;
  kind: 'declaration' | 'implementation' | 'action';
  /** 0-based line in the original file where the first line of content lives. */
  startLine: number;
  /** 0-based character offset within startLine where content begins. */
  startChar: number;
  /** For action sections: the name from the <Action Name="..."> attribute. */
  actionName?: string;
  /** For action sections: line of the synthetic ACTION header in the original file. */
  headerLine?: number;
}

interface RawMethodData {
  /** Method name from XML Name attribute. */
  nameAttr: string;
  /** Declaration CDATA — starts with "METHOD [modifier] MethodName". */
  decl: RawCData;
  /** Implementation CDATA (body statements); null when no <Implementation> element. */
  impl: RawCData | null;
  /** 0-based line of the </Method> closing tag in the original XML file. */
  endTagLine: number;
}

interface RawPropertyData {
  /** Property name from XML Name attribute. */
  nameAttr: string;
  /** Property header declaration CDATA — "PROPERTY [modifier] Name : Type". */
  decl: RawCData;
  /** Get accessor local variable declaration CDATA (VAR...END_VAR); null if absent. */
  getDecl: RawCData | null;
  /** Get accessor body CDATA; null if absent. */
  getImpl: RawCData | null;
  /** Set accessor local variable declaration CDATA (VAR...END_VAR); null if absent. */
  setDecl: RawCData | null;
  /** Set accessor body CDATA; null if absent. */
  setImpl: RawCData | null;
  /** 0-based line of the </Property> closing tag in the original XML file. */
  endTagLine: number;
}

interface TopLevelExtractionData {
  topDecl: RawCData | null;
  topImpl: RawCData | null;
  methods: RawMethodData[];
  properties: RawPropertyData[];
  actions: RawCData[];
  containerName?: string;
}

/**
 * Find the first top-level Declaration CDATA and the first Implementation/ST
 * CDATA within `xml`.
 *
 * We intentionally ignore nested CDATAs (e.g., inside <Method> children) and
 * only capture the POU/GVL/DUT/Itf top-level sections.  The strategy is:
 *
 *  1. Find the outermost element tag (<POU>, <GVL>, <DUT>, <Itf>).
 *  2. Within that element, find the first <Declaration> and the first
 *     <Implementation> (which wraps a <ST> element).
 *
 * Because the XML is machine-generated by TwinCAT we can rely on its
 * predictable structure and use regex matching instead of a full XML parser.
 */
function extractTopLevelCDATAs(xml: string): TopLevelExtractionData {
  const empty: TopLevelExtractionData = { topDecl: null, topImpl: null, methods: [], properties: [], actions: [] };

  // Find the top-level container element: <POU…>, <GVL…>, <DUT…>, or <Itf…>.
  const containerRe = /<(POU|GVL|DUT|Itf)\b[^>]*>/i;
  const containerMatch = containerRe.exec(xml);
  if (!containerMatch) return empty;

  // Extract the Name attribute from the container opening tag.
  const nameMatch = /\bName="([^"]+)"/i.exec(containerMatch[0]);
  const containerName = nameMatch ? nameMatch[1] : undefined;

  const containerStart = containerMatch.index;
  const containerTagName = containerMatch[1];

  // Find the closing tag for this container element.
  const closingTag = `</${containerTagName}>`;
  const containerEnd = xml.indexOf(closingTag, containerStart);
  const body = containerEnd === -1
    ? xml.slice(containerStart)
    : xml.slice(containerStart, containerEnd + closingTag.length);

  // Top-level Declaration CDATA (first direct child only).
  const topDecl = extractFirstChildCData(xml, body, containerStart, 'Declaration', 'declaration');

  // Top-level Implementation > ST CDATA.
  const topImpl = extractImplementationCData(xml, body, containerStart);

  // For POU containers, also extract Method, Property and Action children.
  // ITF containers also have Methods and Properties but not Actions.
  const isPOU = containerTagName.toUpperCase() === 'POU';
  const isItf = containerTagName.toUpperCase() === 'ITF';
  const hasMembers = isPOU || isItf;
  const methods = hasMembers ? extractMethodCDATAs(xml, body, containerStart) : [];
  const properties = hasMembers ? extractPropertyCDATAs(xml, body, containerStart) : [];
  const actions = isPOU ? extractActionCDATAs(xml, body, containerStart) : [];

  return { topDecl, topImpl, methods, properties, actions, containerName };
}

/**
 * Extract the CDATA content from the first direct-child `<tagName>` element
 * within `body`.  `bodyOffsetInXml` is the character offset of `body` within
 * the full `xml` string (used for accurate line counting).
 */
function extractFirstChildCData(
  xml: string,
  body: string,
  bodyOffsetInXml: number,
  tagName: string,
  kind: 'declaration' | 'implementation',
): RawCData | null {
  // Match the first occurrence of <tagName(…)>…</tagName>
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = tagRe.exec(body);
  if (!m) return null;

  const innerContent = m[1];
  const cdataIdx = innerContent.indexOf(CDATA_OPEN);
  if (cdataIdx === -1) return null;

  const cdataCloseIdx = innerContent.indexOf(CDATA_CLOSE, cdataIdx + CDATA_OPEN_LEN);
  if (cdataCloseIdx === -1) return null; // malformed – CDATA not closed

  // Raw content between <![CDATA[ and ]]>
  let raw = innerContent.slice(cdataIdx + CDATA_OPEN_LEN, cdataCloseIdx);

  // Position of the first character *after* <![CDATA[ in the full xml string.
  const contentPosInXml =
    bodyOffsetInXml +
    m.index +
    m[0].indexOf(CDATA_OPEN) +
    CDATA_OPEN_LEN;

  // Determine startLine: if the character right after <![CDATA[ is a newline
  // the content begins on the following line.
  let startLine = lineAtPos(xml, contentPosInXml);

  // Determine startChar: walk backwards from contentPosInXml to find the line start.
  let lineStartPos = contentPosInXml;
  while (lineStartPos > 0 && xml[lineStartPos - 1] !== '\n') lineStartPos--;
  let startChar = contentPosInXml - lineStartPos;

  if (raw.startsWith('\n')) {
    startLine += 1;
    raw = raw.slice(1); // strip leading newline
    startChar = 0;      // content now begins at start of the next line
  }

  // Strip a single trailing newline (TwinCAT often writes `…\n]]>`)
  if (raw.endsWith('\n')) {
    raw = raw.slice(0, -1);
  }

  return { content: raw, kind, startLine, startChar };
}

/**
 * Extract the CDATA content from `<Implementation><ST><![CDATA[…]]></ST></Implementation>`.
 */
function extractImplementationCData(
  xml: string,
  body: string,
  bodyOffsetInXml: number,
): RawCData | null {
  // Find the first <Implementation> block in body.
  const implRe = /<Implementation\b[^>]*>([\s\S]*?)<\/Implementation>/i;
  const implMatch = implRe.exec(body);
  if (!implMatch) return null;

  const implInner = implMatch[1];
  const implOffsetInXml = bodyOffsetInXml + implMatch.index;
  // bodyOffsetInXml for implInner must point to implInner[0] in xml, i.e. the character
  // immediately after the <Implementation...> closing '>'.  Without this correction,
  // startLine lands on the <Implementation> XML line instead of the <ST><![CDATA[...> line
  // when the CDATA content begins on the same line as <![CDATA[ (no leading newline).
  const implTagLen = implMatch[0].indexOf('>') + 1;

  // Within Implementation, find <ST>…</ST>
  return extractFirstChildCData(xml, implInner, implOffsetInXml + implTagLen, 'ST', 'implementation');
}

/**
 * Extract all <Action Name="..."> implementation CDATAs from a POU body.
 * Each action has only an <Implementation><ST> section (no <Declaration>).
 */
function extractActionCDATAs(
  xml: string,
  body: string,
  bodyOffsetInXml: number,
): RawCData[] {
  const results: RawCData[] = [];

  // Match all <Action ... Name="ActionName" ...> opening tags in the body.
  const actionTagRe = /<Action\b([^>]*)>/gi;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = actionTagRe.exec(body)) !== null) {
    const attrStr = tagMatch[1];
    const nameMatch = /\bName="([^"]+)"/i.exec(attrStr);
    if (!nameMatch) continue;

    const actionName = nameMatch[1];
    const actionTagPosInXml = bodyOffsetInXml + tagMatch.index;
    const headerLine = lineAtPos(xml, actionTagPosInXml);

    // Find the content between <Action ...> and </Action>.
    const actionBodyStart = tagMatch.index + tagMatch[0].length;
    const actionCloseTag = '</Action>';
    const actionCloseIdx = body.indexOf(actionCloseTag, actionBodyStart);
    const actionBodyText = actionCloseIdx === -1
      ? body.slice(actionBodyStart)
      : body.slice(actionBodyStart, actionCloseIdx);

    // Extract Implementation > ST CDATA from the action body.
    const implCData = extractImplementationCData(
      xml,
      actionBodyText,
      bodyOffsetInXml + actionBodyStart,
    );
    if (!implCData) continue;

    results.push({
      ...implCData,
      kind: 'action',
      actionName,
      headerLine,
    });
  }

  return results;
}

/**
 * Extract all <Property Name="..."> CDATAs from a POU body.
 * For each property, extracts the header Declaration plus optional Get/Set accessor CDATAs.
 */
function extractPropertyCDATAs(
  xml: string,
  body: string,
  bodyOffsetInXml: number,
): RawPropertyData[] {
  const results: RawPropertyData[] = [];

  const propTagRe = /<Property\b([^>]*)>/gi;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = propTagRe.exec(body)) !== null) {
    const attrStr = tagMatch[1];
    const nameMatch = /\bName="([^"]+)"/i.exec(attrStr);
    if (!nameMatch) continue;

    const propName = nameMatch[1];

    // Content between <Property ...> and </Property>
    const propBodyStart = tagMatch.index + tagMatch[0].length;
    const propCloseTag = '</Property>';
    const propCloseIdx = body.indexOf(propCloseTag, propBodyStart);
    const propBodyText = propCloseIdx === -1
      ? body.slice(propBodyStart)
      : body.slice(propBodyStart, propCloseIdx);

    const propBodyOffsetInXml = bodyOffsetInXml + propBodyStart;

    // Property header declaration ("PROPERTY PUBLIC Name : Type")
    const declCData = extractFirstChildCData(xml, propBodyText, propBodyOffsetInXml, 'Declaration', 'declaration');
    if (!declCData) continue;

    // Get accessor
    let getDecl: RawCData | null = null;
    let getImpl: RawCData | null = null;
    const getTagRe = /<Get\b([^>]*)>([\s\S]*?)<\/Get>/i;
    const getMatch = getTagRe.exec(propBodyText);
    if (getMatch) {
      const getBodyStart = getMatch.index + getMatch[0].indexOf('>') + 1;
      const getBodyText = getMatch[2];
      const getBodyOffsetInXml = propBodyOffsetInXml + getBodyStart;
      getDecl = extractFirstChildCData(xml, getBodyText, getBodyOffsetInXml, 'Declaration', 'declaration');
      getImpl = extractImplementationCData(xml, getBodyText, getBodyOffsetInXml);
    }

    // Set accessor
    let setDecl: RawCData | null = null;
    let setImpl: RawCData | null = null;
    const setTagRe = /<Set\b([^>]*)>([\s\S]*?)<\/Set>/i;
    const setMatch = setTagRe.exec(propBodyText);
    if (setMatch) {
      const setBodyStart = setMatch.index + setMatch[0].indexOf('>') + 1;
      const setBodyText = setMatch[2];
      const setBodyOffsetInXml = propBodyOffsetInXml + setBodyStart;
      setDecl = extractFirstChildCData(xml, setBodyText, setBodyOffsetInXml, 'Declaration', 'declaration');
      setImpl = extractImplementationCData(xml, setBodyText, setBodyOffsetInXml);
    }

    // Line of the </Property> closing tag
    const endTagPosInXml = propCloseIdx === -1
      ? xml.length - 1
      : bodyOffsetInXml + propCloseIdx;
    const endTagLine = lineAtPos(xml, endTagPosInXml);

    results.push({
      nameAttr: propName,
      decl: declCData,
      getDecl,
      getImpl,
      setDecl,
      setImpl,
      endTagLine,
    });
  }

  return results;
}

/**
 * Extract all <Method Name="..."> CDATAs (Declaration + Implementation) from a POU body.
 */
function extractMethodCDATAs(
  xml: string,
  body: string,
  bodyOffsetInXml: number,
): RawMethodData[] {
  const results: RawMethodData[] = [];

  const methodTagRe = /<Method\b([^>]*)>/gi;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = methodTagRe.exec(body)) !== null) {
    const attrStr = tagMatch[1];
    const nameMatch = /\bName="([^"]+)"/i.exec(attrStr);
    if (!nameMatch) continue;

    const methodName = nameMatch[1];

    // Content between <Method ...> and </Method>
    const methodBodyStart = tagMatch.index + tagMatch[0].length;
    const methodCloseTag = '</Method>';
    const methodCloseIdx = body.indexOf(methodCloseTag, methodBodyStart);
    const methodBodyText = methodCloseIdx === -1
      ? body.slice(methodBodyStart)
      : body.slice(methodBodyStart, methodCloseIdx);

    const methodBodyOffsetInXml = bodyOffsetInXml + methodBodyStart;

    const declCData = extractFirstChildCData(xml, methodBodyText, methodBodyOffsetInXml, 'Declaration', 'declaration');
    if (!declCData) continue; // skip methods without Declaration CDATA

    const implCData = extractImplementationCData(xml, methodBodyText, methodBodyOffsetInXml);

    // Line of the </Method> closing tag
    const endTagPosInXml = methodCloseIdx === -1
      ? xml.length - 1
      : bodyOffsetInXml + methodCloseIdx;
    const endTagLine = lineAtPos(xml, endTagPosInXml);

    results.push({
      nameAttr: methodName,
      decl: declCData,
      impl: implCData,
      endTagLine,
    });
  }

  return results;
}

/**
 * Build an ExtractionResult from structured top-level extraction data.
 */
function buildResult(data: TopLevelExtractionData): ExtractionResult {
  const { topDecl, topImpl, methods, properties, actions, containerName } = data;

  if (!topDecl && !topImpl && methods.length === 0 && properties.length === 0 && actions.length === 0) {
    return { source: '', lineMap: [], sections: [], passthrough: false, containerName };
  }

  const sections: ExtractedSection[] = [];
  const sourceParts: string[] = [];
  const lineMap: number[] = [];

  function pushContent(rawCData: RawCData, kind: ExtractedSection['kind']): void {
    const extractedStartLine = lineMap.length;
    const lines = rawCData.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      lineMap.push(rawCData.startLine + i);
    }
    sourceParts.push(rawCData.content);
    sections.push({
      kind,
      content: rawCData.content,
      startLine: rawCData.startLine,
      startChar: rawCData.startChar,
      extractedStartLine,
      actionName: rawCData.actionName,
    });
  }

  // Top-level declaration (FB/POU/GVL header + VAR blocks)
  if (topDecl) {
    pushContent(topDecl, 'declaration');
  }

  // Top-level implementation body (often empty for class-style FBs — skip if empty)
  if (topImpl && topImpl.content.trim() !== '') {
    const sepLine = topImpl.startLine > 0 ? topImpl.startLine - 1 : topImpl.startLine;
    lineMap.push(sepLine);
    sourceParts.push('');
    pushContent(topImpl, 'implementation');
  }

  // Methods: each contributes Declaration CDATA, optional Implementation CDATA,
  // and a synthetic END_METHOD line.
  for (const m of methods) {
    // Blank separator line before method (mapped to the line before the decl CDATA)
    const sepLine = m.decl.startLine > 0 ? m.decl.startLine - 1 : m.decl.startLine;
    lineMap.push(sepLine);
    sourceParts.push('');

    // Method declaration (already contains "METHOD [modifier] Name" header)
    pushContent(m.decl, 'declaration');

    // Method implementation (body statements)
    if (m.impl && m.impl.content.trim() !== '') {
      pushContent(m.impl, 'implementation');
    }

    // Synthetic END_METHOD — mapped to the </Method> tag line
    lineMap.push(m.endTagLine);
    sourceParts.push('END_METHOD');
  }

  // Properties: each contributes the header Declaration, optional Get/Set VAR blocks
  // and body statements, and a synthetic END_PROPERTY line.
  for (const p of properties) {
    const sepLine = p.decl.startLine > 0 ? p.decl.startLine - 1 : p.decl.startLine;
    lineMap.push(sepLine);
    sourceParts.push('');

    // Property header ("PROPERTY PUBLIC Name : Type")
    pushContent(p.decl, 'declaration');

    // Get accessor VAR block
    if (p.getDecl && p.getDecl.content.trim() !== '') {
      pushContent(p.getDecl, 'declaration');
    }

    // Get accessor body
    if (p.getImpl && p.getImpl.content.trim() !== '') {
      pushContent(p.getImpl, 'implementation');
    }

    // Set accessor VAR block
    if (p.setDecl && p.setDecl.content.trim() !== '') {
      pushContent(p.setDecl, 'declaration');
    }

    // Set accessor body
    if (p.setImpl && p.setImpl.content.trim() !== '') {
      pushContent(p.setImpl, 'implementation');
    }

    // Synthetic END_PROPERTY — mapped to the </Property> tag line
    lineMap.push(p.endTagLine);
    sourceParts.push('END_PROPERTY');
  }

  // Synthetic POU closer — always emitted for TwinCAT XML files because the
  // Declaration CDATA never contains the closing keyword (the XML tag structure
  // defines the boundary). The keyword depends on POU type so the parser can
  // correctly finish the declaration without reporting a spurious error.
  const pouKind = (() => {
    if (!topDecl) return null;
    const m = /^[ \t]*(FUNCTION_BLOCK|FUNCTION|PROGRAM|INTERFACE)\b/im.exec(topDecl.content);
    return m ? m[1].toUpperCase() : null;
  })();
  if (pouKind) {
    const closerOrigLine = lineMap.length > 0 ? lineMap[lineMap.length - 1] : 0;
    lineMap.push(closerOrigLine);
    sourceParts.push(`END_${pouKind}`);
  }

  // Actions (appended after END_FUNCTION_BLOCK when methods exist, or directly
  // after the FB body for POU files without methods — the parser handles both).
  for (const c of actions) {
    // Blank separator line before action
    const sepLine = c.startLine > 0 ? c.startLine - 1 : c.startLine;
    lineMap.push(sepLine);
    sourceParts.push('');

    // Synthetic ACTION <name>: header
    const hdrLine = c.headerLine ?? (c.startLine > 0 ? c.startLine - 1 : c.startLine);
    lineMap.push(hdrLine);
    sourceParts.push(`ACTION ${c.actionName}:`);

    const extractedStartLine = lineMap.length;
    const lines = c.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      lineMap.push(c.startLine + i);
    }
    sourceParts.push(c.content);

    // Synthetic END_ACTION footer
    lineMap.push(c.startLine + lines.length);
    sourceParts.push('END_ACTION');

    sections.push({
      kind: 'action',
      content: c.content,
      startLine: c.startLine,
      startChar: c.startChar,
      extractedStartLine,
      actionName: c.actionName,
    });
  }

  return {
    source: sourceParts.join('\n'),
    lineMap,
    sections,
    passthrough: false,
    containerName,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * File extensions that require XML extraction.
 * All comparisons are done case-insensitively.
 */
const XML_EXTENSIONS = new Set(['.tcpou', '.tcgvl', '.tcdut', '.tcio', '.tctask']);

/**
 * Return all character-level ranges in `text` that lie *outside* CDATA
 * section content.  These ranges cover the XML wrapper (including the
 * `<![CDATA[` and `]]>` markers themselves).
 *
 * Each XmlRange uses 0-based line/character positions compatible with the
 * vscode-languageserver-types `Range` interface.
 *
 * Callers should only invoke this for files whose extension is in
 * `XML_EXTENSIONS`.
 */
export function getXmlRanges(text: string): XmlRange[] {
  const result: XmlRange[] = [];

  /** Convert a character offset in `text` to a {line, character} position. */
  function posToLocation(offset: number): { line: number; character: number } {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset; i++) {
      if (text[i] === '\n') {
        line++;
        lineStart = i + 1;
      }
    }
    return { line, character: offset - lineStart };
  }

  let xmlStart = 0; // start (inclusive) of the current XML wrapper region
  let pos = 0;

  while (pos < text.length) {
    const cdataOpen = text.indexOf(CDATA_OPEN, pos);
    if (cdataOpen === -1) break;

    const cdataContentStart = cdataOpen + CDATA_OPEN_LEN; // first char of CDATA content
    const cdataClose = text.indexOf(CDATA_CLOSE, cdataContentStart);
    if (cdataClose === -1) break; // malformed

    // XML wrapper region: from xmlStart up to (and including) '<![CDATA['
    if (cdataContentStart > xmlStart) {
      result.push({ start: posToLocation(xmlStart), end: posToLocation(cdataContentStart) });
    }

    // After the CDATA content, the XML wrapper resumes at ']]>'
    xmlStart = cdataClose; // ']]>' is part of the XML wrapper
    pos = cdataClose + CDATA_CLOSE.length;
  }

  // Final XML wrapper region: from the last ']]>' to the end of the file
  if (xmlStart < text.length) {
    result.push({ start: posToLocation(xmlStart), end: posToLocation(text.length) });
  }

  return result;
}



/**
 * Extract ST source from a TwinCAT file.
 *
 * @param content   The raw file content (UTF-8 text).
 * @param ext       The file extension, e.g. `.TcPOU` or `.st`.
 *                  Case-insensitive; the leading dot is required.
 * @returns         An ExtractionResult with the extracted source and line map.
 */
export function extractST(content: string, ext: string): ExtractionResult {
  const normalised = ext.toLowerCase();

  // Plain ST files pass through untouched.
  if (!XML_EXTENSIONS.has(normalised)) {
    if (content === '') {
      return { source: '', lineMap: [], sections: [], passthrough: true };
    }
    const lines = content.split('\n');
    return {
      source: content,
      lineMap: lines.map((_, i) => i),
      sections: [],
      passthrough: true,
    };
  }

  const data = extractTopLevelCDATAs(content);
  return buildResult(data);
}

// ---------------------------------------------------------------------------
// PositionMapper
// ---------------------------------------------------------------------------

/**
 * Bidirectional position mapper for TcPOU/TcGVL/TcDUT/TcIO files.
 * Converts between original-file positions (as seen by the editor/LSP client)
 * and extracted-source positions (as used by the parser and AST).
 *
 * For passthrough (.st) files, this is a no-op mapper.
 */
export class PositionMapper {
  private readonly lineMap: number[];
  private readonly sections: ExtractedSection[];
  private readonly passthrough: boolean;

  constructor(result: ExtractionResult) {
    this.lineMap = result.lineMap;
    this.sections = result.sections;
    this.passthrough = result.passthrough;
  }

  /**
   * Convert an extracted-source position to an original-file position.
   * Always returns a valid position (falls back to identity if out of range).
   */
  extractedToOriginal(line: number, char: number): { line: number; character: number } {
    if (this.passthrough) return { line, character: char };
    if (line < 0 || line >= this.lineMap.length) return { line, character: char };

    const originalLine = this.lineMap[line];

    // If this is the first line of a section with inline startChar, add the offset.
    const section = this.sections.find(s => s.extractedStartLine === line && s.startChar > 0);
    const originalChar = section ? char + section.startChar : char;

    return { line: originalLine, character: originalChar };
  }

  /**
   * Convert an original-file position to an extracted-source position.
   * Returns null if the original position is on an XML-only line (outside any CDATA section).
   */
  originalToExtracted(line: number, char: number): { line: number; character: number } | null {
    if (this.passthrough) return { line, character: char };

    for (const section of this.sections) {
      const lineCount = section.content === '' ? 1 : section.content.split('\n').length;
      if (line >= section.startLine && line < section.startLine + lineCount) {
        const lineOffset = line - section.startLine;
        const extractedLine = section.extractedStartLine + lineOffset;

        // For the first line of an inline CDATA section, subtract the inline offset.
        const extractedChar = (lineOffset === 0 && section.startChar > 0)
          ? Math.max(0, char - section.startChar)
          : char;

        return { line: extractedLine, character: extractedChar };
      }
    }

    // Original line is not in any CDATA section → XML-only line
    return null;
  }
}

// ---------------------------------------------------------------------------
// Compatibility exports (for projectReader.ts)
// ---------------------------------------------------------------------------

/**
 * Mapping from extracted code line (0-based) to original source line (0-based).
 */
export type OffsetMap = Record<number, number>;

/**
 * Extract ST code from a TwinCAT source file, returning a legacy-compatible
 * result shape used by projectReader.ts.
 *
 * Prefer `extractST` for new code.
 */
export function extractStFromTwinCAT(
  filePath: string,
  fileContent: string,
): { stCode: string; offsets: OffsetMap } {
  const ext = path.extname(filePath);
  const result = extractST(fileContent, ext);
  const offsets: OffsetMap = {};
  result.lineMap.forEach((originalLine, extractedLine) => {
    offsets[extractedLine] = originalLine;
  });
  return { stCode: result.source, offsets };
}
