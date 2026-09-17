/**
 * O comparador de versões e o leitor de releases são o que decide se o app
 * troca a si mesmo. Erro aqui é o app se "atualizando" para uma versão mais
 * velha, ou ignorando a nova — e os dois são silenciosos.
 */
import {
  normalizarVersao, partesDe, ehMaisNova, versaoDoNome, analisarRelease, escolher,
} from '../server/atualizacao';

let falhas = 0;
const checa = (nome: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '  ok  ' : '  FALHA'} ${nome}${extra ? ` — ${extra}` : ''}`);
  if (!ok) falhas += 1;
};

console.log('Versões:');
checa('normaliza "v1.4.0"', normalizarVersao('v1.4.0') === '1.4.0');
checa('normaliza "V2.0"', normalizarVersao(' V2.0 ') === '2.0');
checa('partes de "1.2" completa com zero', JSON.stringify(partesDe('1.2')) === '[1,2,0]');
checa('partes de "1.2.3-beta" ignora sufixo', JSON.stringify(partesDe('1.2.3-beta')) === '[1,2,3]');
checa('partes de "latest" é null', partesDe('latest') === null);
checa('1.10.0 > 1.9.9', ehMaisNova('1.10.0', '1.9.9'));
checa('1.2.0 > 1.2', !ehMaisNova('1.2.0', '1.2') && !ehMaisNova('1.2', '1.2.0'));
checa('2.0 > 1.99.99', ehMaisNova('2.0', '1.99.99'));
checa('igual não é mais nova', !ehMaisNova('1.1.0', '1.1.0'));
checa('"latest" nunca é mais nova', !ehMaisNova('latest', '0.0.1'));
checa('versão do nome do instalador', versaoDoNome('Diploma-Setup-1.5.0.exe') === '1.5.0');
checa('versão do título da release', versaoDoNome('Build 1.5.2 (master)') === '1.5.2');

console.log('\nLeitura de release:');
const repo = 'TeteuPower/diploma';
const numerada = {
  tag_name: 'v1.3.0',
  name: 'Diploma v1.3.0',
  body: 'notas',
  html_url: 'https://github.com/TeteuPower/diploma/releases/tag/v1.3.0',
  assets: [
    { name: 'Diploma-Setup-1.3.0.exe', browser_download_url: 'https://x/1.3.0.exe', size: 10 },
  ],
};
const r1 = analisarRelease(numerada, repo);
checa('tag numérica manda na versão', r1?.versao === '1.3.0');
checa('pega a URL do instalador', r1?.urlDownload === 'https://x/1.3.0.exe');

// O canal "latest": tag fixa, versão vem do nome do .exe — e pode haver mais de
// um .exe (build antiga que ficou). Vale o maior, nunca o primeiro.
const canal = {
  tag_name: 'latest',
  name: 'Build 1.4.1 (master)',
  prerelease: true,
  assets: [
    { name: 'Diploma-Setup-1.4.0.exe', browser_download_url: 'https://x/1.4.0.exe', size: 1 },
    { name: 'Diploma-Setup-1.4.1.exe', browser_download_url: 'https://x/1.4.1.exe', size: 2 },
    { name: 'outra-coisa.zip', browser_download_url: 'https://x/z.zip', size: 3 },
  ],
};
const r2 = analisarRelease(canal, repo);
checa('canal latest: versão vem do MAIOR instalador anexado', r2?.versao === '1.4.1', r2?.versao);
checa('canal latest: URL é a do maior', r2?.urlDownload === 'https://x/1.4.1.exe');
checa('ignora anexo que não é Diploma-Setup-*.exe', r2?.bytes === 2);

const semInstalador = { tag_name: 'v9.9.9', assets: [{ name: 'notas.txt', browser_download_url: 'https://x/n' }] };
checa('release sem instalador é descartada', analisarRelease(semInstalador, repo) === null);

const deOutroApp = { tag_name: 'v9.9.9', assets: [{ name: 'ClaudeIndicator-Setup-9.9.9.exe', browser_download_url: 'https://x/ci' }] };
checa('instalador de outro app não conta', analisarRelease(deOutroApp, repo) === null);

console.log('\nEscolha entre releases:');
const lista = [
  { ...numerada, tag_name: 'v1.3.0', assets: [{ name: 'Diploma-Setup-1.3.0.exe', browser_download_url: 'https://x/a' }] },
  { tag_name: 'v1.2.0', assets: [{ name: 'Diploma-Setup-1.2.0.exe', browser_download_url: 'https://x/b' }] },
  { tag_name: 'v2.0.0', draft: true, assets: [{ name: 'Diploma-Setup-2.0.0.exe', browser_download_url: 'https://x/c' }] },
  canal,
];
checa('sem pré-release: maior é a 1.3.0 (draft 2.0.0 ignorado)', escolher(lista, repo, false)?.versao === '1.3.0');
checa('com pré-release: a 1.4.1 do canal latest vence', escolher(lista, repo, true)?.versao === '1.4.1');
checa('lista vazia → null', escolher([], repo, true) === null);

// A versão instalada vem do package.json publicado. O smoke test do layout
// instalado a viu como 0.0.0: o BOM que o PowerShell 5.1 grava por padrão
// derrubava o JSON.parse. Com 0.0.0, TODA release seria "mais nova".
console.log('\nLeitura da versão instalada:');
{
  const { lerVersaoDe } = await import('../server/env');
  const { writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = tmpdir();
  const comBom = join(dir, 'diploma-pkg-bom.json');
  const semBom = join(dir, 'diploma-pkg.json');
  writeFileSync(comBom, '﻿{"name":"x","version":"9.9.9"}', 'utf8');
  writeFileSync(semBom, '{"name":"x","version":"8.8.8"}', 'utf8');
  checa('lê a versão com BOM (PowerShell 5.1)', lerVersaoDe(comBom) === '9.9.9', lerVersaoDe(comBom));
  checa('lê a versão sem BOM', lerVersaoDe(semBom) === '8.8.8');
  checa('arquivo ausente → 0.0.0 (e não exceção)', lerVersaoDe(join(dir, 'nao-existe.json')) === '0.0.0');
  rmSync(comBom, { force: true });
  rmSync(semBom, { force: true });
}

console.log(`\n${falhas === 0 ? '✅ tudo passou' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
