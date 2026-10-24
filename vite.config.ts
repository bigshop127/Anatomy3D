import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
const path=(relative:string)=>fileURLToPath(new URL(relative,import.meta.url));
const pkg=JSON.parse(readFileSync(path('./package.json'),'utf8')) as {version:string};
// GitHub Pages serves the site from /Anatomy3D/ (preview mirrors it); the dev server stays at the root.
export default defineConfig(({command,isPreview})=>({base:command==='build'||isPreview?'/Anatomy3D/':'/',root:path('./web'),publicDir:path('./public'),plugins:[react()],define:{__APP_VERSION__:JSON.stringify(pkg.version)},resolve:{alias:{'@':path('./')}},css:{postcss:{plugins:[tailwindcss()]}},server:{watch:{usePolling:true}},build:{outDir:path('./dist'),emptyOutDir:true}}));
