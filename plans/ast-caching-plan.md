# Plan: AST Caching für Cross-File und Active-Document Performance

**Created:** 2026-03-02
**Status:** Ready for Atlas Execution

## Summary

Jeder LSP-Handler (Hover, Completion, References, Rename, etc.) parst das aktuelle Dokument bei jedem Request komplett neu. Cross-File-Features wie References und Rename umgehen zusätzlich den bestehenden `WorkspaceIndex.astCache` und lesen + parsen jede Workspace-Datei jedes Mal von Disk. Dieses Plan-Dokument beschreibt eine zweistufige Caching-Strategie: (1) Active-Document-Cache für wiederkehrende Single-File-Requests und (2) Erweiterung des WorkspaceIndex-Cache mit `ExtractionResult`, damit Cross-File-Handler den Cache nutzen können statt von Disk zu lesen.

## Context & Analysis

**Relevant Files:**
- `server/src/server.ts`: LSP Entry-Point — wires handler callbacks, calls `invalidateAst()` on edit. Muss den Active-Document-Cache verwalten.
- `server/src/twincat/workspaceIndex.ts`: `WorkspaceIndex` Klasse mit `astCache: Map<string, { ast, errors }>`, `getAst()`, `invalidateAst()`, `parseAndCache()`. Muss erweitert werden um `ExtractionResult` mitzucachen.
- `server/src/twincat/tcExtractor.ts`: `extractST()`, `extractStFromTwinCAT()`, `PositionMapper`, `ExtractionResult`. PositionMapper wird für Coordinate-Mapping benötigt.
- `server/src/handlers/references.ts`: Cross-File-Loop (L348–372) — liest jede Datei von Disk, extrahiert, parst. Nutzt `getAst()` NICHT.
- `server/src/handlers/rename.ts`: Cross-File-Loop (L331–354) — identisches Pattern wie references.ts, liest sogar jede Datei DOPPELT von Disk (einmal direkt, einmal über `mapperForUri`).
- `server/src/handlers/definition.ts`: Zwei Code-Pfade — `loadWorkspaceDeclarations()` (L105–127) nutzt `getAst()` korrekt, aber NameExpression-Pfad (L370–391) umgeht den Cache.
- `server/src/handlers/hover.ts`, `completion.ts`, `diagnostics.ts`, `codeActions.ts`, `codeLens.ts`, `foldingRange.ts`, `semanticTokens.ts`, `signatureHelp.ts`, `documentSymbols.ts`, `inlayHints.ts`: Alle parsen das Active Document bei jedem Request neu.

**Key Functions/Classes:**
- `WorkspaceIndex.getAst(uri)` → `{ ast, errors } | undefined` — reine Lookup, KEIN Parse bei Cache-Miss
- `WorkspaceIndex.invalidateAst(uri)` → Löscht Cache-Eintrag, repopuliert NICHT
- `WorkspaceIndex.parseAndCache(uri)` → Liest von Disk, extrahiert ST, parst, cacht NUR `{ ast, errors }` — wirft `ExtractionResult` weg
- `extractST(text, ext)` → `ExtractionResult { source, lineMap, sections, passthrough }`
- `extractStFromTwinCAT(path, text)` → `{ stCode, offsets }` — vereinfachte Bridge
- `PositionMapper(extraction)` → Coordinate-Mapping extracted↔original
- `mapperForUri(uri)` — 3× dupliziert in definition.ts, references.ts, rename.ts — liest jedes Mal von Disk

**Dependencies:**
- `vscode-languageserver` / `vscode-languageserver-textdocument`: `TextDocument` mit Versioning (`version` Property)
- `fs.readFileSync`: Verwendet in parseAndCache, allen mapperForUri-Helfern, Cross-File-Loops

