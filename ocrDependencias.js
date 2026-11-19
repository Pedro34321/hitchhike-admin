import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.env.CNH_MODULOS||new URL('./package.json',import.meta.url));
export const {createCanvas}=require('@napi-rs/canvas');
export const jsQR=require('jsqr');
export const {getDocument,OPS}=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
