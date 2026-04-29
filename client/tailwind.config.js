/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        'card':  '0 0 0 1px rgba(255,255,255,0.07), 0 4px 24px rgba(0,0,0,0.55)',
        'float': '0 8px 40px rgba(0,0,0,0.75)',
        'glow':  '0 0 24px rgba(44,232,156,0.20)',
      },
      letterSpacing: {
        'widest': '0.12em',
      },
    },
  },
  plugins: [],
};
