# Third-Party Notices

ResumeForge itself is licensed under the [Apache License 2.0](LICENSE). The optional **semantic
retrieval** feature (RAG) uses the third-party components listed below. None of them are bundled
with the installer or with a release archive:

- model weights and the isolated Python runtime are **downloaded on first use**, verified against
  SHA-256 values pinned in `backend/app/data/rag-assets.json`, and unpacked into the user data
  directory (`<data>/rag-model/<model-id>-<variant>/` and `<data>/rag-runtime/ort-<version>/`);
- they are **not included in backup packages** (registered as rebuildable runtime-only assets);
- users who choose the **remote** provider download none of them.

The exact artifact names, sizes, checksums, platform coverage and the runtime dependency closure
(onnxruntime + numpy + tokenizers and their transitive dependencies — e.g. protobuf, flatbuffers,
sympy, mpmath, coloredlogs, humanfriendly, packaging, pyreadline3 on Windows and huggingface_hub —
21 wheels per platform) are recorded in `backend/app/data/rag-assets.json`; the per-platform matrix is documented in
[docs/architecture.md](docs/architecture.md) and in the RAG v3 delivery report.

## Components

| Component | Version / form | License | Upstream |
| --- | --- | --- | --- |
| IBM Granite Embedding 97M Multilingual R2 (`ibm-granite/granite-embedding-97m-multilingual-r2`) | ONNX weights + tokenizer files; shipped variant `int8_avx2`, upstream revision pinned in the asset manifest | **Apache-2.0** | <https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2> |
| onnxruntime | 1.31.1 (isolated runtime; per-platform wheel, downloaded only on demand) | **MIT** | <https://github.com/microsoft/onnxruntime> |
| tokenizers | 0.23.3 (isolated runtime closure) | **Apache-2.0** | <https://github.com/huggingface/tokenizers> |
| numpy | 2.5.4 (isolated runtime closure) | **BSD-3-Clause** | <https://numpy.org/> |

Attribution: the Granite embedding model is © IBM Corporation and distributed under the Apache
License 2.0; onnxruntime is © Microsoft Corporation under the MIT License; tokenizers is © Hugging
Face under the Apache License 2.0; NumPy is © the NumPy Developers under the BSD 3-Clause License.

## How the notices are preserved

- The downloaded model artifact keeps the upstream license metadata that ships with the model
  repository (the Apache-2.0 license text is part of the model card/repository, and the tokenizer
  files are covered by the same Apache-2.0 grant).
- The pre-unpacked runtime archive is assembled with `pip download` and is **not repacked into a
  single module**: every Python package keeps its `*.dist-info` directory (including the license
  file) inside the archive, so the license texts remain available on disk after unpacking.
- These components are **not imported globally**: onnxruntime / numpy / tokenizers are only visible
  after the isolated runtime directory is added to `sys.path` for the local provider; a remote-only
  installation never imports or downloads them.

## Remote providers

When the **remote** embedding provider is enabled, requests go to an OpenAI-compatible
`/embeddings` endpoint that the user enters (a preset such as Alibaba Cloud Bailian, OpenAI, Zhipu
or SiliconFlow, a custom URL, or a local Ollama / LM Studio server). ResumeForge does not
redistribute those services; their own terms of service and privacy policies apply to the requests
you choose to send.

## Canonical license texts

- Apache License 2.0: <https://www.apache.org/licenses/LICENSE-2.0>
- MIT License: <https://opensource.org/license/mit>
- BSD 3-Clause License: <https://opensource.org/license/bsd-3-clause>

If you redistribute a build of ResumeForge together with downloaded model/runtime assets, keep
these notices and the license texts shipped by each component with the assets.
