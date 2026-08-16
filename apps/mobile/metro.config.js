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
  // Ontology used to be types-only, which is why the comment above says it never
  // needed this. `foldDrawnFrom` is a value, so now it does.
  "@tlon/ontology": path.resolve(workspace, "packages/ontology"),
  "@tlon/copy": path.resolve(workspace, "packages/copy"),
  // The orb, shared with the web client. Only ever reached from a `.web`
  // module, so three.js stays out of the native bundle entirely.
  "@tlon/headspace": path.resolve(workspace, "packages/headspace"),
  "@tlon/speech": path.resolve(workspace, "packages/speech"),
  // packages/ has no node_modules above it to walk to, so the shared module's
  // bare `three` import needs anchoring at this app's copy.
  three: path.resolve(__dirname, "node_modules/three"),
};
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(workspace, "node_modules"),
];

module.exports = config;
