// Metro has to be told about the workspace.
//
// `@tlon/ontology` never needed this because it is only ever imported as a
// *type* — erased before Metro sees it. `@tlon/design` carries real values, so
// the bundler has to resolve it, which means watching the packages directory
// and mapping the name to it. Without this the app builds in TypeScript and
// fails at runtime, which is the worst of both.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const workspace = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);

config.watchFolders = [path.resolve(workspace, "packages")];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@tlon/design": path.resolve(workspace, "packages/design"),
};
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(workspace, "node_modules"),
];

module.exports = config;
