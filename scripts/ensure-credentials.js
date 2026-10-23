#!/usr/bin/env node
/**
 * Creates `credentials.ts` from `credentials-example.ts` when it does not exist
 * yet, so a fresh clone can bundle and type-check. Never overwrites an existing
 * file. Runs automatically on `npm install` (see "postinstall" in package.json).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'credentials.ts');
const example = path.join(root, 'credentials-example.ts');

if (fs.existsSync(target)) {
  process.exit(0);
}

fs.copyFileSync(example, target);
console.log(
  '[harbor-expo-example] Created credentials.ts from credentials-example.ts. ' +
    'Fill in CLIENT_ID, CLIENT_SECRET, SDK_ENV and MY_TOWER_ID before using the app.'
);
