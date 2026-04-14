import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GuardClaw',
  ignoreDeadLinks: [/^http:\/\/localhost/],
  description: 'Real-time AI agent safety monitor. Risk-scores every tool call before execution.',
  lang: 'en-US',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { property: 'og:title', content: 'GuardClaw — AI Agent Safety Monitor' }],
    ['meta', { property: 'og:description', content: 'Risk-scores every tool call your AI agent makes. Blocks dangerous ones.' }],
    ['meta', { property: 'og:image', content: 'https://tobyge.github.io/GuardClaw/screenshots/dashboard-overview-2026-03.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'GuardClaw',

    nav: [
      { text: 'Guide', link: '/guide/quick-start' },
      { text: 'CLI Reference', link: '/cli/reference' },
      { text: 'Backends', link: '/backends/' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Roadmap', link: '/roadmap' },
      {
        text: 'v0.1.6',
        items: [
          { text: 'npm', link: 'https://www.npmjs.com/package/guardclaw' },
          { text: 'Changelog', link: 'https://github.com/TobyGE/GuardClaw/commits/main' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: 'Supported Agents', link: '/guide/agents' },
            { text: 'Configuration', link: '/guide/configuration' },
          ],
        },
      ],
      '/backends/': [
        {
          text: 'LLM Backends',
          items: [
            { text: 'Overview', link: '/backends/' },
            { text: 'Local (LM Studio / Ollama)', link: '/backends/local' },
            { text: 'Cloud Providers', link: '/backends/cloud' },
            { text: 'Built-in MLX', link: '/backends/builtin' },
          ],
        },
      ],
      '/cli/': [
        {
          text: 'CLI',
          items: [
            { text: 'Command Reference', link: '/cli/reference' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/TobyGE/GuardClaw' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Locally judged. Open source. Your data stays on your machine.',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/TobyGE/GuardClaw/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