**Patterns & Conventions:**
- Handler-Signatur: `handleXxx(params, document, workspaceIndex?)` — rein, keine Seiteneffekte
- Case-insensitive matching mit `.toUpperCase()`
- Tests: Vitest, Mock-WorkspaceIndex via Type-Cast, tmp-Verzeichnisse für Cross-File-Tests
- `ExtractionResult` enthält `passthrough: boolean` — bei `.st`-Dateien ist kein Mapping nötig

## Ist-Zustand Probleme

### Problem 1: Redundante Parses des Active Documents
Ein einzelner Tastendruck triggert `onDidChangeContent` → `validateDocument()` (1× Parse). Danach folgen oft sofort mehrere Handler-Requests (semantic tokens, code lens, inlay hints, folding), die ALLE denselben Text nochmal parsen. Bei einem typischen Edit-Zyklus werden **5–8 Parses** desselben Dokument-Texts ausgeführt.

### Problem 2: Cross-File-Handler umgehen den Cache
- `references.ts`: Iteriert ALLE Workspace-Files, liest jede von Disk via `fs.readFileSync`, extrahiert ST, parst → O(N) Disk-I/O + Parses pro Request
- `rename.ts`: Identisch, aber liest jede Datei DOPPELT (einmal im Loop, einmal in `mapperForUri`)
- `definition.ts` NameExpression-Pfad: Ebenfalls Disk + Parse statt Cache

### Problem 3: ExtractionResult nicht gecacht
`WorkspaceIndex.parseAndCache()` wirft die `ExtractionResult` weg. Handler die Position-Mapping brauchen (references, rename, definition) müssen trotzdem von Disk lesen, selbst wenn der AST gecacht ist.

### Problem 4: mapperForUri 3× dupliziert
Identische `mapperForUri`-Helper in `definition.ts` (L228), `references.ts` (L297), `rename.ts` (L275). Alle lesen von Disk.

## Implementation Phases

### Phase 1: Erweitere WorkspaceIndex Cache um ExtractionResult

**Objective:** Cache-Einträge um `ExtractionResult` erweitern, damit Handler den `PositionMapper` aus dem Cache erstellen können ohne Disk-I/O.

**Files to Modify:**
- `server/src/twincat/workspaceIndex.ts`: Cache-Typ erweitern, `parseAndCache()` anpassen, neue Methode `getExtraction(uri)` hinzufügen

**Steps:**

1. In `workspaceIndex.ts`: Cache-Typ von `{ ast: SourceFile; errors: ParseError[] }` zu `{ ast: SourceFile; errors: ParseError[]; extraction: ExtractionResult }` erweitern:
   ```typescript
   // Typ-Definition (kann als Interface top-level stehen)
   interface CachedParseResult {
     ast: SourceFile;
     errors: ParseError[];
     extraction: ExtractionResult;
   }
   private readonly astCache = new Map<string, CachedParseResult>();
   ```

2. `parseAndCache()` anpassen — `ExtractionResult` mitspeichern:
   ```typescript
   private parseAndCache(uri: string): void {
     try {
       const filePath = uriToPath(uri);
       const text = fs.readFileSync(filePath, 'utf-8');
       const ext = path.extname(filePath);
       const extraction = extractST(text, ext);
       const result = parse(extraction.source);
       this.astCache.set(uri, { ast: result.ast, errors: result.errors, extraction });
     } catch { /* skip */ }
   }
   ```

3. `getAst()` Return-Typ anpassen (bleibt abwärtskompatibel, Caller die nur `ast`/`errors` brauchen funktionieren weiterhin):
   ```typescript
   getAst(uri: string): CachedParseResult | undefined
   ```

4. Neue Methode `getExtraction(uri)` hinzufügen:
   ```typescript
   getExtraction(uri: string): ExtractionResult | undefined {
     const cached = this.astCache.get(this.normaliseUri(uri));
     return cached?.extraction;
   }
   ```

5. Optional: Private Helper `normaliseUri()` extrahieren (aktuell inline in `getAst` und `invalidateAst`).

