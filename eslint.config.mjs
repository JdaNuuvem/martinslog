import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
})

const eslintConfig = [
  {
    ignores: [
      '.claude/**',
      '.claude-flow/**',
      '.superpowers/**',
      '.playwright-mcp/**',
      'docs/**',
      'node_modules/**',
      '.next/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@prisma/client', 'next/*', 'next', 'fs', 'node:*', '@/infra/*'],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ImportExpression[source.value=/^(@prisma\\/client|next(\\/.*)?|fs|node:.*|@\\/infra\\/.*)$/]",
          message:
            'O domínio não pode fazer I/O, nem por import dinâmico: import() proibido para @prisma/client, next, next/*, fs, node:* e @/infra/*.',
        },
      ],
    },
  },
]

export default eslintConfig
