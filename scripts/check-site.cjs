const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let checked = 0;
const failures = [];

function check(source, filename) {
    try { new vm.Script(source, {filename}); checked++; }
    catch (error) { failures.push(error.stack); }
}

function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
        if (entry.name.startsWith('.') || ['node_modules','scratch','__pycache__'].includes(entry.name)) continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) { walk(filename); continue; }
        if (/\.(js|cjs)$/.test(entry.name)) check(fs.readFileSync(filename,'utf8'), filename);
        if (!entry.name.endsWith('.html')) continue;
        const html = fs.readFileSync(filename,'utf8');
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
            const type = match[1].match(/\btype=["']([^"']+)["']/i)?.[1];
            if (type && !['text/javascript','application/javascript'].includes(type)) continue;
            if (/\bsrc\s*=/.test(match[1])) continue;
            const line = html.slice(0,match.index).split('\n').length;
            check(match[2], `${path.relative(root,filename)} (script starts at line ${line})`);
        }
    }
}
walk(root);
JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
if (failures.length) {
    console.error(failures.join('\n\n'));
    process.exitCode = 1;
} else console.log(`PASS: ${checked} JavaScript scripts checked across the site.`);
