// Expo's preset, plus one transform three.js needs.
//
// three ships static class blocks (`static { … }`) in its prebuilt bundle, and
// babel-preset-expo does not enable that syntax, so Metro fails to parse the
// library before it ever gets to bundling it. The plugin is only reached on the
// web export — three is imported from a `.web` module and never enters the
// native bundle — but Babel config is not per-platform, so it lives here.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["@babel/plugin-transform-class-static-block"],
  };
};