**Tests to Write:**
- `workspaceIndex.test.ts`: Test dass `getAst()` nach `parseAndCache()` auch `extraction` enthält
- `workspaceIndex.test.ts`: Test dass `getExtraction()` einen `ExtractionResult` liefert für `.TcPOU` Dateien
- `workspaceIndex.test.ts`: Test dass `getExtraction()` bei `.st`-Dateien ein passthrough-ExtractionResult liefert

**Acceptance Criteria:**
- [ ] `astCache` speichert `ExtractionResult` neben `ast` und `errors`
- [ ] `getAst()` returns `{ ast, errors, extraction }`
- [ ] `getExtraction(uri)` Methode existiert
- [ ] Bestehende Tests pass (keine Breaking Changes)
- [ ] Neue Unit-Tests für ExtractionResult-Caching

---

### Phase 2: Shared `mapperForUri` Utility

**Objective:** Die 3× duplizierte `mapperForUri`-Funktion in eine shared Utility extrahieren, die den WorkspaceIndex-Cache bevorzugt und nur bei Cache-Miss von Disk liest.

**Files to Create:**
- `server/src/handlers/shared.ts`: Shared Utility-Modul für Handler

**Files to Modify:**
- `server/src/handlers/definition.ts`: `mapperForUri` durch shared import ersetzen
- `server/src/handlers/references.ts`: `mapperForUri` durch shared import ersetzen
- `server/src/handlers/rename.ts`: `mapperForUri` durch shared import ersetzen

**Steps:**

1. Neue Datei `server/src/handlers/shared.ts` erstellen:
   ```typescript
   import * as fs from 'fs';
   import * as path from 'path';
   import { extractST, PositionMapper, ExtractionResult } from '../twincat/tcExtractor';
   import { WorkspaceIndex } from '../twincat/workspaceIndex';

   /**
    * Returns a PositionMapper for a given file URI.
    * Tries the WorkspaceIndex cache first, falls back to disk read.
    */
   export function mapperForUri(
     uri: string,
     workspaceIndex?: WorkspaceIndex,
   ): PositionMapper {
     // Try cache first
     const cached = workspaceIndex?.getExtraction(uri);
     if (cached) return new PositionMapper(cached);

     // Fallback: read from disk
     const filePath = uri.startsWith('file://')
       ? decodeURIComponent(uri.replace(/^file:\/\//, ''))
       : uri;
     const text = fs.readFileSync(filePath, 'utf8');
     const ext = path.extname(filePath);
     return new PositionMapper(extractST(text, ext));
   }
   ```

2. In `definition.ts`: Lokale `mapperForUri` entfernen (L228–238), shared import nutzen, `workspaceIndex` mitgeben.

3. In `references.ts`: Lokale `mapperForUri` entfernen (L297–304), shared import nutzen.

4. In `rename.ts`: Lokale `mapperForUri` entfernen (L275–283), shared import nutzen.

**Tests to Write:**
- `server/src/__tests__/shared.test.ts`: Test dass `mapperForUri` ohne WorkspaceIndex von Disk liest
- `server/src/__tests__/shared.test.ts`: Test dass `mapperForUri` mit gecachtem ExtractionResult Cache bevorzugt

**Acceptance Criteria:**
- [ ] Kein duplizierter `mapperForUri`-Code mehr in definition/references/rename
- [ ] Shared function bevorzugt Cache, fällt auf Disk zurück
- [ ] Alle bestehenden Tests pass
- [ ] Neue Unit-Tests für shared `mapperForUri`

---

### Phase 3: Cross-File-Handler auf WorkspaceIndex-Cache umstellen

**Objective:** Die Cross-File-Loops in `references.ts`, `rename.ts` und `definition.ts` (NameExpression-Pfad) so umbauen, dass sie `workspaceIndex.getAst()` statt `fs.readFileSync + parse()` nutzen.

**Files to Modify:**
- `server/src/handlers/references.ts`: Cross-File-Loop (L348–372)
- `server/src/handlers/rename.ts`: Cross-File-Loop (L331–354)
- `server/src/handlers/definition.ts`: NameExpression Cross-File-Loop (L370–391)

