// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // Scans these files for Tailwind classes
  ],
  theme: {
    extend: {}, // You can extend Tailwind's default theme here
  },
  plugins: [],
  corePlugins: {
    preflight: false, // Important: Disable Tailwind's base styles to avoid conflicts with Ant Design
  }
}