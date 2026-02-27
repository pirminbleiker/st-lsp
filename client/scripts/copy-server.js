#!/usr/bin/env node
// Copies the esbuild-bundled server into client/server-out/ for VSIX packaging.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'server', 'bundle', 'server.js');
const destDir = path.join(__dirname, '..', 'server-out');
const dest = path.join(destDir, 'server.js');

if (!fs.existsSync(src)) {
	console.error(`Error: server/bundle/server.js not found at ${src}. Run 'npm run bundle' first.`);
	process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied ${src} → ${dest}`);
