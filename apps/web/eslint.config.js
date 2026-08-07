import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Lint for the web client.
 *
 * Deliberately small: the rules of hooks, which catch a class of bug the type
 * checker cannot see, plus the recommended TypeScript set. Style is not
 * litigated here — the code is formatted by hand and reads consistently.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx,js}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The API surface is typed at the boundary; inside a screen an unused
      // argument is usually a signature being honoured, not a mistake.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Carried over from the design tool unchanged, on purpose: it is the file
    // that produces the contour map, and reformatting it to this project's
    // taste would make future diffs against the prototype unreadable.
    files: ["src/lib/three-d-stage.js"],
    rules: {
      "no-empty": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
);
