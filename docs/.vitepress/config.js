import { defineConfig } from 'vitepress'

const enNav = [
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
]

const zhNav = [
  { text: '指南', link: '/zh/guide/quick-start' },
  { text: 'CLI 参考', link: '/zh/cli/reference' },
  { text: 'LLM 后端', link: '/zh/backends/' },
  { text: '架构', link: '/zh/architecture' },
  { text: '路线图', link: '/roadmap' },
  {
    text: 'v0.1.6',
    items: [
      { text: 'npm', link: 'https://www.npmjs.com/package/guardclaw' },
      { text: '更新日志', link: 'https://github.com/TobyGE/GuardClaw/commits/main' },
    ],
  },
]

const enSidebar = {
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
}

const zhSidebar = {
  '/zh/guide/': [
    {
      text: '快速入门',
      items: [
        { text: '快速开始', link: '/zh/guide/quick-start' },
        { text: '支持的 Agent', link: '/zh/guide/agents' },
        { text: '配置说明', link: '/zh/guide/configuration' },
      ],
    },
  ],
  '/zh/backends/': [
    {
      text: 'LLM 后端',
      items: [
        { text: '概览', link: '/zh/backends/' },
        { text: '本地（LM Studio / Ollama）', link: '/zh/backends/local' },
        { text: '云端服务商', link: '/zh/backends/cloud' },
        { text: '内置 MLX', link: '/zh/backends/builtin' },
      ],
    },
  ],
  '/zh/cli/': [
    {
      text: 'CLI',
      items: [
        { text: '命令参考', link: '/zh/cli/reference' },
      ],
    },
  ],
}

export default defineConfig({
  title: 'GuardClaw',
  description: 'Real-time AI agent safety monitor. Risk-scores every tool call before execution.',
  ignoreDeadLinks: [/^http:\/\/localhost/],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { property: 'og:title', content: 'GuardClaw — AI Agent Safety Monitor' }],
    ['meta', { property: 'og:description', content: 'Risk-scores every tool call your AI agent makes. Blocks dangerous ones.' }],
    ['meta', { property: 'og:image', content: 'https://tobyge.github.io/GuardClaw/screenshots/dashboard-overview-2026-03.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar,
        editLink: {
          pattern: 'https://github.com/TobyGE/GuardClaw/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous', next: 'Next' },
      },
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
        editLink: {
          pattern: 'https://github.com/TobyGE/GuardClaw/edit/main/docs/:path',
          text: '在 GitHub 上编辑此页',
        },
        outline: { label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        darkModeSwitchLabel: '主题',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        sidebarMenuLabel: '菜单',
        returnToTopLabel: '回到顶部',
        langMenuLabel: '切换语言',
      },
    },
  },

  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'GuardClaw',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/TobyGE/GuardClaw' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Locally judged. Open source. Your data stays on your machine.',
    },

    search: {
      provider: 'local',
      options: {
        locales: {
          zh: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
  },
})
