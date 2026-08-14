export default {
  '*.{js,mjs,cjs,ts,tsx,cts,mts}': ['eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{json,css,html,md,yml,yaml}': 'prettier --write',
};
