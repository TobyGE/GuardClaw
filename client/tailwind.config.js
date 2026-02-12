/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'gc-bg': 'var(--gc-bg)',
        'gc-card': 'var(--gc-card)',
        'gc-border': 'var(--gc-border)',
        'gc-text': 'var(--gc-text)',
        'gc-text-secondary': 'var(--gc-text-secondary)',
        'gc-text-dim': 'var(--gc-text-secondary)',
        'gc-safe': 'var(--gc-safe)',
        'gc-warning': 'var(--gc-warning)',
        'gc-danger': 'var(--gc-danger)',
        'gc-primary': 'var(--gc-primary)',
      },
    },
  },
  plugins: [],
};
