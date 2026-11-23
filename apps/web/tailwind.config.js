/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fpl: {
          green: '#247356',
          'green-dark': '#185641',
          'green-light': '#32946e',
          dark: '#111827',
          'dark-light': '#1f2937',
          gold: '#ffd700',
          'gold-dark': '#ffb700',
          red: '#ef4444',
          'red-light': '#f87171',
          blue: '#3b82f6',
          'blue-light': '#60a5fa',
        }
      }
    },
  },
  plugins: [],
}

