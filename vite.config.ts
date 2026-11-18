import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { selectDataMode } from './src/lib/dataMode';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const dataMode = selectDataMode({ ...env, ...process.env });
  return {
    define: { __AFW_DATA_MODE__: JSON.stringify(dataMode) },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: 'es2020',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('firebase')) {
                return 'vendor-firebase';
              }
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
              if (id.includes('motion')) {
                return 'vendor-motion';
              }
              if (id.includes('react-quill-new') || id.includes('quill')) {
                return 'vendor-editor';
              }
              if (id.includes('i18next') || id.includes('react-i18next')) {
                return 'vendor-i18n';
              }
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
                return 'vendor-react';
              }
            }
          },
        },
      },
    },
    server: {
      proxy: dataMode === 'emulator'?{'/google.firestore.v1.Firestore':{target:'http://127.0.0.1:8080',changeOrigin:true},'/v1/projects':{target:'http://127.0.0.1:8080',changeOrigin:true},'/identitytoolkit.googleapis.com':{target:'http://127.0.0.1:9099',changeOrigin:true},'/securetoken.googleapis.com':{target:'http://127.0.0.1:9099',changeOrigin:true},'/emulator':{target:'http://127.0.0.1:9099',changeOrigin:true}}:undefined,
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