**Steps:**

1. **references.ts** Cross-File-Loop refactoren:
   ```typescript
   // Vorher: fs.readFileSync + extractST + parse für JEDE Datei
   // Nachher:
   for (const fileUri of projectFiles) {
     if (fileUri === uri) continue;
     
     // Try cache first
     const cached = workspaceIndex.getAst(fileUri);
     let otherAst: SourceFile;
     let otherMapper: PositionMapper;
     
     if (cached) {
       otherAst = cached.ast;
       otherMapper = new PositionMapper(cached.extraction);
     } else {
       // Fallback: read from disk
       try {
         const filePath = fileUri.startsWith('file://') ? decodeURIComponent(fileUri.replace(/^file:\/\//, '')) : fileUri;
         const fileText = fs.readFileSync(filePath, 'utf8');
         const ext = path.extname(fileUri);
         const extraction = extractST(fileText, ext);
         otherMapper = new PositionMapper(extraction);
         otherAst = parse(extraction.source).ast;
       } catch { continue; }
     }
     
     const otherLocations = collectNameExpressions(otherAst, name, fileUri);
     locations.push(...otherLocations.map(loc => mapLocation(loc, otherMapper)));
   }
   ```

2. **rename.ts** Cross-File-Loop refactoren — identisches Pattern. **Eliminiert den doppelten Disk-Read** (aktuell wird jede Datei 2× gelesen). Nutze shared `mapperForUri` aus Phase 2.

3. **definition.ts** NameExpression-Pfad refactoren — versuche `getAst()` zuerst, falle auf Disk zurück:
   ```typescript
   for (const fileUri of projectFiles) {
     if (fileUri === uri) continue;
     
     let otherAst: SourceFile;
     const cached = workspaceIndex.getAst(fileUri);
     if (cached) {
       otherAst = cached.ast;
     } else {
       try {
         const filePath = /* ... */;
         const rawText = fs.readFileSync(filePath, 'utf8');
         const fileText = extractStFromTwinCAT(filePath, rawText).stCode;
         otherAst = parse(fileText).ast;
       } catch { continue; }
     }
     
     const otherMatch = findPouDeclaration(otherAst, name);
     if (otherMatch) return toLocation(fileUri, otherMatch, mapperForUri(fileUri, workspaceIndex));
   }
   ```

**Tests to Write:**
- `references.test.ts`: Bestehende Cross-File-Tests erweitern — verifyieren dass Results identisch sind mit und ohne Cache
- `rename.test.ts`: Bestehende Cross-File-Tests prüfen
- `definition.test.ts`: NameExpression Cross-File-Tests

**Acceptance Criteria:**
- [ ] references.ts nutzt `getAst()` für Cross-File-Search
- [ ] rename.ts nutzt `getAst()` und liest Dateien nicht mehr doppelt
- [ ] definition.ts NameExpression-Pfad nutzt `getAst()`
- [ ] Alle Handler fallen graceful auf Disk-Read zurück bei Cache-Miss
- [ ] Alle bestehenden Tests pass
- [ ] Cross-File-Handler-Tests laufen korrekt

---

### Phase 4: Active-Document-Cache in server.ts

**Objective:** Einen Version-basierten Cache für das aktiv editierte Dokument einführen, sodass mehrere Handler-Requests für denselben Dokument-Stand nicht redundant parsen.

**Files to Modify:**
- `server/src/server.ts`: Cache-Map einführen, Handler-Aufrufe anpassen
- Alle Handler in `server/src/handlers/`: Die Signatur ist optional erweiterbar, oder der Cache wird in server.ts aufgelöst und das ParseResult wird direkt übergeben

**Design-Entscheidung — Option A (empfohlen): Cache in server.ts, Handler erhalten ParseResult:**

Der Cache lebt in `server.ts` und wrappet die Handler-Aufrufe. Eine neue Utility-Funktion `getOrParseDocument()` wird eingeführt:

