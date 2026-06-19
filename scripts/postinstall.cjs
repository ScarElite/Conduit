// Conduit postinstall — apply the node-pty patch in Conduit's OWN dev environment only.
//
// When Conduit is installed as a DEPENDENCY (e.g. V's Hub pulling it as a git dependency), its
// devDependencies — including patch-package — are not installed, and the node-pty patch is irrelevant
// anyway (the embeddable <Terminal/> never touches node-pty; that's host-side). So detect that case and
// no-op, instead of failing the consumer's `npm install` with "patch-package: command not found".
const { spawnSync } = require('node:child_process');

try {
  require.resolve('patch-package');
} catch {
  process.exit(0); // installed as a dependency — nothing to patch here
}

// Dev environment: run it strictly so a broken patch is caught.
const res = spawnSync('patch-package', ['--error-on-fail'], { stdio: 'inherit', shell: true });
process.exit(res.status ?? 0);
