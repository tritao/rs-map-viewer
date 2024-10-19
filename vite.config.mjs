import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import glsl from 'vite-plugin-glsl';
import Terminal from 'vite-plugin-terminal'
import { resolve } from 'path';

export default defineConfig(({ command, mode, isSsrBuild, isPreview }) => {

    return {
        plugins: [
            react(),
            glsl(),
            ...(mode === 'development' ? [Terminal({
                console: 'terminal',
                output: ['terminal', 'console']
            })] : [])
        ],
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src'),
            },
        },
        server: {
            headers: {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp",
            },
            open: true,
        },
        build: {
            rollupOptions: {
                output: {
                    assetFileNames: 'assets/[name].[hash][extname]',
                },
            },
        },
        worker: {
            format: "es"
        }
    }
});
