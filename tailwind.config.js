module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          500: '#0ea5e9',
          900: '#0c2d57',
        },
        accent: {
          500: '#8b5cf6',
        },
      },
      fontFamily: {
        mono: ['"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
};
