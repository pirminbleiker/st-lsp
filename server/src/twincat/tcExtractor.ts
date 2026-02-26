/**
 * TwinCAT 3 ST code extractor stub.
 *
 * TODO: Replace with tcExtractor implementation (sl-adf4)
 * This module provides stub interfaces and functions for extracting Structured Text
 * code from TwinCAT project files.
 */

/**
 * Represents a mapping of byte offsets in the extracted code.
 * Used to map between extracted ST and original source locations.
 *
 * TODO: Replace with tcExtractor implementation (sl-adf4)
 */
export interface OffsetMap {
  /** Mapping from extracted code line to original source information */
  [key: number]: any;
}

/**
 * Extracts Structured Text (ST) code from a TwinCAT source file.
 *
 * Handles various TwinCAT source formats (.st, .TcPOU, .TcGVL, .TcDUT, .TcIO)
 * and extracts the pure ST code content, maintaining offset information for
 * mapping back to original file locations.
 *
 * @param filePath - The path to the TwinCAT source file
 * @param fileContent - The raw content of the file
 * @returns Extracted ST code and offset mapping information
 *
 * TODO: Replace with tcExtractor implementation (sl-adf4)
 */
export function extractStFromTwinCAT(
  filePath: string,
  fileContent: string,
): { stCode: string; offsets: OffsetMap } {
  // Stub implementation: return content as-is with empty offset map
  // TODO: Replace with tcExtractor implementation (sl-adf4)
  return {
    stCode: fileContent,
    offsets: {},
  };
}

/**
 * Parses TwinCAT XML wrapper and extracts embedded ST code.
 *
 * TODO: Replace with tcExtractor implementation (sl-adf4)
 */
export function extractFromXmlWrapper(xmlContent: string): string {
  // Stub implementation: attempt basic XML extraction
  // TODO: Replace with tcExtractor implementation (sl-adf4)
  const match = xmlContent.match(/<CompileUnit[^>]*>([\s\S]*?)<\/CompileUnit>/i);
  return match ? match[1] : xmlContent;
}

/**
 * Determines if a file requires ST extraction (not plain .st format).
 *
 * TODO: Replace with tcExtractor implementation (sl-adf4)
 */
export function requiresExtraction(filePath: string): boolean {
  // Stub implementation: check file extension
  // TODO: Replace with tcExtractor implementation (sl-adf4)
  const ext = filePath.toLowerCase();
  return (
    ext.endsWith('.tcpou') ||
    ext.endsWith('.tcgvl') ||
    ext.endsWith('.tcdut') ||
    ext.endsWith('.tcio') ||
    ext.endsWith('.tctask')
  );
}
