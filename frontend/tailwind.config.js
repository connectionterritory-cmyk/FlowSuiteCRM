import animate from 'tailwindcss-animate'

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0f172a',
        canvas: '#f8fafc',
        steel: '#1e293b',
        accent: '#0ea5e9',
        accentDark: '#0369a1',
        warning: '#b45309',
        success: '#15803d',
      },
      boxShadow: {
        card: '0 6px 16px rgba(15, 23, 42, 0.12)',
      },
    },
  },
  plugins: [animate],
}
