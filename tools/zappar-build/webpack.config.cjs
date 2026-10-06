const path = require('path');

module.exports = {
  mode: 'production',
  entry: './entry.js',
  output: {
    path: path.resolve(__dirname, '../../vendor/zappar-aframe'),
    filename: 'zappar-aframe.js',
    publicPath: 'auto',                     // workers and .wasm load relative to zappar-aframe.js
    library: { name: 'ZapparAFrame', type: 'self' },  // 'self' works in the page and in Zappar's workers
    chunkFilename: 'zappar-[name].[contenthash:8].js',
    assetModuleFilename: '[name].[contenthash:8][ext]',
    clean: true,
  },
  // Use A-Frame's own three.js so Zappar's camera texture works with A-Frame's renderer.
  externals: { three: 'var AFRAME.THREE', aframe: 'var AFRAME' },
  module: {
    rules: [
      { test: /\.(wasm|zbin)$/, type: 'asset/resource' },
      { test: /\.m?js$/, resolve: { fullySpecified: false } },
    ],
  },
  // Keep each Zappar worker in one file (no further chunk loading), so js/worker-shim.js can start it
  // from a blob: URL. ZapWorks serves pages cross-origin isolated (COEP: require-corp), which blocks
  // worker scripts that lack their own COEP header; blob workers inherit the page's policy instead.
  optimization: { splitChunks: false },
  performance: { hints: false },
};
