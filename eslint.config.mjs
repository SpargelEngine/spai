import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig([
    {
        files: ['**/*.ts'],
        extends: [eslint.configs.recommended, tseslint.configs.recommended],
        rules: {
            eqeqeq: 'error',
            'sort-imports': [
                'error',
                {
                    allowSeparatedGroups: true,
                },
            ],
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_' },
            ],
        },
    },
    {
        ignores: ['**/dist/**/*', '**/node_modules/**/*'],
    },
])
