/** @type {import('tailwindcss').Config} */
// The Outcomes palette. The components were written light-first (bg-*-50
// chips with text-*-700 labels), and the product is light again, so every
// family is back in its natural order: 50 is the palest tint, 500 the
// block colour itself; 600 and 700 are text-safe (at least 4.6:1 on white),
// because the light-first components set their links and labels in 600.
// Five families, matching static/css/bento-tokens.css: orange (primary),
// sky (neutral data), amber (featured), red (attention) and green (positive).
const orange = { 50:'#FFF1EA', 100:'#FFE4D8', 200:'#FFC9B0', 300:'#FFA27A', 400:'#FF7A45', 500:'#FF6022', 600:'#C4410F', 700:'#B83C0C', 800:'#8F2E08', 900:'#5E1F06', 950:'#3A1304' };
const sky    = { 50:'#EEF7FF', 100:'#E2F1FF', 200:'#C4E4FF', 300:'#A8D8FF', 400:'#8CCBFF', 500:'#8CCBFF', 600:'#1D65A6', 700:'#1D65A6', 800:'#164E80', 900:'#0F3656', 950:'#0A2238' };
const amber  = { 50:'#FFF8E6', 100:'#FFF0CC', 200:'#FFE199', 300:'#FFD166', 400:'#FFC233', 500:'#FFB500', 600:'#FFB500', 700:'#8A5A00', 800:'#6B4600', 900:'#4A3000', 950:'#2E1E00' };
const red    = { 50:'#FFF0EE', 100:'#FFE1DE', 200:'#FFC2BC', 300:'#FF8C84', 400:'#FF5A50', 500:'#FF3B30', 600:'#FF3B30', 700:'#C8261B', 800:'#9C1D14', 900:'#6B140E', 950:'#420C08' };
const green  = { 50:'#EEF7F1', 100:'#DDF0E4', 200:'#B9E0C7', 300:'#7FC69A', 400:'#3FA266', 500:'#17753F', 600:'#17753F', 700:'#17753F', 800:'#115A30', 900:'#0B3D20', 950:'#062614' };
// Neutrals: paper and stone at the light end, ink at the dark end.
const ink    = { 50:'#F6F4F1', 100:'#F1EFED', 200:'#EBE9E5', 300:'#DBD7D1', 400:'#8A857E', 500:'#6F6B66', 600:'#5A5650', 700:'#444444', 800:'#2B2B2E', 900:'#121213', 950:'#0A0A0B' };

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: ink, gray: ink, zinc: ink, neutral: ink, stone: ink,
        indigo: orange, violet: orange, purple: orange, brand: orange, orange: orange,
        blue: sky, sky: sky, cyan: sky,
        emerald: green, green: green, lime: green, teal: green,
        red: red, rose: red, pink: red, fuchsia: red,
        amber: amber, yellow: amber,
      },
      fontFamily: {
        sans: ['"Zalando Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        // Headings: Fraunces, set exactly as the public site sets it.
        display: ['Fraunces', '"Times New Roman"', 'Georgia', 'serif'],
        // No monospace: ids and codes use the text face.
        mono: ['"Zalando Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontWeight: { extrabold: '700', black: '700' },
      // outcomes.digital's radii: 8px small controls, 16px cards, 24px blocks.
      borderRadius: { lg: '8px', xl: '16px', '2xl': '16px', '3xl': '24px' },
    },
  },
  plugins: [],
}
