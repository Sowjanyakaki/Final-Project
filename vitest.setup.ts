/// <reference path="./node_modules/@testing-library/jest-dom/types/vitest.d.ts" />
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
