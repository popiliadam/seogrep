import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({ dir: "content/docs" });

/** Frontmatter every blog post must carry. `date` drives ordering, so it is required. */
export type BlogFrontmatter = { title: string; description: string; date: string };

/**
 * Standard Schema (https://standardschema.dev) — the interface fumadocs-mdx validates
 * frontmatter against. Written by hand instead of `zod.extend(pageSchema)` because `zod`
 * is not a dependency of @pseo/web; adding one would mean a package.json + lockfile
 * change for three fields. The spec is a plain object, so no library is needed.
 */
type StandardSchema<T> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => { value: T } | { issues: { message: string }[] };
    readonly types?: { input: T; output: T };
  };
};

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** YAML turns an unquoted `date: 2026-07-20` into a Date — accept both spellings. */
const readDate = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (isFilledString(value)) return Number.isNaN(Date.parse(value)) ? null : value;
  return null;
};

const blogFrontmatterSchema: StandardSchema<BlogFrontmatter> = {
  "~standard": {
    version: 1,
    vendor: "seogrep",
    validate: (value) => {
      const frontmatter = (value ?? {}) as Record<string, unknown>;
      const issues = (["title", "description"] as const)
        .filter((key) => !isFilledString(frontmatter[key]))
        .map((key) => ({ message: `blog frontmatter: "${key}" is required and must be a non-empty string` }));
      const date = readDate(frontmatter.date);
      if (date === null) issues.push({ message: 'blog frontmatter: "date" is required and must be a real date' });
      if (issues.length > 0) return { issues };
      return {
        value: {
          title: frontmatter.title as string,
          description: frontmatter.description as string,
          date: date as string,
        },
      };
    },
  },
};

export const blog = defineDocs({ dir: "content/blog", docs: { schema: blogFrontmatterSchema } });

export default defineConfig();
