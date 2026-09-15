/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark glass — mesma família do Jarvis, com o acento puxado pro âmbar/estudo.
        ink: {
          900: '#05070d',
          800: '#0a0e1a',
          700: '#0f1422',
          600: '#161c2e',
        },
        glass: 'rgba(255,255,255,0.04)',
        accent: {
          DEFAULT: '#38e0d8',
          soft: '#6ee7df',
          violet: '#8b7bff',
          amber: '#f5b955',
          rose: '#f47174',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(56,224,216,0.35)',
        'glow-amber': '0 0 40px -8px rgba(245,185,85,0.35)',
        panel: '0 8px 40px -12px rgba(0,0,0,0.6)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.35s ease-out both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
