// The pins: every file the installer may keep, with its size and sha256, and
// where it comes from (docs/spec/0001, S5.9). One table in code. Nothing here is
// read from the network or the environment. A file the table does not name is
// not kept, and a file whose size or sha256 differs is not kept either.
//
// Sources and the hosts a redirect may land on are fixed here. A Hugging Face
// file is named by the full commit it was read at, never a branch. The npm
// tarballs carry the registry's own sha512 integrity beside the sha256.

/** Where a download may start and where a redirect may end, by source. */
export const SOURCES = Object.freeze({
  hf: { origin: 'https://huggingface.co', redirects: ['huggingface.co', 'us.aws.cdn.hf.co'] },
  npm: { origin: 'https://registry.npmjs.org', redirects: [] },
  github: { origin: 'https://github.com', redirects: ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'] },
});

/** Every host the installer and uv contact, for the plan to name. */
export const HOSTS = Object.freeze(['huggingface.co', 'us.aws.cdn.hf.co', 'registry.npmjs.org', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'pypi.org', 'files.pythonhosted.org']);

/** The one CPython uv is asked for, and the one index it may read. */
export const PYTHON = Object.freeze({ version: '3.12.12', index: 'https://pypi.org/simple' });

/** Lock files, one per platform that has wheels for every package. Each is the
 *  output of `uv pip compile --no-config --index-url https://pypi.org/simple
 *  --generate-hashes --only-binary :all: --python-version 3.12 --python-platform
 *  <target> requirements.in`, its two header lines dropped, where requirements.in
 *  holds the lock's own pins. The targets are x86_64-pc-windows-msvc,
 *  x86_64-manylinux_2_28, aarch64-manylinux_2_28, and aarch64-apple-darwin and
 *  x86_64-apple-darwin with MACOSX_DEPLOYMENT_TARGET set to the PYTHON_FLOOR
 *  release below: uv's default macOS target, 13.0, finds no onnxruntime 1.32.0
 *  wheel. Intel Macs pin onnxruntime 1.23.2, the last release with an Intel Mac
 *  wheel, which brings coloredlogs, humanfriendly, sympy and mpmath. */
export const LOCKS = Object.freeze({
  'win32-x64': 'lock-win32-x64.txt',
  'linux-x64': 'lock-linux-x64.txt',
  'linux-arm64': 'lock-linux-arm64.txt',
  'darwin-arm64': 'lock-darwin-arm64.txt',
  'darwin-x64': 'lock-darwin-x64.txt',
});

/** The oldest OS a platform's wheels install on: `release` is the major number
 *  of `os.release()` (Darwin 23 is macOS 14), with the OS's name and the
 *  upstream reason the plan gives below it. */
export const PYTHON_FLOOR = Object.freeze({
  'darwin-arm64': { release: 23, name: 'macOS 14', why: 'onnxruntime 1.32.0 publishes its Apple Silicon wheel for macOS 14 and later only' },
  'darwin-x64': { release: 22, name: 'macOS 13', why: 'onnxruntime 1.23.2, the last release with an Intel Mac wheel, needs macOS 13' },
});

/** The upstream reason a platform has no pinned build of a part, where it is
 *  more than "nothing is published for it". */
export const GAPS = Object.freeze({
  'win32-arm64': {
    addon: 'sherpa-onnx-node 1.13.8 publishes no Windows on ARM addon',
    python: 'not pinned, as the core has no addon here',
  },
});

// The npm tarballs: archives, checked whole, then unpacked; each file they
// yield is checked again. dest is under the runtime folder.
export const ARCHIVES = Object.freeze([
    {
      name: 'sherpa-onnx-node',
      url: '/sherpa-onnx-node/-/sherpa-onnx-node-1.13.8.tgz',
      platform: null,
      dest: 'node_modules/sherpa-onnx-node',
      size: 11954,
      sha256: 'db2a7b8b18d950b6e9ca5c1c919afec33fd3dd2bfef1aade0bea5a9fe7a1f0f1',
      sha512: 'MsDMBdhLFTZ1GwvcGSSQhnS7g/EA8OMH6IYysCVUOM7j8Icty9KRc0E6YT1A5fWBsZwRfKOeh88QC95aRvS8ag==',
      files: [
        ["README.md", 343, '5706568eaac6a98ce8c7da76c5676086010b68254d0a0c307b742cb6357afb0b'],
        ["addon-static-import.js", 2208, '4e1cdabab1dc22ecff6882ea642aba56c6e03c543dd366e684ae5b853dd5f1b6'],
        ["addon.js", 2760, 'ccdfdd81775611bb1b4de2f30fc22a987f9d6936b280c91b6a0c597e02f3c839'],
        ["audio-tagg.js", 1285, '4f38deacb6fd0dddc6adb717f54f515079a2bb8c7c077d45a4f59d7ed88664a5'],
        ["keyword-spotter.js", 1609, 'de79f3c50dba37be650e8f3688f56cd1a6c400f1074d9034ed99f82941e74439'],
        ["non-streaming-asr.js", 4509, '768f5afe411e1f960c0e5c59d6bec8120520461704f2786fb110667ed3eeefea'],
        ["non-streaming-speaker-diarization.js", 1164, 'ec2d8bae9365d6d1d6b43bb6ae31d641c7c7bce3cf31f1adb96cfed0d53b9233'],
        ["non-streaming-speech-denoiser.js", 993, '86b2562f53078f6bfa39895b77984e43556717de94cdf38b39cb9b4d0670ae52'],
        ["non-streaming-tts.js", 3166, '443a757bf1280d632e7dc67bac94446dcf7d12e4987579bcc906a3f2214e2b28'],
        ["online-speech-denoiser.js", 1286, '40c060d62e8080e4d37fbc4bce37273afaadd42ad19ff3f6ce35c008755b7eef'],
        ["package.json", 1676, 'e93e192e89e06d62e45ba583600af3c2f87b01a58f1dff121906714f06d703aa'],
        ["punctuation.js", 1186, '723f7fd4920906418067ad5b63f1e5bdd12ccbce6f9af49c5dfc74e767bbaa2f'],
        ["resampler.js", 2216, '49f0eeaed2d256ad442e56a74182b3848dd276b96351a1adf9ff9a0928162dae'],
        ["sherpa-onnx.js", 2080, '120bb60c0f9042236573236abf44935c8403fa7e27cd6cbb3cbd08fe3900271a'],
        ["speaker-identification.js", 3912, '811ab1d07005c110593bbf3a3e17deeb6b1763b4f46f25c793554a41afa01aa2'],
        ["spoken-language-identification.js", 1120, 'd7faace010316d0eb200e5afbef9fe3a6d2a2dbeab317c7f23fa2e685cb65a26'],
        ["streaming-asr.js", 4576, 'e201af0cf90abbfdd6cb4336c2262d4d85142de09829f7f0f0efe546412d110a'],
        ["types.js", 22161, '76972285fa6459ac409047b08a723b18eb39f1eb04e65bc4c73e1d6e7fdfc526'],
        ["vad.js", 2971, '516759499cfd4479f6feaf8dd81452d8189c4909ad402923dd983fba71496c38'],
      ],
    },
    {
      name: 'sherpa-onnx-win-x64',
      url: '/sherpa-onnx-win-x64/-/sherpa-onnx-win-x64-1.13.8.tgz',
      platform: 'win32-x64',
      dest: 'node_modules/sherpa-onnx-win-x64',
      size: 8894875,
      sha256: 'fe522f02a5c113c2567a43982107ef41ae517f9a431931e90731e7e4d4341073',
      sha512: 'oZF1c9VPOKtMwn83Bboc5XSWL+76BRoyB3eUuVnCknBKxwSULZU2Foia9VHWzU+n4I12rPsP6z6H9Rp1hD9o8g==',
      files: [
        ["README.md", 97, '33cc04186235622d194a4bfe157e50dfa5f99079ceed97d19ace4cb54067d2ed'],
        ["index.js", 49, 'b6db53e997183ee97dd3f565ac0caea4d98f8f8d931c22ba91e0986700f760bc'],
        ["onnxruntime.dll", 17799168, '7f66f939a881baf4f46a2216496798edf4a1429878b646d12674aa62f27d8a25'],
        ["onnxruntime_providers_shared.dll", 104960, '551d0e1fe4c227d8542314ba718d52f4379e0c7bfe729a37c59833a884e27b4d'],
        ["package.json", 1452, 'c9350c0a65f5ea616ce2ae9233a7f405e9a68766a4d4b941a380b6b3dba451d8'],
        ["sherpa-onnx-c-api.dll", 4605952, 'b0801cd8eeead83213c60b92cc004de6f3ac4cd4a9ac7c388c16b97c590f1e99'],
        ["sherpa-onnx-cxx-api.dll", 259584, 'e709c46a63e4b84f3862aa0c843a804040b42ea054a398b420142f6c8e58ec77'],
        ["sherpa-onnx.node", 681984, 'f5fd562bdc4bea167eee8ac981c6acd88c05cc8d2792b67d8951566818e293ca'],
      ],
    },
    {
      name: 'sherpa-onnx-linux-x64',
      url: '/sherpa-onnx-linux-x64/-/sherpa-onnx-linux-x64-1.13.8.tgz',
      platform: 'linux-x64',
      dest: 'node_modules/sherpa-onnx-linux-x64',
      size: 11089653,
      sha256: '13291bcd825da5858ca27a35443e9a2c229a40616c0910086de2db12c5c9312c',
      sha512: '6plnhjagsSeTntCgnlag86hWbs/uZE9Crms1LgOb68/1nKsIQjMd+WG519m+aPwT6TrsBOiEMzrx41t8sL5L5g==',
      files: [
        ["README.md", 94, '7404cc01ddc4bd97dd9722686b44944a5ca88c619cc263988da273e7e67e16d2'],
        ["index.js", 48, '3f0b863d77823f79278c60fae2473c62f7009b2f73ad4541ead097b1c2ade995'],
        ["libonnxruntime.so", 27026609, '4b3607aebd1784b26b6f9b20e4bd974c7ab8287043e4d095cb7d2cb40b5e566e'],
        ["libsherpa-onnx-c-api.so", 5116576, 'b1019f8c9583e3e576c2ba6032b580677fcf6e2230c241a8b423c65aceded021'],
        ["libsherpa-onnx-cxx-api.so", 261840, '795b88737a57f63404c8d17ddd08b5f0c28b5679ee9517cd6766ae95ee6fdb0d'],
        ["package.json", 1454, '1f968d74c36a44be07872cf5d3a8d9f6e9589928e3763632aed81a03127ac096'],
        ["sherpa-onnx.node", 974496, 'd8f1181559e7aecaa99493e8c441c16a4d51a18a1f3fcdf48fd7884e510f3767'],
      ],
    },
    {
      name: 'sherpa-onnx-darwin-arm64',
      url: '/sherpa-onnx-darwin-arm64/-/sherpa-onnx-darwin-arm64-1.13.8.tgz',
      platform: 'darwin-arm64',
      dest: 'node_modules/sherpa-onnx-darwin-arm64',
      size: 10047754,
      sha256: 'e1abc1d9676478996574de922e55714d80b4500b860bc4e7349aa01cd0ea4929',
      sha512: 'FPNgJMgnWVl/KhRTIhG3KL3A4Om63Rn4YKXc9/uHY7SzLcvqLJLc/h7UBWJwduXvv7K18t5NpxHR6XgXn4sjWw==',
      files: [
        ["README.md", 94, '7404cc01ddc4bd97dd9722686b44944a5ca88c619cc263988da273e7e67e16d2'],
        ["index.js", 48, '3f0b863d77823f79278c60fae2473c62f7009b2f73ad4541ead097b1c2ade995'],
        ["libonnxruntime.dylib", 29006384, 'b0613d0ae53199a83b05fa48e169211498e9d40d54beaa372068ebe5ec5b0929'],
        ["libsherpa-onnx-c-api.dylib", 4275368, '6baf16572b925c6d4722a3ffdb7d34c3de6477ba6e587baf8c4573cc3f889ca1'],
        ["libsherpa-onnx-cxx-api.dylib", 161936, '370e7b9e4a198dde7d07390c4aa8a49b0840974271065632fbacbde99a1a615c'],
        ["package.json", 1460, '70ac867468808896163ec3739879efd7a393157cf0bfebf2801e531642c14d95'],
        ["sherpa-onnx.node", 644448, 'e37e09b2b21e0b07abf0c37d7423884a8ff161fdba8c67407bc99bfe99af8a55'],
      ],
    },
    {
      name: 'sherpa-onnx-darwin-x64',
      url: '/sherpa-onnx-darwin-x64/-/sherpa-onnx-darwin-x64-1.13.8.tgz',
      platform: 'darwin-x64',
      dest: 'node_modules/sherpa-onnx-darwin-x64',
      size: 11191481,
      sha256: '3e583d3423160cb8a0f9316008e293ad9a6b66c63e1966ad399a88300390fbaa',
      sha512: '7BLRpjM6w4f9W46/nmkmq8lEKUayhebvcpslCVQ+6QN2uReYlZEMDZlSpXMjme+hUFrPfRz8P3UNq8ep/4d19g==',
      files: [
        ["README.md", 94, '7404cc01ddc4bd97dd9722686b44944a5ca88c619cc263988da273e7e67e16d2'],
        ["index.js", 48, '3f0b863d77823f79278c60fae2473c62f7009b2f73ad4541ead097b1c2ade995'],
        ["libonnxruntime.dylib", 32315856, '2bf27180c09e6fd3f407c9ab25205ebf1ff95f2d53bfa35e35409b5849e0ac70'],
        ["libsherpa-onnx-c-api.dylib", 4594168, '7e9a3df88aed001c9dba2f2bdeceac6045613b6c573bd0223e92b898a04bf283'],
        ["libsherpa-onnx-cxx-api.dylib", 124592, 'e30ba3a85aaa3c235d94dbe10bc21889eed817a39f0b4b8fe7f62693cecb3978'],
        ["package.json", 1456, 'a86b80c7ae03875dad47010aa1ea2ebb4d0e659cad51b3a575f10102824a68f9'],
        ["sherpa-onnx.node", 642472, '73bd986df350a4dda71f081d898aa4bc6ef3f4e105c025b92a4e766360f07972'],
      ],
    },
    {
      name: 'sherpa-onnx-linux-arm64',
      url: '/sherpa-onnx-linux-arm64/-/sherpa-onnx-linux-arm64-1.13.8.tgz',
      platform: 'linux-arm64',
      dest: 'node_modules/sherpa-onnx-linux-arm64',
      size: 13910679,
      sha256: 'e1671ad6e94e51947229a5736d06022780f3fba967da8d917173cd9765902ee8',
      sha512: 'Tlg7a70b/Wge3OF8IgTHF9jhSVCsLyKQKhwc4BsJ5A+dL/SrFtGBjzuHp4XeLhiiOT7afCxX5PdSn/D4c8Lnuw==',
      files: [
        ["README.md", 94, '7404cc01ddc4bd97dd9722686b44944a5ca88c619cc263988da273e7e67e16d2'],
        ["index.js", 48, '3f0b863d77823f79278c60fae2473c62f7009b2f73ad4541ead097b1c2ade995'],
        ["libonnxruntime.so", 34606912, 'cfc800d4438f15e8d9017521326776ca7117d8783cb847ccccc2fc61ac4d540f'],
        ["libsherpa-onnx-c-api.so", 4613032, 'd1b41ded09e00017b37375584792cf697dad8bf35ccd787706acdbc4c7afc912'],
        ["libsherpa-onnx-cxx-api.so", 281200, '49fe5a314d4fc4f13d0a036d26cdea228fb6504547022013350855881bff5b59'],
        ["package.json", 1458, '21465fab6ac026040f5599281e7f304a760958fd251602aff557274b31513ebf'],
        ["sherpa-onnx.node", 804112, 'ae1459b87db45cdc756b45e1cb495466225f62d2dd63eb35bf225196bf20900a'],
      ],
    },
]);

// Files fetched one by one. base is the path on the source's origin; each row
// is [file, size, sha256] and is kept at dest/file.
export const FILES = Object.freeze([
  {
    part: 'hearing',
    src: 'hf',
    base: '/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/84b478d541cdbf0c296a7ab5f1e20a6f8f998114/',
    dest: 'parakeet/',
    files: [
      ["decoder.int8.onnx", 7257753, '4d097bae3bac5c96018d5293ba39f1b657296102b142affda40378f38b020f41'],
      ["encoder.int8.onnx", 652282309, '92a10bd9c23936ea0566c29f963bc57c2a5df4261b6a8921c39abea66557ca8b'],
      ["joiner.int8.onnx", 1739080, '77a29f3e5ac7d37074e0af465391b80f314015d5b97f0f90c6c7767f1d56f428'],
      ["tokens.txt", 9384, 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d'],
    ],
  },
  {
    part: 'detector',
    src: 'github',
    base: '/k2-fsa/sherpa-onnx/releases/download/asr-models/',
    dest: 'vad/',
    files: [['silero_vad.onnx', 643854, '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6']],
  },
  {
    part: 'turn',
    src: 'hf',
    base: '/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/',
    dest: 'smart-turn/',
    files: [
      ["smart-turn-v3.2-cpu.onnx", 8679182, '2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f'],
    ],
  },
  {
    part: 'phonon',
    src: 'hf',
    base: '/gradium/phonon-31m-en/resolve/92741c5b07d085ff840e26fea8ce43110b87852f/',
    dest: 'hf/hub/models--gradium--phonon-31m-en/snapshots/92741c5b07d085ff840e26fea8ce43110b87852f/',
    files: [
      ["config.json", 4634, 'b5d0f88353638370d94035b7d73d7d6577c0554d78f8d7ecfd40490aae39ae85'],
      ["default-voice.safetensors", 256136, 'dc537478eaadc1a5257fcda2e3501ab81e14c111a5d95a5838f350db2afd0f1a'],
      ["model.safetensors", 102823920, '8a04cf833cfe69b67c2ec968b2d31244655b9accc84ade9c0ebcc176f2074607'],
      ["tokenizer.json", 277967, '691a00068fa7b989f2f3e5ae5daa2d1a5bb319f2d5360deafcfb19a8bb6e7936'],
    ],
  },
  {
    part: 'phonon',
    src: 'hf',
    base: '/gradium/phonon-voices/resolve/da6c9ec0d47be8df5c87c730a3aa97187f3229c3/',
    dest: 'hf/hub/models--gradium--phonon-voices/snapshots/da6c9ec0d47be8df5c87c730a3aa97187f3229c3/',
    files: [
      ["voices.jsonl", 33407, '874f34998ce581b94f2b8912aa015639f52b5fd62eba3ba11e1b64dcaed7d802'],
      ["voices/vjFyp2BcCyTlUmYb.safetensors", 256136, '958ea94da14f46dd48c7f64adac11ed2ad2aa45f7ccd165dfebab5272664402e'],
    ],
  },
]);
