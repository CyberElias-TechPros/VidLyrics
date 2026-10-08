import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HF_BASE, PATH_MAP } from '@mintplex-labs/piper-tts-web';

const voices = JSON.parse(await readFile(new URL('../model-voices.json', import.meta.url), 'utf8'));

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const publicRoot = join(appRoot, 'public');
const outputRoot = join(publicRoot, 'models');
const tempRoot = join(appRoot, '.model-download-staging');
const maxChunkBytes = 20 * 1024 * 1024;
const dryRun = process.argv.includes('--dry-run');
const whisperSources = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
};

function digestFile(path, algorithm = 'sha256') {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash(algorithm);
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveDigest(hash.digest('hex')));
  });
}

async function download(url, destination, expected = null) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${url} (HTTP ${response.status}). The bundled-model build needs access to Hugging Face.`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  const info = await stat(destination);
  const sha256 = await digestFile(destination);
  const md5 = expected?.md5 ? await digestFile(destination, 'md5') : undefined;
  if (expected?.bytes && info.size !== expected.bytes) {
    throw new Error(`Unexpected size for ${url}: got ${info.size}, expected ${expected.bytes}.`);
  }
  if (expected?.md5 && md5 !== expected.md5) {
    throw new Error(`Piper voice checksum mismatch for ${url}; refusing to ship an unverified model.`);
  }
  return { path: destination, bytes: info.size, sha256, ...(md5 ? { md5 } : {}) };
}

async function splitIntoChunks(source, logicalPath, assetVersion, contentType) {
  const fileInfo = await stat(source.path);
  const input = await open(source.path, 'r');
  const chunks = [];
  let offset = 0;
  let index = 0;
  try {
    while (offset < fileInfo.size) {
      const length = Math.min(maxChunkBytes, fileInfo.size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await input.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new Error(`Could not read the complete model file ${source.path}.`);
      const extension = index === 0 && fileInfo.size <= maxChunkBytes ? '.part' : `.part-${String(index).padStart(3, '0')}`;
      const outputRelative = `${logicalPath}${extension}`;
      const outputPath = join(outputRoot, assetVersion, outputRelative);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, buffer);
      chunks.push({
        url: `/models/${assetVersion}/${outputRelative}`,
        bytes: bytesRead,
        sha256: createHash('sha256').update(buffer).digest('hex')
      });
      offset += bytesRead;
      index += 1;
    }
  } finally {
    await input.close();
  }
  return { url: `/models/${assetVersion}/${logicalPath}`, bytes: fileInfo.size, sha256: source.sha256, contentType, chunks };
}

function aggregateBundleId(descriptors) {
  const canonical = descriptors
    .map((descriptor) => `${descriptor.id}\u001f${descriptor.sha256}\u001f${descriptor.bytes}`)
    .sort()
    .join('\u001e');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

async function readStaticVoiceData() {
  const packageModule = import.meta.resolve('@mintplex-labs/piper-tts-web');
  const distPath = dirname(fileURLToPath(packageModule));
  const staticModuleFile = (await readdir(distPath)).find((name) => /^voices_static-.*\.js$/.test(name));
  if (!staticModuleFile) throw new Error('Piper voice metadata was not found in the installed package.');
  const module = await import(pathToFileURL(join(distPath, staticModuleFile)).href);
  return module.default;
}

if (dryRun) {
  const staticVoices = await readStaticVoiceData();
  console.log('Model pack contents (build-time bundle; model weights are served by this app):');
  console.log(`  Whisper Tiny: ${whisperSources.tiny}`);
  console.log(`  Whisper Base: ${whisperSources.base}`);
  for (const voice of voices) {
    const path = PATH_MAP[voice.id];
    const entry = staticVoices[voice.id];
    if (!path || !entry) throw new Error(`Piper voice ${voice.id} has no installed model metadata.`);
    const configPath = `${path}.json`;
    const licensePath = `${path.slice(0, path.lastIndexOf('/') + 1)}MODEL_CARD`;
    const modelInfo = entry.files?.[path];
    const configInfo = entry.files?.[configPath];
    const licenseInfo = entry.files?.[licensePath];
    if (!modelInfo || !configInfo || !licenseInfo) {
      throw new Error(`Piper voice ${voice.id} must have an ONNX file, config, and upstream MODEL_CARD.`);
    }
    console.log(`  Piper ${voice.id}: ${modelInfo.size_bytes.toLocaleString()} bytes; config and MODEL_CARD verified`);
  }
  console.log(`Chunk limit: ${maxChunkBytes / 1024 / 1024} MiB. Use npm run build for a release including all weights.`);
  process.exit(0);
}

await rm(tempRoot, { recursive: true, force: true });
await mkdir(tempRoot, { recursive: true });
const downloaded = [];
let whisperLicense;
let outputStarted = false;
try {
  const whisperLicensePath = join(tempRoot, 'whisper-MIT.txt');
  await writeFile(whisperLicensePath, await readFile(join(appRoot, 'model-licenses/whisper-MIT.txt')));
  const whisperLicenseInfo = await stat(whisperLicensePath);
  whisperLicense = { path: whisperLicensePath, bytes: whisperLicenseInfo.size, sha256: await digestFile(whisperLicensePath) };
  for (const [id, url] of Object.entries(whisperSources)) {
    downloaded.push({ id: `whisper:${id}`, type: 'whisper', name: id, sourceUrl: url, file: await download(url, join(tempRoot, `${id}.bin`)) });
  }

  const staticVoices = await readStaticVoiceData();
  for (const voice of voices) {
    const path = PATH_MAP[voice.id];
    const entry = staticVoices[voice.id];
    if (!path || !entry) throw new Error(`Piper voice ${voice.id} has no installed model metadata.`);
    const cardPath = Object.keys(entry.files).find((name) => name.endsWith('/MODEL_CARD'));
    const files = [path, `${path}.json`, ...(cardPath ? [cardPath] : [])];
    const outputs = {};
    for (const sourcePath of files) {
      const expected = entry.files[sourcePath];
      if (!expected) throw new Error(`Piper metadata for ${voice.id} is missing ${sourcePath}.`);
      const suffix = sourcePath.endsWith('/MODEL_CARD') ? 'MODEL_CARD' : sourcePath.endsWith('.json') ? 'config.json' : 'model.onnx';
      outputs[suffix] = await download(`${HF_BASE}/${sourcePath}`, join(tempRoot, `${voice.id}-${suffix}`), expected);
    }
    if (!outputs.MODEL_CARD) {
      throw new Error(`No Piper MODEL_CARD was found for ${voice.id}; refusing to package a voice without its attribution/licence file.`);
    }
    downloaded.push({
      id: `piper:${voice.id}:model`, type: 'piper', name: voice.id, sourcePath: path, sourceUrl: `${HF_BASE}/${path}`,
      model: outputs['model.onnx'], config: outputs['config.json'], license: outputs.MODEL_CARD
    });
  }

  const descriptors = [{ id: 'license:whisper', bytes: whisperLicense.bytes, sha256: whisperLicense.sha256 }];
  for (const item of downloaded) {
    if (item.type === 'whisper') descriptors.push({ id: item.id, bytes: item.file.bytes, sha256: item.file.sha256 });
    else {
      descriptors.push({ id: `${item.id}:onnx`, bytes: item.model.bytes, sha256: item.model.sha256 });
      descriptors.push({ id: `${item.id}:config`, bytes: item.config.bytes, sha256: item.config.sha256 });
      descriptors.push({ id: `${item.id}:license`, bytes: item.license.bytes, sha256: item.license.sha256 });
    }
  }
  const bundleId = aggregateBundleId(descriptors);
  await rm(outputRoot, { recursive: true, force: true });
  outputStarted = true;
  await mkdir(outputRoot, { recursive: true });

  const whisper = {};
  const piper = {};
  const whisperLicenseBundle = await splitIntoChunks(
    whisperLicense,
    `licenses/whisper-MIT.txt`,
    whisperLicense.sha256.slice(0, 24),
    'text/plain; charset=utf-8'
  );
  for (const item of downloaded) {
    if (item.type === 'whisper') {
      const file = await splitIntoChunks(item.file, `whisper/${item.name}.bin`, item.file.sha256.slice(0, 24), 'application/octet-stream');
      whisper[item.name] = { ...file, version: item.file.sha256 };
      continue;
    }
    const version = createHash('sha256').update(`${item.model.sha256}\u001f${item.config.sha256}`).digest('hex');
    const model = await splitIntoChunks(item.model, `piper/${item.name}.onnx`, version.slice(0, 24), 'application/octet-stream');
    const config = await splitIntoChunks(item.config, `piper/${item.name}.onnx.json`, version.slice(0, 24), 'application/json');
    const license = await splitIntoChunks(item.license, `licenses/${item.name}-MODEL_CARD`, item.license.sha256.slice(0, 24), 'text/plain; charset=utf-8');
    piper[item.name] = {
      version,
      upstreamPath: item.sourcePath,
      bytes: item.model.bytes + item.config.bytes,
      onnx: model,
      config,
      license
    };
  }

  const manifest = {
    schemaVersion: 1,
    bundleId,
    generatedAt: new Date().toISOString(),
    whisper,
    piper,
    licenses: { whisper: whisperLicenseBundle },
    attributions: {
      whisper: 'Whisper.cpp model weights from ggerganov/whisper.cpp on Hugging Face. See https://github.com/ggerganov/whisper.cpp for source and licence.',
      piper: 'Piper voice weights are individually licensed. The corresponding upstream MODEL_CARD is included for every bundled voice under the versioned licenses/ directory.'
    }
  };
  await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const totalBytes = descriptors.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`Bundled ${downloaded.length} model assets (${(totalBytes / 1_048_576).toFixed(1)} MiB), pack ${bundleId}.`);
  console.log(`Model pack: ${relative(appRoot, outputRoot)}/manifest.json`);
} catch (error) {
  if (outputStarted) await rm(outputRoot, { recursive: true, force: true }).catch(() => undefined);
  throw error;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
