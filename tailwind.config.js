/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Color corporativo: acentos, bordes destacados, etiquetas y textos secundarios
        brand: "#ee5734",
      },
    },
  },
  plugins: [],
};
