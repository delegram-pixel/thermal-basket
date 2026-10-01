/**
 * Tailwind 4 is a PostCSS plugin and nothing else — there is no `tailwind.config.js`
 * any more. The design tokens live in `src/app/globals.css` inside an `@theme`
 * block, which is why no configuration for them appears here.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
