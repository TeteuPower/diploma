import { proteger, desproteger, dpapiDisponivel } from '../server/dpapi';

const d = await dpapiDisponivel();
console.log('DPAPI disponivel:', d);

const segredo = 'senha-super-secreta-com-acentuação-ção-ãé';
const blob = await proteger(segredo);
console.log('blob (primeiros 60):', blob.slice(0, 60));
console.log('blob tem a senha em claro?', blob.includes('senha') ? 'SIM (BUG)' : 'nao');
const volta = await desproteger(blob);
console.log('round-trip bate?', volta === segredo ? 'SIM' : `NAO -> "${volta}"`);