```typescript
// In server.ts:
interface DocumentCache {
  version: number;
  extraction: ExtractionResult;
  parseResult: ParseResult;
  mapper: PositionMapper;
}
const documentCache = new Map<string, DocumentCache>();

function getOrParseDocument(doc: TextDocument): DocumentCache {
  const uri = doc.uri;
  const existing = documentCache.get(uri);
  if (existing && existing.version === doc.version) return existing;
  
  const ext = path.extname(uri);
  const extraction = extractST(doc.getText(), ext);
  const mapper = new PositionMapper(extraction);
  const parseResult = parse(extraction.source);
  const entry = { version: doc.version, extraction, parseResult, mapper };
  documentCache.set(uri, entry);
  return entry;
}
```

Invalidierung:
```typescript
documents.onDidChangeContent(change => {
  documentCache.delete(change.document.uri);  // Version-Change → Cache löschen
  workspaceIndex?.invalidateAst(change.document.uri);
  validateDocument(connection, change.document, workspaceIndex);
});

documents.onDidClose(event => {
  documentCache.delete(event.document.uri);
});
```

**Option B (Alternative): Cache in Handlern:**
Jeder Handler prüft selbst einen shared Cache. Nachteil: Mehr Boilerplate, inkonsistentere Implementierung.

**Empfehlung: Option A** — zentraler Cache in server.ts, Handler werden schrittweise refactored um das gecachte ParseResult entgegenzunehmen.

**Migration-Strategie für Handler:**
Die Handler können schrittweise migriert werden. Da alle Handler derzeit `document: TextDocument` empfangen und intern parsen, gibt es zwei Ansätze:

**Approach 1 (minimal-invasiv):** Einen neuen optionalen Parameter `cachedParse?: DocumentCache` zu jedem Handler hinzufügen. Wenn vorhanden, wird er genutzt statt neu zu parsen. Wenn nicht, wird intern wie bisher geparst (Abwärtskompatibilität für Tests).

**Approach 2 (sauber):** Die Handler erhalten statt `TextDocument` direkt `{ ast, extraction, mapper }` und tun kein Parsing mehr. Erfordert mehr Refactoring, ist aber langfristig sauberer.

**Empfehlung: Approach 1** — weniger disruptiv, Tests brauchen minimale Änderungen.

**Steps:**

1. In `server.ts`: `DocumentCache` Interface und `documentCache` Map einführen
2. `getOrParseDocument()` Funktion implementieren
3. Cache-Invalidierung in `onDidChangeContent` und `onDidClose` einbauen
4. Handler nacheinander migrieren — exemplarisch `hover.ts` als erstes:
   - Optionalen `cachedParse` Parameter hinzufügen
   - Wenn vorhanden: `ast = cachedParse.parseResult.ast`, `mapper = cachedParse.mapper`
   - Wenn nicht: wie bisher parsen (Test-Kompatibilität)
5. In `server.ts` bei jedem Handler-Callback: `const cached = getOrParseDocument(doc)` aufrufen und mitgeben
6. Übrige Handler migrieren (completion, definition, references, rename, diagnostics, semanticTokens, foldingRange, codeLens, codeActions, signatureHelp, documentSymbols, inlayHints)

**Tests to Write:**
- `server/src/__tests__/documentCache.test.ts`: Unit-Tests für `getOrParseDocument()` — Version-Check, Cache-Hit/Miss, Invalidierung
- Bestehende Handler-Tests bleiben unverändert (optionaler Parameter = abwärtskompatibel)

**Acceptance Criteria:**
- [ ] `getOrParseDocument()` cacht Parse-Ergebnis pro Dokument-URI und -Version
- [ ] Cache wird auf `onDidChangeContent` und `onDidClose` invalidiert
- [ ] Alle Handler nutzen den Cache (optionaler Parameter)
- [ ] Bestehende Tests pass ohne Änderung
- [ ] Neue Unit-Tests für den DocumentCache
- [ ] Kein redundantes Parsing bei multiplen Handler-Requests für denselben Dokument-Stand

