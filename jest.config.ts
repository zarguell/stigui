// jest.config.ts
import { createDefaultPreset, JestConfigWithTsJest } from 'ts-jest'

const jestConfig: JestConfigWithTsJest = {
  // [...]
  ...createDefaultPreset(),
  // The project tsconfig uses jsx: preserve (Next's requirement); tests
  // import component modules for their pure helpers, so emit runnable
  // JSX instead.
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
}

export default jestConfig