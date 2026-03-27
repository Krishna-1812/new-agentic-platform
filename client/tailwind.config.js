/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          dark: '#1e3a5f',
          mid: '#2e5f8a',
        }
      }
    },
  },
  plugins: [],
}
