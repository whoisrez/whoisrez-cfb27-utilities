const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packagedDir = path.join(root, 'out', 'CFB 27 Utilities-win32-x64');
const portableRoot = path.join(root, 'out', 'portable');
const portableAppDir = path.join(portableRoot, 'CFB 27 Utilities');
const portableDataDir = path.join(portableAppDir, 'data');
const makeDir = path.join(root, 'out', 'make', 'portable');
const zipPath = path.join(makeDir, 'CFB-27-Utilities-Portable.zip');

if (!fs.existsSync(packagedDir)) throw new Error(`Packaged app is missing: ${packagedDir}`);
fs.rmSync(portableRoot, { recursive: true, force: true });
fs.mkdirSync(portableAppDir, { recursive: true });
fs.cpSync(packagedDir, portableAppDir, { recursive: true, force: true });
fs.rmSync(portableDataDir, { recursive: true, force: true });
fs.writeFileSync(path.join(portableAppDir, 'README.txt'), [
  'CFB 27 Utilities - Portable Windows Build', '',
  'Keep this entire folder together and run CFB 27 Utilities.exe.',
  'The app is read-only with respect to CFB 27 dynasty files.',
  'App data and Promotion/Relegation history are stored in the data folder beside the executable.',
  'Back up the data folder if you move computers.', ''
].join('\r\n'), 'utf8');
fs.mkdirSync(makeDir, { recursive: true });
fs.rmSync(zipPath, { force: true });
const esc = (v) => v.replaceAll("'", "''");
const command = `Compress-Archive -LiteralPath '${esc(portableAppDir)}' -DestinationPath '${esc(zipPath)}' -CompressionLevel Optimal -Force`;
const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', command], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Portable ZIP creation failed with exit code ${result.status}.`);
console.log(`Created portable ZIP: ${path.relative(root, zipPath)}`);
