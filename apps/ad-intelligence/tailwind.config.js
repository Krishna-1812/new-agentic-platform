/** @type {import('tailwindcss').Config} */
// Bento palette. The components were written light-first (bg-*-50 chips
// with text-*-700 labels), so each hue family is laid out for a dark ground:
// 50 is the dim fill, 100/200 are quiet edges, 400-600 are the hue itself
// and 700/800 are the light tint that reads on the dim fill. Four families
// only, matching static/css/bento-tokens.css: sky (neutral data), lime
// (primary / positive), clay (attention), cream (featured).
const sky   = { 50:'#17303F', 100:'#1B3A4D', 200:'#24506B', 300:'#9CCEF3', 400:'#7ABDF0', 500:'#5AA9E6', 600:'#5AA9E6', 700:'#7ABDF0', 800:'#9CCEF3', 900:'#17303F', 950:'#122431' };
const lime  = { 50:'#2A3313', 100:'#333F17', 200:'#46581E', 300:'#DDFB85', 400:'#D4FA63', 500:'#C6F24E', 600:'#C6F24E', 700:'#D4FA63', 800:'#DDFB85', 900:'#2A3313', 950:'#1F260E' };
const clay  = { 50:'#33201A', 100:'#3D261E', 200:'#5A3325', 300:'#F59A7C', 400:'#F07A54', 500:'#E8663D', 600:'#E8663D', 700:'#F07A54', 800:'#F59A7C', 900:'#33201A', 950:'#261813' };
const cream = { 50:'#2E2C27', 100:'#3A3731', 200:'#4A463F', 300:'#F4F0E7', 400:'#EFE9DC', 500:'#EFE9DC', 600:'#D9D3C6', 700:'#EFE9DC', 800:'#F4F0E7', 900:'#2E2C27', 950:'#23211D' };
// Neutrals: light end is the text tiers, dark end is the surface steps.
const ink   = { 50:'#EFE9DC', 100:'#E4DED1', 200:'#C9C4B9', 300:'#A7A39B', 400:'#8B8B93', 500:'#6F6F77', 600:'#5E5E66', 700:'#3A3A40', 800:'#26262A', 900:'#1C1C1F', 950:'#131315' };

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: ink, gray: ink, zinc: ink, neutral: ink, stone: ink,
        indigo: sky, violet: sky, purple: sky, blue: sky, sky: sky, cyan: sky,
        emerald: lime, green: lime, lime: lime, teal: lime,
        orange: clay, red: clay, rose: clay, pink: clay, fuchsia: clay,
        amber: cream, yellow: cream,
        brand: sky,
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Familjen Grotesk"', 'system-ui', '-apple-system', 'sans-serif'],
        // No monospace anywhere in Bento: ids and codes use the text face.
        mono: ['"Instrument Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontWeight: { extrabold: '700', black: '700' },
      // One radius (Bento rule 3); --r-sm for elements under ~24px tall.
      borderRadius: { lg: '8px', xl: '12px', '2xl': '12px', '3xl': '12px' },
    },
  },
  plugins: [],
}
