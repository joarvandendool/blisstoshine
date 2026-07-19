// ESLint flat config — expo-standaard.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", ".expo/*", "node_modules/*"],
  },
  {
    rules: {
      // Experimentele regel (react-hooks v6) die het standaard
      // "fetch in effect → setState na await"-patroon vals-positief markeert.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["src/__tests__/**"],
    rules: {
      // jest.mock-hoisting vereist mocks vóór de imports.
      "import/first": "off",
    },
  },
]);
