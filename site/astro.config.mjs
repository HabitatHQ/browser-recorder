// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// Deployed to GitHub Pages as a project site: https://habitathq.github.io/browser-recorder/
// The base path must match the repo name so asset and link URLs resolve.
export default defineConfig({
  site: 'https://habitathq.github.io',
  base: '/browser-recorder',
  integrations: [
    starlight({
      title: 'Browser Recorder',
      description:
        'A Chrome + Firefox extension that captures everything you need to file a bug report — console, network, interactions, DOM, screenshots, and video — into a self-contained zip.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/HabitatHQ/browser-recorder',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/HabitatHQ/browser-recorder/edit/main/site/',
      },
      sidebar: [
        { label: 'Overview', link: '/' },
        { label: 'Guide', slug: 'guide' },
        { label: 'CLI', slug: 'cli' },
        { label: 'Development', slug: 'development' },
        { label: 'Privacy', slug: 'privacy' },
      ],
    }),
  ],
});
