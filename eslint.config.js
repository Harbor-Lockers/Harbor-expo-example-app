// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Plain Node scripts (run by npm / Expo CLI, not bundled into the app).
    files: ['scripts/**/*.js', 'plugins/**/*.js'],
    languageOptions: { globals: { __dirname: 'readonly', require: 'readonly', module: 'readonly', process: 'readonly' } },
  },
]);
