// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // ผลลัพธ์จาก TypeORM raw query (runner.query / getRawAndEntities) เป็น any เสมอ
      // ลดเป็น warn ให้สอดคล้องกับ no-unsafe-argument ด้านบนที่ลดไว้ด้วยเหตุผลเดียวกัน
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      // ตัวแปรที่ขึ้นต้นด้วย _ = ตั้งใจไม่ใช้ (เช่น destructure ทิ้ง password ออกจาก object)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
