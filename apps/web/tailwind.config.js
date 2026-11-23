/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Hanken Grotesk Variable"', 'system-ui', 'sans-serif'],
        display: ['"Archivo Variable"', '"Hanken Grotesk Variable"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Warm paper neutrals. Text and rules are tinted green-black, not grey.
        paper: { DEFAULT: '#f5f3ec', raised: '#fbfaf6', sunk: '#ebe8dd' },
        line: { DEFAULT: '#d9d5c7', strong: '#b4af9d' },
        ink: { DEFAULT: '#15211c', soft: '#414e47', faint: '#636e67' },
        // Pitch greens carry the brand. Lime is the single accent.
        pitch: { DEFAULT: '#0f3a2c', deep: '#0a2a20', mid: '#17503d', turf: '#1c6a4f' },
        lime: { DEFAULT: '#cdf05a', deep: '#b9de3f', ink: '#1b2a0f' },
        clay: { DEFAULT: '#a93b24', wash: '#f6e4dc' },
        amber: { DEFAULT: '#7a5200', wash: '#f4e9c9' },
      },
      borderRadius: {
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
      },
    },
  },
  plugins: [],
}
