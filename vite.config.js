const path = require('node:path');
const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig({
  root: path.resolve(__dirname, 'client'),
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST || '0.0.0.0',
    port: Number(process.env.VITE_PORT || 5173),
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    root: __dirname,
    include: ['test/**/*.{test,spec}.{js,jsx}'],
    setupFiles: path.resolve(__dirname, 'test/setup.js'),
    deps: {
      optimizer: {
        web: {
          enabled: false,
        },
      },
    },
  },
});
