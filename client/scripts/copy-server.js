#!/usr/bin/env node
// Copies server/out/ into client/server-out/ for VSIX packaging.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'server', 'out');
const dest = path.join(__dirname, '..', 'server-out');

function copyDir(srcDir, destDir) {
	fs.mkdirSync(destDir, { recursive: true });
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		const srcPath = path.join(srcDir, entry.name);
		const destPath = path.join(destDir, entry.name);
		if (entry.isDirectory()) {
			copyDir(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

if (!fs.existsSync(src)) {
	console.error(`Error: server/out not found at ${src}. Run 'npm run compile' first.`);
	process.exit(1);
}

copyDir(src, dest);
console.log(`Copied ${src} → ${dest}`);
