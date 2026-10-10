import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
export default [
  { files: ['**/*.{js,jsx}'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node } },
    plugins: { react }, settings: { react: { version: '19' } },
    rules: { 'no-undef': 'error', 'react/jsx-no-undef': 'error', 'react/jsx-uses-vars': 'error', 'react/jsx-uses-react': 'off', 'no-unused-vars': 'off' } },
];
