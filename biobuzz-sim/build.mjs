import fs from 'fs';
const rd = f => fs.readFileSync(new URL('./src/' + f, import.meta.url), 'utf8');
const files = ['engine.js', 'ai.js', 'render.js', 'fx.js', 'input.js', 'audio.js', 'replay.js', 'hud.js', 'ui.js', 'autoed.js', 'net.js', 'app.js'];
for (const f of files) if (/<\/script/i.test(rd(f))) throw new Error(f + ' contains </script');
let html = rd('markup.html').replace('/*STYLE*/', () => rd('style.css'));
// official FIELD CAD (fieldcad/build_asset.py): inert text the renderer inflates at boot
const cad = fs.existsSync(new URL('./src/fieldcad.b64', import.meta.url)) ? rd('fieldcad.b64').trim() : '';
if (!/^[A-Za-z0-9+/=]*$/.test(cad)) throw new Error('fieldcad.b64 is not base64');
if (cad) html += `\n<script type="text/plain" id="field-cad">${cad.replace(/(.{4000})/g, '$1\n')}</script>`;
const js = files.map(f => `<script${f === 'engine.js' ? ' id="src-engine"' : ''}>\n${rd(f)}\n</script>`).join('\n');
html += `\n<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n${js}\n`;
fs.writeFileSync(new URL('./dist/biobuzz-sim.html', import.meta.url), html);
console.log('built', (html.length / 1024).toFixed(1), 'KB');
