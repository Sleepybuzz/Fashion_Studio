/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FAF9F7',
        sand: '#F1EFEC',
        ink: '#171717',
        muted: '#777777',
        line: '#E8E5E1',
        brand: { DEFAULT: '#7952A3', dark: '#5F3F82' },
        sky: { accent: '#368DCE' },
        leaf: '#27A66B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
