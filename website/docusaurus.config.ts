import type { Config } from '@docusaurus/types';
import type { Options, ThemeConfig } from '@docusaurus/preset-classic';
import remarkGithubAdmonitionsToDirectives from 'remark-github-admonitions-to-directives';

import { resolveRepositoryMarkdownLink } from './src/markdown/repository-links.mjs';
import remarkRepositoryLinks from './src/markdown/remark-repository-links.mjs';

function siteUrl(): string {
  const configured = process.env.DOCUSAURUS_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const vercelHostname = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercelHostname ? `https://${vercelHostname}` : 'http://localhost:3000';
}

const config: Config = {
  title: 'Smocket documentation',
  tagline: 'Test Socket.IO delivery and routing without a server.',
  favicon: 'img/favicon.svg',
  url: siteUrl(),
  baseUrl: '/docs/',
  trailingSlash: true,
  organizationName: 'electrohyun',
  projectName: 'smocket',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: resolveRepositoryMarkdownLink,
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          beforeDefaultRemarkPlugins: [remarkRepositoryLinks, remarkGithubAdmonitionsToDirectives],
          editUrl: ({ docPath }) =>
            `https://github.com/electrohyun/smocket/edit/main/docs/${docPath}`,
          showLastUpdateTime: false,
          showLastUpdateAuthor: false,
        },
        blog: false,
        pages: false,
        sitemap: {},
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Options,
    ],
  ],
  themeConfig: {
    image: 'https://ik.imagekit.io/electrohyun/smocket.png?tr=w-1280',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'smocket',
      hideOnScroll: false,
      items: [
        { type: 'docSidebar', sidebarId: 'docs', label: 'Documentation', position: 'left' },
        {
          href: 'https://github.com/electrohyun/smocket',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://www.npmjs.com/package/smocket',
          label: 'npm',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: 'https://github.com/electrohyun/smocket' },
            { label: 'npm', href: 'https://www.npmjs.com/package/smocket' },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discussions',
              href: 'https://github.com/electrohyun/smocket/discussions',
            },
            { label: 'smocket-site', href: 'https://smocket-site.vercel.app' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} smocket contributors.`,
    },
    prism: {
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies ThemeConfig,
};

export default config;
