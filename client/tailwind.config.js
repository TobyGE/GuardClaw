/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'gc-bg': '#0a0e1a',
        'gc-card': '#1a1f2e',
        'gc-border': '#2d3548',
        'gc-text': '#e2e8f0',
        'gc-text-dim': '#94a3b8',
        'gc-safe': '#10b981',
        'gc-warning': '#f59e0b',
        'gc-danger': '#ef4444',
        'gc-primary': '#6366f1',
      },
    },
  },
  plugins: [],
};
