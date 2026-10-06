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
  performance: { hints: false },
};
