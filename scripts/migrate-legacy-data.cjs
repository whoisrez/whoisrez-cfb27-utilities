const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') process.exit(0);

const appData = process.env.APPDATA;
if (!appData) process.exit(0);

const currentDir = path.join(appData, 'whoisrez-cfb27-utilities');
const legacyDirs = [
  path.join(appData, 'cfb27-promotion-relegation'),
  path.join(appData, 'CFB 27 Promotion Relegation Tracker'),
  path.join(appData, 'CFB 27 Dynasty Tools'),
];
const files = ['promotion-relegation-history.json', 'last-dynasty-save.txt'];

fs.mkdirSync(currentDir, { recursive: true });

let migratedHistory = false;
for (const legacyDir of legacyDirs) {
  for (const file of files) {
    const source = path.join(legacyDir, file);
    const destination = path.join(currentDir, file);
    if (fs.existsSync(destination) || !fs.existsSync(source)) continue;
    fs.copyFileSync(source, destination);
    if (file === 'promotion-relegation-history.json') migratedHistory = true;
  }
  if (migratedHistory) break;
}

if (migratedHistory) {
  console.log('Migrated Promotion/Relegation history from the legacy combined app.');
}
