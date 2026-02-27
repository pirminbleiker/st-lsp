#!/usr/bin/env node
// Copies compiled server output into client/server-out/ for VSIX packaging.
// Run from the client/ directory: node scripts/copy-server.js

const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', 'server', 'out');
const dest = path.resolve(__dirname, '..', 'server-out');

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
  console.error(`Error: server/out not found at ${src}`);
  console.error('Run "npm run compile" from the repo root first.');
  process.exit(1);
}

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true });
}

copyDir(src, dest);
console.log(`Copied ${src} → ${dest}`);
