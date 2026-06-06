import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the repo name so asset URLs resolve on GitHub Pages:
//   https://flsilvat.github.io/amadeus-tracker/
export default defineConfig({
  plugins: [react()],
  base: '/amadeus-tracker/',
});
