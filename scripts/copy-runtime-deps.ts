import fs from 'node:fs';
import path from 'node:path';

export function copyRuntimeDependencyTree(packages: string[], buildPath: string): void {
  const sourceModules = path.resolve(__dirname, '..', 'node_modules');
  const destinationModules = path.join(buildPath, 'node_modules');
  fs.mkdirSync(destinationModules, { recursive: true });

  const copied = new Set<string>();
  const copyPackage = (name: string) => {
    if (copied.has(name)) return;
    copied.add(name);
    const packageDir = path.join(sourceModules, name);
    if (!fs.existsSync(packageDir)) throw new Error(`Runtime dependency missing: ${name}`);
    const destination = path.join(destinationModules, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(packageDir, destination, { recursive: true, force: true });
    const manifestPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string,string> };
    for (const dependency of Object.keys(manifest.dependencies ?? {})) copyPackage(dependency);
  };

  for (const packageName of packages) copyPackage(packageName);
}
