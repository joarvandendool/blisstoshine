// jest-expo draait de mobiele unit- en contracttests (geen native runtime
// nodig). SecureStore, notificaties en netwerk worden per test gemockt.
module.exports = {
  preset: "jest-expo",
  // Het gedeelde contractpakket leeft buiten de app-map (repo-root).
  roots: ["<rootDir>", "<rootDir>/../../packages/api-contract/src"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@mondzorgwerkt/api-contract$": "<rootDir>/../../packages/api-contract/src",
  },
  setupFiles: ["<rootDir>/jest-setup.js"],
  // Worklets levert een jest-resolver die de .native-varianten (JSI/TurboModule)
  // buiten de testrun houdt.
  resolver: "react-native-worklets/jest/resolver.js",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
};
