// web-ext config — dev (Firefox) + packaging (Chrome/Firefox).
// Only the extension itself ships; everything internal/dev is ignored.
module.exports = {
  sourceDir: __dirname,
  artifactsDir: 'web-ext-artifacts',
  ignoreFiles: [
    '_reflexion/**',
    'tests/**',
    'docs/**',
    '.github/**',
    'node_modules/**',
    'web-ext-artifacts/**',
    'web-ext-config.cjs',
    'package.json',
    'package-lock.json',
    'playwright.config.*',
    '**/*.md',
    '**/*.map',
  ],
  build: {
    overwriteDest: true,
  },
  run: {
    // `web-ext run` launches Firefox by default; pass --target=chromium for Chrome.
    startUrl: ['https://www.google.com/search?q=how+to+improve+sleep+quality&hl=en'],
  },
};
