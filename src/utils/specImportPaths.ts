/**
 * Specs under tests/generated or tests/healed resolve `../foo` relative to `tests/`,
 * not the repo root. LLMs often emit `../pages/...` or `../playwright.config`,
 * which breaks at runtime. Normalize those to `../../...`.
 */
export function normalizeNestedTestImports(source: string): string {
  return source
    .replaceAll(`from '../pages/`, `from '../../pages/`)
    .replaceAll(`from "../pages/`, `from "../../pages/`)
    .replaceAll(`from '../fixtures/`, `from '../../fixtures/`)
    .replaceAll(`from "../fixtures/`, `from "../../fixtures/`)
    .replaceAll(`from '../playwright.config'`, `from '../../playwright.config'`)
    .replaceAll(`from "../playwright.config"`, `from "../../playwright.config"`)
    .replaceAll(`from '../playwright.config.ts'`, `from '../../playwright.config.ts'`)
    .replaceAll(`from "../playwright.config.ts"`, `from "../../playwright.config.ts"`);
}
