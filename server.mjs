import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.txt':'text/plain'};
http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    const file = path.resolve(root,'.'+decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if(!file.startsWith(root+path.sep) || path.relative(root,file).split(path.sep).some(s=>s.startsWith('.'))) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'}).end(data);
  } catch {res.writeHead(404).end('Not found');}
}).listen(Number(process.env.PORT || 4173),'127.0.0.1',()=>console.log('Finst 3D: http://127.0.0.1:4173'));
