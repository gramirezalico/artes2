/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg:      '#0A0A0F',
          black:   '#0A0A0F',
          surface: '#13131A',
          card:    '#1A1A24',
          border:  'rgba(255,255,255,0.08)',
          yellow:  '#E8FF47',
          red:     '#FF4757',
          green:   '#2ED573',
          blue:    '#5352ED',
          muted:   '#6B7280'
        }
      },
      fontFamily: {
        syne:    ['Syne', 'system-ui', 'sans-serif'],
        mono:    ['"DM Mono"', 'ui-monospace', 'monospace']
      },
      animation: {
        'skeleton': 'skeleton 1.5s ease-in-out infinite',
        'fade-in':  'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'progress': 'progress 0.6s ease-out'
      },
      keyframes: {
        skeleton: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' }
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' }
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' }
        },
        progress: {
          from: { width: '0%' },
          to: { width: 'var(--progress-width)' }
        }
      },
      boxShadow: {
        'glow-yellow': '0 0 20px rgba(232,255,71,0.15)',
        'glow-green':  '0 0 20px rgba(46,213,115,0.15)',
        'glow-red':    '0 0 20px rgba(255,71,87,0.15)'
      }
    }
  },
  plugins: []
};
