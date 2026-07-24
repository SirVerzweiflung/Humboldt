/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Project palette — the ONLY colours allowed anywhere (CLAUDE.md §15).
      // White text is the sole extra; dark text must use `gunmetal`.
      colors: {
        wheat: "#ebd1ad", // Wheat
        palm: "#93914d", // Palm Leaf
        gunmetal: "#424242", // Gunmetal — the only dark colour, for all dark text
        pacific: "#5296a5", // Pacific Cyan
        pink: "#f8a0cb", // Baby Pink
      },
    },
  },
  plugins: [],
};
