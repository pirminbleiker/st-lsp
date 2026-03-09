# [1.7.0](https://github.com/pirminbleiker/st-lsp/compare/v1.6.0...v1.7.0) (2026-03-09)


### Bug Fixes

* distinguish FUNCTION from FUNCTION_BLOCK in compiled libraries (#sl-d3a) ([#1](https://github.com/pirminbleiker/st-lsp/issues/1)) ([db3795d](https://github.com/pirminbleiker/st-lsp/commit/db3795d6f634ee3467307c7ce9d4e4c392891fb1)), closes [#sl-d3a](https://github.com/pirminbleiker/st-lsp/issues/sl-d3a)


### Features

* **signatureHelp:** show all parameter directions, optional status, return types, and library methods (#sl-p6f) ([#4](https://github.com/pirminbleiker/st-lsp/issues/4)) ([b70fb69](https://github.com/pirminbleiker/st-lsp/commit/b70fb69ec2c49249f62d53163593426f2a3d86a8)), closes [#sl-p6f](https://github.com/pirminbleiker/st-lsp/issues/sl-p6f)

# [1.6.0](https://github.com/pirminbleiker/st-lsp/compare/v1.5.0...v1.6.0) (2026-03-09)


### Features

* resolve compiled libraries from TwinCAT installation path (#sl-ait) ([74ebbb4](https://github.com/pirminbleiker/st-lsp/commit/74ebbb40b70128bb0e85d08db748b2875b368884)), closes [#sl-ait](https://github.com/pirminbleiker/st-lsp/issues/sl-ait)

# [1.5.0](https://github.com/pirminbleiker/st-lsp/compare/v1.4.0...v1.5.0) (2026-03-09)


### Bug Fixes

* **hover:** convert inner function declaration to arrow function ([9a2951d](https://github.com/pirminbleiker/st-lsp/commit/9a2951d88a0c326b5b8afe2d751991a9e519f46a))


### Features

* **completion,hover:** resolve __SYSTEM.* qualified member access (#sl-nip) ([50b2792](https://github.com/pirminbleiker/st-lsp/commit/50b279260d2f7bba73abfdaac79429b6d438592d)), closes [#sl-nip](https://github.com/pirminbleiker/st-lsp/issues/sl-nip)
* **completion:** offer POINTER TO and REFERENCE TO as compound keywords (#sl-bpa) ([827834b](https://github.com/pirminbleiker/st-lsp/commit/827834b455c5af31dfc77dee91953617106b0efd)), closes [#sl-bpa](https://github.com/pirminbleiker/st-lsp/issues/sl-bpa)

# [1.4.0](https://github.com/pirminbleiker/st-lsp/compare/v1.3.0...v1.4.0) (2026-03-09)


### Features

* **index:** filter library indexing by plcproj libraryRefs (#sl-cl1) ([d986c5e](https://github.com/pirminbleiker/st-lsp/commit/d986c5e1f5885e49395f3b71382b7465f8d8fb3e)), closes [#sl-cl1](https://github.com/pirminbleiker/st-lsp/issues/sl-cl1)

# [1.3.0](https://github.com/pirminbleiker/st-lsp/compare/v1.2.0...v1.3.0) (2026-03-09)


### Features

* **lexer:** make POINTER and REFERENCE proper keywords (#sl-cxa) ([50647e0](https://github.com/pirminbleiker/st-lsp/commit/50647e0d249e1292ff4c1eea2b6d063ad99eb076)), closes [#sl-cxa](https://github.com/pirminbleiker/st-lsp/issues/sl-cxa)

# [1.2.0](https://github.com/pirminbleiker/st-lsp/compare/v1.1.4...v1.2.0) (2026-03-09)


### Bug Fixes

* build server bundle so serverStartup test passes; add SJSONVALUE type ([2fbe8d0](https://github.com/pirminbleiker/st-lsp/commit/2fbe8d0339712c9f242343a6fef14a39c8c5059a))
* **diagnostics:** allow trailing semicolons after control structures like END_IF ([7c150c1](https://github.com/pirminbleiker/st-lsp/commit/7c150c16a3f839265ffe7b9349a1174558cbdf68))
* **diagnostics:** downgrade undefined identifier errors to warnings ([95b840b](https://github.com/pirminbleiker/st-lsp/commit/95b840b0ee691440530355dc1c1eeb3f1dde0b9b))
* **diagnostics:** downgrade unresolvable EXTENDS to Warning + suppress inherited member errors ([354c227](https://github.com/pirminbleiker/st-lsp/commit/354c227423466129cb98f8b4473c80c5b56959ef))
* **extractor:** correct startLine for inline CDATA in method implementations ([57d9cae](https://github.com/pirminbleiker/st-lsp/commit/57d9cae665a8755052b13bffaa832509e31a2c57))
* **lint:** use const for non-reassigned count variable ([2c486d9](https://github.com/pirminbleiker/st-lsp/commit/2c486d91827641c366a944b23938634d9d0460c7))
* **test:** add compiled library fixtures and fix test paths ([73a2b19](https://github.com/pirminbleiker/st-lsp/commit/73a2b1979b26f1cbd5adbdde05f4d4cf2c397592))
* **test:** add Dictionary.TcPOU fixture to repo for CI ([523ea44](https://github.com/pirminbleiker/st-lsp/commit/523ea4416824105a2ccf8b6dc78c8e9df8099e38))
* **test:** add Dictionary.TcPOU fixture to repo for CI (#sl-oao) ([33a5586](https://github.com/pirminbleiker/st-lsp/commit/33a55867e84a19664b7f65370d2b240ea2bf1ae2)), closes [#sl-oao](https://github.com/pirminbleiker/st-lsp/issues/sl-oao)
* **test:** prevent serverStartup.test.ts 15s timeout ([24f9391](https://github.com/pirminbleiker/st-lsp/commit/24f9391b1433854d201175c6decb7b54cebef0d1))
* **tests:** lazy-generate compiled library fixtures before test runs ([499215d](https://github.com/pirminbleiker/st-lsp/commit/499215d7b249998ec3e37ebf34596c36bd941bad))


### Features

* add virtual structured text view for TcPOU files ([82b3f6f](https://github.com/pirminbleiker/st-lsp/commit/82b3f6f3273c16b819eb2ad41f166c4c9c106da1))
* **completion:** add isMemberVisible helper and filter external dot-access ([2ad9ee7](https://github.com/pirminbleiker/st-lsp/commit/2ad9ee751ae5e714e083be76f0c5a76d3e9a1e3c))
* **completion:** add unqualified local completion for own methods/properties/actions ([9c3f413](https://github.com/pirminbleiker/st-lsp/commit/9c3f413127393629d64e975a3708f8591b9ed043))
* **completion:** fix THIS^ and SUPER^ completion with inheritance + visibility ([f747640](https://github.com/pirminbleiker/st-lsp/commit/f747640ea3f74bc70ff36a4d842a01056c622b2d))
* implement compound logical operators AND_THEN and OR_ELSE ([e67b480](https://github.com/pirminbleiker/st-lsp/commit/e67b480cf3fa3f6bcfd04d64cd7a795f6840570e))
* implement phase 1 of false-positive LSP error fixes ([5bc7bb2](https://github.com/pirminbleiker/st-lsp/commit/5bc7bb2f4f1659a6496c9ca7e534d7f7f601fd26))
* implement phases 2 and 3 of false-positive LSP error fixes (bd-1ba, bd-2b4) ([7e94c30](https://github.com/pirminbleiker/st-lsp/commit/7e94c3086af722770c68609b9a89d15646b447a8))
* implement phases 4 and 5 of false-positive LSP error fixes (bd-37h, bd-27c) ([4639163](https://github.com/pirminbleiker/st-lsp/commit/4639163c6d01b370a4fdd14f481699bdee5afe46))
* implement phases 5 to 9 of false-positive LSP error fixes ([fb2724a](https://github.com/pirminbleiker/st-lsp/commit/fb2724a571504a507e3d548609cf8a91ebba0299))
* **lsp:** repopulate WorkspaceIndex cache on document change ([993e139](https://github.com/pirminbleiker/st-lsp/commit/993e1398d0e48939224ddb66331b27979ebfbdf1))
* **lsp:** surface extracted types in hover and completion ([0229a0f](https://github.com/pirminbleiker/st-lsp/commit/0229a0f118f531b83c277bdc0f76adf5ac7703b0))
* **parser:** introduce AST visitor pattern to eliminate switch-on-kind duplication (sl-2ht) ([049992a](https://github.com/pirminbleiker/st-lsp/commit/049992a088e23181fb96bf05806cfc108fbc814f))
* **plans:** add detailed plans for extracting data types and improving completion visibility ([b98ee40](https://github.com/pirminbleiker/st-lsp/commit/b98ee40d4478cd891bc7fac1aaa0fd0ce61eff44))
* **syntax:** add TextMate grammar for bracket scoping in strings ([d118d29](https://github.com/pirminbleiker/st-lsp/commit/d118d29212803302cbcf7941c565a70e8c67bf2d))
* **tests:** add reference counting tests for CodeLens ([e28c984](https://github.com/pirminbleiker/st-lsp/commit/e28c9845dd9c8ca2c607b63b707aec4ef6d5a3fe))
* **tools:** add analyze-type-varints.js for type correlation research ([b217704](https://github.com/pirminbleiker/st-lsp/commit/b2177048f2be8bb212e362a38eeb45f87d371ede))
* **twincat:** add system types and intrinsics catalog ([24bc6a5](https://github.com/pirminbleiker/st-lsp/commit/24bc6a58244b0f43832765f25bc8e1e10e711422))
* **twincat:** add type registry for compiled library parameter types ([7a7e6c5](https://github.com/pirminbleiker/st-lsp/commit/7a7e6c57f655ae6c897b45760051141ae0ca6219))

## [1.1.4](https://github.com/pirminbleiker/st-lsp/compare/v1.1.3...v1.1.4) (2026-02-28)


### Bug Fixes

* **test:** wrap serverStartup proc in try/finally and increase timeout (sl-7pf8) ([f0b9255](https://github.com/pirminbleiker/st-lsp/commit/f0b92552b48aefc32d2d0707c5ada39335eaeaec))

## [1.1.3](https://github.com/pirminbleiker/st-lsp/compare/v1.1.2...v1.1.3) (2026-02-28)


### Bug Fixes

* **lsp:** add TcPOU extraction + position translation to references/rename/signatureHelp (sl-lsp-bugs) ([5f28d7b](https://github.com/pirminbleiker/st-lsp/commit/5f28d7b749359f105cc61b41946f43354a75e82f))
* **types:** use optional chaining for WorkspaceEdit.changes access in rename test ([5a410e4](https://github.com/pirminbleiker/st-lsp/commit/5a410e42b7af351134f8e497b2bc2f49141e3665))

## [1.1.2](https://github.com/pirminbleiker/st-lsp/compare/v1.1.1...v1.1.2) (2026-02-28)


### Bug Fixes

* agent config warnings + LSP bug fixes (sl-lsp-bugs) ([b63e07c](https://github.com/pirminbleiker/st-lsp/commit/b63e07c1649dda84fad7dd1fbcc0ec04dab4d9f5)), closes [16#FF](https://github.com/16/issues/FF) [INT#16](https://github.com/INT/issues/16) [TIME#1s](https://github.com/TIME/issues/1s)

## [1.1.1](https://github.com/pirminbleiker/st-lsp/compare/v1.1.0...v1.1.1) (2026-02-27)


### Bug Fixes

* **semanticTokens:** fix multiline token length bug + add test (sl-je5k) ([fdabf18](https://github.com/pirminbleiker/st-lsp/commit/fdabf18d5acd69f70d7dff564df0d0e614f8d844))

# [1.1.0](https://github.com/pirminbleiker/st-lsp/compare/v1.0.0...v1.1.0) (2026-02-27)


### Features

* **plans:** add TcPOU XML folding/dimming implementation plan ([f004984](https://github.com/pirminbleiker/st-lsp/commit/f0049841a817e658e19f8bcb511b31a52a750c0d))

# 1.0.0 (2026-02-27)


### Bug Fixes

* add eslint to devDependencies for lint script ([fbde8a1](https://github.com/pirminbleiker/st-lsp/commit/fbde8a11e37d778b9a16ddc349c9ad260f36ce7a))
* add npm test script for node/typescript project ([687d4c2](https://github.com/pirminbleiker/st-lsp/commit/687d4c25bba3b64c792ea4e476cbef5a8b3a541f))
* **completion:** fix getLibraryRefs optional chaining and TcPOU URI extraction in tests (sl-smne) ([75bcd95](https://github.com/pirminbleiker/st-lsp/commit/75bcd9513ad27c4fdd28ba358d04433180aa3929))
* **completion:** resolve 3 pre-existing test failures (sl-smne) ([6ade3d0](https://github.com/pirminbleiker/st-lsp/commit/6ade3d08676b12cb27043b168cafaf3dce87b465))
* **docs:** build Jekyll from docs/ folder, remove duplicate deploy workflow ([f714df7](https://github.com/pirminbleiker/st-lsp/commit/f714df782a2e5d9dab22aab72a7f34c1644bca11))
* **docs:** enable GitHub Pages via configure-pages enablement flag ([12d1a40](https://github.com/pirminbleiker/st-lsp/commit/12d1a404812493498e9d6807366791395d201d0b))
* **references:** add nameRange to TypeRef for precise reference highlighting (sl-jlz4) ([ce045fd](https://github.com/pirminbleiker/st-lsp/commit/ce045fda02cedc078b184629c657b9831fda0893))
* **release:** delete existing canary release before re-publishing ([0768590](https://github.com/pirminbleiker/st-lsp/commit/07685905461abe76b06d566c401eedaa271fdd65))
* **release:** rename canary tag to canary-build ([1b84b1d](https://github.com/pirminbleiker/st-lsp/commit/1b84b1dd9470a74299eecbd092c96e2530bcad4c))
* **release:** replace softprops action with gh CLI for reliability ([38afb3e](https://github.com/pirminbleiker/st-lsp/commit/38afb3e129511fda601be3f19395c2ef4cb865d7))
* **release:** use commit SHA tag for immutable canary releases ([21d6b0d](https://github.com/pirminbleiker/st-lsp/commit/21d6b0df8c82ccb4c4d4bb6e35879565578bb03a))
* remove stray merge conflict marker in hover.test.ts ([cd144dc](https://github.com/pirminbleiker/st-lsp/commit/cd144dcc6e632296a00f9bff588961493390e979))
* resolve pre-existing typecheck failure with onInlayHint (sl-kc03) ([5ce8a29](https://github.com/pirminbleiker/st-lsp/commit/5ce8a299f7bb9cfaaa48c510cf29d41b9979addb))
* **test:** exclude compiled out/ dir from Vitest discovery ([346e20f](https://github.com/pirminbleiker/st-lsp/commit/346e20fda349f547e116606ada939edbb9d27f4b))
* **tests:** explicitly declare mocha/vscode/node types in client tsconfig (sl-wisp-wisp-oduw4h) ([c554e72](https://github.com/pirminbleiker/st-lsp/commit/c554e7225ddc792463d9d1a5d72f753487494acc))
* **twincat:** recursive .plcproj discovery + server crash on missing .plcproj (sl-wisp-wisp-oduw4h) ([319f7a0](https://github.com/pirminbleiker/st-lsp/commit/319f7a052835c98fa405971906726dbc5d69de5b))
* **vsix:** bundle client extension.js with esbuild ([e9bb842](https://github.com/pirminbleiker/st-lsp/commit/e9bb8426a78b548feb9dd0b526d3cc2a9b92a6e8))
* **vsix:** bundle server with esbuild so VSIX works standalone ([2cf2459](https://github.com/pirminbleiker/st-lsp/commit/2cf24598652c0db4927a2ed277ec1ba28a4d8386))


### Features

* add code actions / QuickFix for diagnostics (sl-5l3e) ([b624a61](https://github.com/pirminbleiker/st-lsp/commit/b624a6146b511f733fb1848bb24cb16c2eb21013))
* add standard library symbol catalog (sl-chlu) ([cd45e8d](https://github.com/pirminbleiker/st-lsp/commit/cd45e8d0f559200495f04df794567f5f3d848b45))
* add TYPE/UNION/NAMESPACE support and missing VAR keywords (sl-2dtm) ([48ce8dd](https://github.com/pirminbleiker/st-lsp/commit/48ce8dd6a82d0d8612415a22efbd1c872dd51ad2))
* **ci:** add GitHub Actions CI workflow and ESLint config (sl-30i8) ([44dc133](https://github.com/pirminbleiker/st-lsp/commit/44dc13350bc3879afeadef34647d4b0b58ef4f8d))
* **ci:** add GitHub Actions release workflow for VSIX publishing (sl-jpyp) ([435d537](https://github.com/pirminbleiker/st-lsp/commit/435d537b91954f82dbe2028b5f7cab88e967f396))
* **ci:** add GitHub Pages deploy workflow and github_username (sl-ncgr) ([214c47e](https://github.com/pirminbleiker/st-lsp/commit/214c47ea35e2f88bb3f319f70312fd9d635d2a96))
* **completion:** member-access dot completion on objects (sl-u76t) ([ea2aa0e](https://github.com/pirminbleiker/st-lsp/commit/ea2aa0eb79237d4af22014e7a1e9d982575d87e7))
* **diagnostics:** detect BOOL-to-numeric type mismatch on assignment (sl-wisp-wisp-4b6anh) ([c8052e5](https://github.com/pirminbleiker/st-lsp/commit/c8052e54e13cd87a650ac7167d0feb60468be668))
* **diagnostics:** implement syntax diagnostics handler (sl-42y) ([b4effbb](https://github.com/pirminbleiker/st-lsp/commit/b4effbba03d1c143b12eca8e20e84f8aa0a43eb2))
* **docs:** add comprehensive feature reference pages for GitHub Pages (sl-vl8o) ([0be3432](https://github.com/pirminbleiker/st-lsp/commit/0be3432f54a392211169d5064b287b564244c8e3))
* **docs:** add Jekyll GitHub Pages site with just-the-docs theme (sl-mp35) ([e21ed1e](https://github.com/pirminbleiker/st-lsp/commit/e21ed1e0808fa14f26216ccd71cf702d81c07fc1))
* **documentSymbols:** group VAR declarations by section type in Outline view ([a1c918b](https://github.com/pirminbleiker/st-lsp/commit/a1c918b076a4a5711619563053ad2eb1935032ce))
* dot-accessor completion for FB instances and structs (sl-trov) ([eb8db43](https://github.com/pirminbleiker/st-lsp/commit/eb8db43cf7f58a107a4f6ed7ee4a6fd1a6f3b648))
* enum-aware completion on := assignment and CASE selector (sl-pjr8) ([5d4fd32](https://github.com/pirminbleiker/st-lsp/commit/5d4fd32c5a7ecf5c74387cb6e7dc4db1a8b54104))
* fix inlayHint API, add server startup test, add VS Code integration tests ([69b0489](https://github.com/pirminbleiker/st-lsp/commit/69b0489d185911a273b58206ecc7c2bf17e4433c))
* **hover/completion:** constant value resolution (sl-5iz9) ([6df81e2](https://github.com/pirminbleiker/st-lsp/commit/6df81e28580dae1ef370370f9f0811d3b244e42e))
* **hover:** show var block kind and value range on variable hover (sl-wisp-wisp-4rw6p8) ([ab5eb59](https://github.com/pirminbleiker/st-lsp/commit/ab5eb592c2cf5fe92a1d0080e54910989d36d0d3))
* implement auto-completion for ST keywords and variables (sl-6ae) ([10f87ae](https://github.com/pirminbleiker/st-lsp/commit/10f87aef5f7a0f17641bb2118e479621987b9192))
* implement IEC 61131-3 ST lexer and recursive-descent parser ([2578d19](https://github.com/pirminbleiker/st-lsp/commit/2578d19914203df5629707185ab981a442eceae3))
* implement textDocument/formatting and rangeFormatting (sl-71qj) ([09af694](https://github.com/pirminbleiker/st-lsp/commit/09af69455a0dacda96b69282e8f98ab61c4f292e))
* implement textDocument/inlayHint for parameter name hints (sl-ht3i) ([1754ec8](https://github.com/pirminbleiker/st-lsp/commit/1754ec82c08b2ebaa40e08203eba50ba492a9d11))
* implement workspace/symbol for Ctrl+T POU and type search ([79fff01](https://github.com/pirminbleiker/st-lsp/commit/79fff012e6ddb8035d28aaf32143a0d035976b71))
* integrate mobject-core as test foundation (OOP basis) (sl-4rqp) ([8eeee41](https://github.com/pirminbleiker/st-lsp/commit/8eeee417db9fbb2ba27a8f37ec9fa4223d79bad3))
* integrate tcExtractor into handlers (sl-ope1) ([97d545a](https://github.com/pirminbleiker/st-lsp/commit/97d545a3e7dabf9081b4211e6954b194a9eebe83))
* **lsp:** add cross-file completion via WorkspaceIndex ([a999b6f](https://github.com/pirminbleiker/st-lsp/commit/a999b6f44e2dd661935d00e427862274ea9b0195))
* **lsp:** add GVL support to workspace/symbol (sl-wisp-wisp-idimdo) ([b5bd3d4](https://github.com/pirminbleiker/st-lsp/commit/b5bd3d447ba78cd0f883bbcf15d4da9ee7b3a9ae))
* **lsp:** add semantic diagnostics for undefined vars and duplicate declarations ([57a7d01](https://github.com/pirminbleiker/st-lsp/commit/57a7d01c8b92c132f2a1521cb24e168a9dd64aa7))
* **lsp:** enhance go-to-definition with TypeRef and FB member navigation ([9c1aff2](https://github.com/pirminbleiker/st-lsp/commit/9c1aff26b8c9a0cf428fdb2e38109249e9c9eea1))
* **lsp:** extend Find All References to cover type annotations (sl-wisp-wisp-2jxs0i) ([734a8b0](https://github.com/pirminbleiker/st-lsp/commit/734a8b042b34d57e4aac80253240eaef01a6212b))
* **lsp:** implement document symbols provider ([3f30f89](https://github.com/pirminbleiker/st-lsp/commit/3f30f8982a5a266cc51cc76e84af4282f9647fcb))
* **lsp:** implement Find All References provider ([d596935](https://github.com/pirminbleiker/st-lsp/commit/d5969356dc2eb24a331d2781610db897d44eef3e))
* **lsp:** implement go-to-definition for ST variables and POUs (sl-83t) ([da8dbea](https://github.com/pirminbleiker/st-lsp/commit/da8dbeaff889d446b353b2cb9185a01cafa1eb73))
* **lsp:** implement hover documentation handler for ST (sl-bf7) ([540ceb6](https://github.com/pirminbleiker/st-lsp/commit/540ceb65a6932ac9c76c1bf4b844e675ecf4d200))
* **lsp:** implement Rename Symbol provider ([f4e698c](https://github.com/pirminbleiker/st-lsp/commit/f4e698cb5659c527e87eb1ddd82f39b1f1aad642))
* **lsp:** implement signature help provider for function/FB calls ([a1db899](https://github.com/pirminbleiker/st-lsp/commit/a1db8998de22cf467b3100181c9b053010d0098c))
* **lsp:** implement textDocument/foldingRange for ST (sl-m86e) ([810c3eb](https://github.com/pirminbleiker/st-lsp/commit/810c3ebd7c0b6792e73812134f50c17839f52d9f))
* **lsp:** register Rename and PrepareRename handlers in server ([580fe4d](https://github.com/pirminbleiker/st-lsp/commit/580fe4d2f13aba3f6a19cd9b6bb1a4a33c3e3887))
* **packaging:** configure VSIX packaging with vsce and copy-server script (sl-mr4t) ([3714a35](https://github.com/pirminbleiker/st-lsp/commit/3714a354bbfdf36f6288418b79b28755f7f3f1e5))
* parse and index ACTION sections in .TcPOU files ([13c7a7c](https://github.com/pirminbleiker/st-lsp/commit/13c7a7ce2e2598eac71b9d344714ec066906bdc6))
* **parser:** add TYPE/STRUCT/ENUM/METHOD/INTERFACE support ([a74e39a](https://github.com/pirminbleiker/st-lsp/commit/a74e39aec46f92b12df043fd735f5485ac8f145f))
* **parser:** fix CASE statement sub-code recognition (sl-xl4l) ([46056b9](https://github.com/pirminbleiker/st-lsp/commit/46056b936676261c9b0bd70db49833f1cb295ff2))
* **parser:** typed enum parsing support (sl-34rw) ([f9a8487](https://github.com/pirminbleiker/st-lsp/commit/f9a848779fccd047bb2c64a94b4da62fe1ee2383))
* **parser:** VAR CONSTANT, RETAIN, PERSISTENT support (sl-7o3m) ([e9e48e9](https://github.com/pirminbleiker/st-lsp/commit/e9e48e91b7658c2e65fc55a22561b4a0849ddf60))
* pragma attribute hover documentation (sl-ktnh) ([4591eef](https://github.com/pirminbleiker/st-lsp/commit/4591eef4d91434a1a98a046d67a7187ec9e2ac65))
* **rename:** add VarDeclaration and ForStatement loop variable renaming ([29b110a](https://github.com/pirminbleiker/st-lsp/commit/29b110a0450288c15c8e2aa2cf2f03de0507bb6c))
* semantic type diagnostics (Part A, B, C) (sl-yz1m) ([ab44ba1](https://github.com/pirminbleiker/st-lsp/commit/ab44ba113320a27276893cb5babd4987049947db))
* **sl-6sfv:** implement textDocument/semanticTokens/full ([2330646](https://github.com/pirminbleiker/st-lsp/commit/233064628e1b7343af06fdd23b3fccc0d9781d2b))
* **sl-8zjk:** use AST cache and add prefix filtering in cross-file completion ([1f5d79e](https://github.com/pirminbleiker/st-lsp/commit/1f5d79ecf7009179e6cd367805d1ba76fb6a2331))
* **sl-ifri:** SUPER^ member completion and go-to-definition in extended FBs ([765abbd](https://github.com/pirminbleiker/st-lsp/commit/765abbd177fa06803b31bdd7535be33b6731c2a5))
* **sl-kyp2:** client registration + AST caching in WorkspaceIndex ([8bf89bb](https://github.com/pirminbleiker/st-lsp/commit/8bf89bb1ab534c9da86b261169ce66ffb2d96268))
* **sl-m9nw:** codeLens for interface implementors, FB children, and method overrides ([0c2c86d](https://github.com/pirminbleiker/st-lsp/commit/0c2c86ddf5f55bf3de5841b526639d7be808da30))
* **sl-wqzi:** library-aware completion, hover provenance, missing-lib diagnostics ([5ac09d4](https://github.com/pirminbleiker/st-lsp/commit/5ac09d42165978730da78bc7df4b98b599528f40))
* **tcExtractor:** Create stub interfaces for ST extraction ([7e70743](https://github.com/pirminbleiker/st-lsp/commit/7e707430362e0e0ffac28c4f7d5ebf0df47ebfb2))
* **tcpou:** XML/CDATA dimming and folding in TcPOU files (sl-l8ot) ([e90bba1](https://github.com/pirminbleiker/st-lsp/commit/e90bba1655c85b141202e3df22b7890f3486a656))
* **tests:** add VS Code integration tests with @vscode/test-cli (sl-wisp-wisp-oduw4h) ([97b7eff](https://github.com/pirminbleiker/st-lsp/commit/97b7eff968d48e3f2743974d2f2065ea6f8093d1))
* **twincat:** add .tsproj/.plcproj awareness module ([ea93c07](https://github.com/pirminbleiker/st-lsp/commit/ea93c0721386609735400ac1a6ef12866bfea575))
* **twincat:** implement tcExtractor with offset mapping and unit tests ([35dd83e](https://github.com/pirminbleiker/st-lsp/commit/35dd83ea8425ab63ba71b9d1a8962e8be0298f6d))
* TypeScript monorepo scaffold with LSP server and VS Code client (sl-slz) ([787a977](https://github.com/pirminbleiker/st-lsp/commit/787a9778369c2412717848e8f58e49765c075257))
* **vsix:** configure VSIX packaging with vsce, .vscodeignore, copy-server script (sl-mr4t) ([1a376ef](https://github.com/pirminbleiker/st-lsp/commit/1a376ef6a8d4b90cdd9fe047c2dc059c00f65bc5))
