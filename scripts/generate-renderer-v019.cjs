const fs = require('fs');
const { execFileSync } = require('child_process');

const restorePaths = ['src/renderer.ts', 'package.json', 'README.md'];
const backups = new Map(restorePaths.map((file) => [file, fs.readFileSync(file)]));

try {
  for (const script of ['v019-part1.cjs','v019-part2.cjs','v019-part3.cjs','v019-part4.cjs']) {
    execFileSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit' });
  }
  fs.copyFileSync('src/renderer.ts', 'src/renderer.generated.ts');
  console.log('Generated src/renderer.generated.ts for v0.1.9.');
} finally {
  for (const [file, content] of backups) fs.writeFileSync(file, content);
}
