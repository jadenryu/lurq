/**
 * Lightweight category inference (§11). Maps a natural-language need to a
 * taxonomy category via keyword matching. Returns null when uncertain, so the
 * caller searches across all categories rather than over-filtering.
 */
import type { Category } from '../core/types';

const RULES: { category: Category; patterns: RegExp }[] = [
  { category: 'meta-framework', patterns: /\b(meta-?framework|next\.?js|nuxt|remix|astro|gatsby|sveltekit|full-?stack framework)\b/ },
  { category: 'state-management', patterns: /\b(state management|global state|store|redux|zustand|jotai|mobx|atoms?)\b/ },
  { category: 'routing', patterns: /\b(rout(e|er|ing)|navigation|url matching)\b/ },
  { category: 'orm', patterns: /\b(orm|object-?relational|query builder|prisma|drizzle|sequelize|typeorm)\b/ },
  { category: 'database-client', patterns: /\b(database (driver|client)|postgres|mysql|mongo(db)?|redis|sqlite|db driver)\b/ },
  { category: 'ui-component-library', patterns: /\b(component library|ui kit|ui components?|design system|buttons?|modal|dialog)\b/ },
  { category: 'styling', patterns: /\b(styl(e|ing)|css|tailwind|sass|scss|class ?names?|theme)\b/ },
  { category: 'forms', patterns: /\b(forms?|form (state|library|handling)|input handling)\b/ },
  { category: 'validation', patterns: /\b(validat(e|ion|or)|schema|parse input|type ?safe parsing)\b/ },
  { category: 'data-fetching', patterns: /\b(data fetching|server state|react query|swr|graphql client|caching queries)\b/ },
  { category: 'http-client', patterns: /\b(http client|fetch wrapper|rest client|make (a )?request|ajax|api calls?)\b/ },
  { category: 'auth', patterns: /\b(auth(entication|orization)?|login|session|jwt|oauth|password hashing)\b/ },
  { category: 'testing', patterns: /\b(test(ing|s)?|unit test|e2e|assertion|mocking|test runner)\b/ },
  { category: 'bundler', patterns: /\b(bundler|bundle (modules?|code)|webpack|rollup|esbuild|parcel)\b/ },
  { category: 'build-tool', patterns: /\b(build tool|dev server|monorepo|task runner|compile|transpile)\b/ },
  { category: 'linting', patterns: /\b(lint(er|ing)?|formatter|formatting|code (quality|style|format)|prettier|eslint)\b/ },
  { category: 'date-time', patterns: /\b(dates?|date ?time|time(zone)?s?|calendar|parse dates?|format dates?)\b/ },
  { category: 'animation', patterns: /\b(animat(e|ion)|motion|transition|spring|gsap|3d)\b/ },
  { category: 'charts', patterns: /\b(charts?|graphs?|data ?vis(ualization)?|plots?|dashboards?)\b/ },
  { category: 'i18n', patterns: /\b(i18n|internationali[sz]ation|localization|translat(e|ion)|locale)\b/ },
  { category: 'framework', patterns: /\b(framework|react|vue|svelte|angular|web server|backend framework)\b/ },
  { category: 'utility', patterns: /\b(debounce|throttle|deep ?clone|slugify|uuid|util(ity|ities)?|helper|lodash|retry)\b/ },
];

export function inferCategory(need: string): Category | null {
  const text = need.toLowerCase();
  for (const rule of RULES) {
    if (rule.patterns.test(text)) return rule.category;
  }
  return null;
}

/** Return every category whose keywords appear in the text (for the diagram tool). */
export function inferCategories(text: string): Category[] {
  const lower = text.toLowerCase();
  const found: Category[] = [];
  for (const rule of RULES) {
    if (rule.patterns.test(lower) && !found.includes(rule.category)) found.push(rule.category);
  }
  return found;
}
