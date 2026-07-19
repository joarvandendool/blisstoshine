// Metro-configuratie: de app leeft in apps/mobile binnen de bestaande repo
// (geen npm-workspaces). watchFolders stelt metro in staat om het gedeelde
// pure contractpakket (packages/api-contract) en de taxonomie
// (src/domain/taxonomy) vanaf de repo-root te bundelen. Er wordt bewust
// NIETS anders uit de serverrepo geïmporteerd (geen Prisma, geen src/server).

const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.join(repoRoot, "packages"),
  path.join(repoRoot, "src", "domain"),
];

// Modules altijd uit apps/mobile/node_modules halen (de repo-root heeft een
// eigen node_modules voor Next.js die metro niet mag zien).
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

// Het gedeelde pure contractpakket, als echt pakket opgelost (package.json
// main → src/index.ts). Zelfde alias als tsconfig.
config.resolver.extraNodeModules = {
  "@mondzorgwerkt/api-contract": path.join(repoRoot, "packages", "api-contract"),
};

module.exports = config;
