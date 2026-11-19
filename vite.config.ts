import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// site.config.json is the single place that holds the repository name and
// the display title. Renaming the repository only requires editing that file.
const site = JSON.parse(
  readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'),
) as { repoName: string; title: string };

export default defineConfig({
  base: `/${site.repoName}/`,
  plugins: [
    {
      name: 'site-title',
      transformIndexHtml(html: string): string {
        return html.replaceAll('%SITE_TITLE%', site.title);
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
