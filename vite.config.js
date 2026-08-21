const path = require('node:path');
const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig({
  root: path.resolve(__dirname, 'client'),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
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
  },
});