---

### Phase 5: Cache-Repopulation bei Invalidierung

**Objective:** Nach `invalidateAst()` den WorkspaceIndex-Cache wieder befüllen, wenn ein Dokument über den LSP-TextDocuments-Manager verfügbar ist (= offenes Dokument). Aktuell bleibt der Cache leer bis zum nächsten Projekt-Rescan.

**Files to Modify:**
- `server/src/twincat/workspaceIndex.ts`: Neue Methode `updateAst(uri, ast, errors, extraction)`
- `server/src/server.ts`: Nach jedem Parse des aktiven Dokuments den WorkspaceIndex-Cache aktualisieren

**Steps:**

1. Neue Methode `updateAst()` in WorkspaceIndex:
   ```typescript
   updateAst(uri: string, ast: SourceFile, errors: ParseError[], extraction: ExtractionResult): void {
     const normalised = this.normaliseUri(uri);
     if (this.allSourceUris.has(normalised)) {
       this.astCache.set(normalised, { ast, errors, extraction });
     }
   }
   ```
   Nur für URIs die im Projekt bekannt sind (kein Cache-Pollution durch fremde Dateien).

2. In `server.ts` bei `onDidChangeContent`: Nach dem Parse (in `validateDocument` oder via `getOrParseDocument`) den WorkspaceIndex aktualisieren:
   ```typescript
   documents.onDidChangeContent(change => {
     const doc = change.document;
     const cached = getOrParseDocument(doc);
     workspaceIndex?.updateAst(doc.uri, cached.parseResult.ast, cached.parseResult.errors, cached.extraction);
     validateDocument(connection, doc, workspaceIndex);
   });
   ```

**Tests to Write:**
- `workspaceIndex.test.ts`: Test dass `updateAst()` den Cache-Eintrag setzt
- `workspaceIndex.test.ts`: Test dass `updateAst()` nur für bekannte URIs cached (ignoriert unbekannte)
- `workspaceIndex.test.ts`: Test dass `getAst()` nach `updateAst()` das aktualisierte Ergebnis liefert

**Acceptance Criteria:**
- [ ] `updateAst()` Methode existiert auf WorkspaceIndex
- [ ] Nur bekannte Projekt-URIs werden gecacht
- [ ] Active Document wird nach Edit sofort im WorkspaceIndex-Cache aktualisiert
- [ ] Cross-File-Handler sehen das aktuelle Dokument immer mit aktuellem Stand
- [ ] Tests pass

---

## Open Questions

1. **Memory-Overhead durch ExtractionResult-Caching?**
   - **Option A:** Volle `ExtractionResult` cachen (inkl. `lineMap`, `sections`). Overhead ~1KB pro Datei.
   - **Option B:** Nur `OffsetMap` (vereinfacht) cachen. Reicht für `PositionMapper`.
   - **Empfehlung:** Option A — der Overhead ist minimal, und `PositionMapper` benötigt die volle `ExtractionResult`. Bei `.st`-Dateien (passthrough) ist die `ExtractionResult` ohnehin trivial.

2. **Soll `getAst()` bei Cache-Miss automatisch parsen (lazy)?**
   - **Option A:** Nein, wie bisher — Caller muss Fallback handhaben.
   - **Option B:** Ja, `getAst()` lädt bei Miss automatisch von Disk.
   - **Empfehlung:** Option A — der Caller-Fallback ist bereits implementiert (in `loadWorkspaceDeclarations`), und lazy Parsing könnte unerwartete Disk-I/O in Handlern verursachen. Außerdem könnte die Disk-Version veraltet sein wenn das Dokument im Editor offen ist.

3. **Debouncing für `validateDocument`?**
   - Aktuell wird bei jedem Keystroke sofort `validateDocument` aufgerufen. Ein Debounce (200ms) würde die Last weiter reduzieren.
   - **Empfehlung:** Out of scope für diesen Plan — kann separat implementiert werden. Der Document-Cache aus Phase 4 entschärft das Problem bereits, da mehrere schnelle Requests denselben Cache-Hit bekommen.

