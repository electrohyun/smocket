import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        { type: 'doc', id: 'README', label: 'Documentation home' },
        {
          type: 'link',
          label: 'Quick Start',
          href: 'https://github.com/electrohyun/smocket#quick-start',
        },
        {
          type: 'doc',
          id: 'shared-worker',
          label: 'Multi-tab frontend development',
        },
      ],
    },
    {
      type: 'category',
      label: 'Testing',
      collapsed: false,
      items: [
        { type: 'doc', id: 'test-runner-integration', label: 'Test-runner integration' },
        { type: 'doc', id: 'troubleshooting', label: 'Troubleshooting' },
      ],
    },
    {
      type: 'category',
      label: 'Features and boundaries',
      collapsed: false,
      items: [
        { type: 'doc', id: 'scope', label: 'Scope' },
        { type: 'doc', id: 'differences', label: 'Differences from real Socket.IO' },
        { type: 'doc', id: 'adapter-registration', label: 'Adapter registration' },
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        { type: 'doc', id: 'conformance', label: 'Conformance report' },
        { type: 'doc', id: 'glossary', label: 'Glossary' },
        { type: 'doc', id: 'roadmap', label: 'Roadmap' },
      ],
    },
    {
      type: 'category',
      label: 'Maintainers',
      collapsed: true,
      items: [
        {
          type: 'link',
          label: 'Contributing',
          href: 'https://github.com/electrohyun/smocket/blob/main/CONTRIBUTING.md',
        },
        { type: 'doc', id: 'CONTRIBUTING-docs', label: 'Documentation guide' },
        { type: 'doc', id: 'repository-structure', label: 'Repository structure' },
        { type: 'doc', id: 'package-policy', label: 'Package policy' },
        { type: 'doc', id: 'release-candidates', label: 'Release candidates' },
        { type: 'doc', id: 'npm-publication', label: 'npm publication' },
        { type: 'doc', id: 'release-remediation', label: 'Release remediation' },
        {
          type: 'doc',
          id: 'published-consumer-policy',
          label: 'Published consumer policy',
        },
        { type: 'doc', id: 'public-surface', label: 'Public surface' },
        { type: 'doc', id: 'labels', label: 'Labels' },
        { type: 'doc', id: 'development-lenses', label: 'Development lenses' },
        { type: 'doc', id: 'decisions/README', label: 'Decisions index' },
      ],
    },
  ],
};

export default sidebars;
