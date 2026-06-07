export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: {
          900: '#030509',
          800: '#070a10',
          700: '#0a0e17',
        },
        primary: {
          50: '#f0f9ff',
          500: '#0ea5e9',
          900: '#0c2d57',
        },
        accent: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
      },
      fontFamily: {
        sans: ['"Outfit"', 'sans-serif'],
        mono: ['"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.4)',
        'glow-violet': '0 0 20px rgba(139, 92, 246, 0.4)',
      },
    },
  },
  plugins: [],
};