## Risks & Mitigation

- **Risk:** Cache-Inkonsistenz — Dokument wird editiert aber Cross-File-Cache zeigt veralteten Stand
  - **Mitigation:** Phase 5 stellt sicher, dass `updateAst()` nach jedem Edit aufgerufen wird. `onDidChangeContent` ist das kanonische Event für LSP-Dokument-Änderungen. Für nicht-offene Dateien (nur auf Disk geändert) greift der bestehende Projekt-Watcher.

- **Risk:** Memory-Leak durch unbegrenztes Caching
  - **Mitigation:** Der `astCache` wird bereits heute durch `rebuildAllSources()` aufgeräumt (stale Einträge werden gelöscht). Der `documentCache` wird auf `onDidClose` geleert. Zusätzlich könnte eine LRU-Strategie eingeführt werden — aber erst wenn Projekte mit 1000+ Dateien getestet werden.

- **Risk:** Breaking Changes an Handler-Signaturen
  - **Mitigation:** Optionaler Parameter-Ansatz (Approach 1 in Phase 4) hält alle bestehenden Tests am Laufen. Migration ist inkrementell möglich.

- **Risk:** Position-Mapping-Fehler nach Cache-Erweiterung
  - **Mitigation:** Die `PositionMapper` wird aus derselben `ExtractionResult` erstellt, die auch zum Parse geführt hat — die Konsistenz ist garantiert. Bestehende Tests für references/rename/definition verifizieren die korrekten Positionen.

## Success Criteria

- [ ] WorkspaceIndex cached `ExtractionResult` neben AST und Errors
- [ ] Cross-File-Handler (references, rename, definition) nutzen den Cache statt Disk-I/O
- [ ] Active Document wird nicht redundant geparst (1× pro Version statt 5–8×)
- [ ] `mapperForUri` ist dedupliziert in einer shared Utility
- [ ] WorkspaceIndex-Cache wird bei Active-Document-Edits sofort aktualisiert
- [ ] Alle bestehenden Tests pass
- [ ] Neue Unit-Tests für Cache-Mechanismen
- [ ] Keine Memory-Leaks (Cache-Einträge werden aufgeräumt)

## Notes for Atlas

- **Reihenfolge ist wichtig:** Phase 1 → 2 → 3 → 4 → 5. Jede Phase baut auf der vorherigen auf.
- **Phase 1 ist das Fundament** — ohne gecachte `ExtractionResult` können die Cross-File-Handler den Cache nicht effektiv nutzen (sie brauchen den `PositionMapper`).
- **Phase 4 ist die größte** — 14 Handler müssen migriert werden. Aber jeder Handler ist eine isolierte Änderung. Bei Zeitdruck können die Handler priorisiert werden: `diagnostics.ts` und `references.ts` zuerst (höchste Last), dann der Rest.
- **`extractST` vs `extractStFromTwinCAT`:** Im WorkspaceIndex wird aktuell `extractStFromTwinCAT` aufgerufen (das intern `extractST` nutzt). Phase 1 sollte direkt `extractST` nutzen, da wir die volle `ExtractionResult` brauchen, nicht die vereinfachte `{ stCode, offsets }` Form.
- **Tests:** Das Projekt nutzt Vitest. Handler-Tests erzeugen `TextDocument` via `TextDocument.create()` und Mock-WorkspaceIndex via Type-Cast. Cross-File-Tests schreiben temporäre Dateien auf Disk.
- **CLAUDE.md Constraint:** "Do not add an AST cache without benchmarking evidence" — diese Regel bezieht sich auf unnötige Optimierung. Hier ist der Cache direkt motiviert durch Cross-File-Features (references, rename brauchen ASTs aller Workspace-Files) und die bestehende Cache-Infrastruktur im WorkspaceIndex wird lediglich vervollständigt und konsequent genutzt.
