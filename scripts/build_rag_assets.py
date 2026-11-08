# SPDX-License-Identifier: Apache-2.0
r"""构建 RAG 本地 embedding 资产分发包（产物在 dist/rag-assets/，**不进 git**）。

产物（A 任务书 §3.2）：
- rag-model-granite-embedding-97m-multilingual-r2-int8_avx2.zip：ONNX + tokenizer + configs；
- rag-runtime-<platform>-ort1.31.1.zip：pip download 的完整依赖闭包解包后 zip 根下 site-packages/；
  平台：windows-x64 / macos-arm64 / linux-x64 / linux-arm64（Intel Mac 无 ORT wheel，不产）。
- backend/app/data/rag-assets.json：文件名/大小/sha256/适用平台/ORT 精确版本/model id + 上游 revision。

用法（Windows PowerShell）：
    backend\.venv\Scripts\python.exe scripts\build_rag_assets.py
    backend\.venv\Scripts\python.exe scripts\build_rag_assets.py --only model
    backend\.venv\Scripts\python.exe scripts\build_rag_assets.py --only win-x64 --verify-win

网络：首次构建某平台的 runtime 时用 ``pip download`` 拉完整依赖闭包（不要手挑依赖）；
已有 ``--wheels-cache`` 时直接复用（离线重打包）。真实权重只在 ``runtime/rag_eval/model/``。

**发布**：本脚本不发 Release（执行环境未必有写权限）。产物留在 ``dist/rag-assets/``，
报告里给出待执行的 ``gh release upload <tag> dist/rag-assets/*.zip --clobber``。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist" / "rag-assets"
MANIFEST_PATH = ROOT / "backend" / "app" / "data" / "rag-assets.json"
EVIDENCE_DIR = ROOT / "runtime" / "rag_eval"
DEFAULT_MODEL_DIR = EVIDENCE_DIR / "model"
DEFAULT_WHEELS_CACHE = EVIDENCE_DIR / "v3_runtime_wheels"
VERIFY_INPUT = EVIDENCE_DIR / "embed_input.json"
VERIFY_SPIKE = EVIDENCE_DIR / "embed_output.json"

MODEL_ID = "granite-embedding-97m-multilingual-r2"
MODEL_VARIANT = "int8_avx2"
MODEL_DIM = 384
MODEL_REVISION = "835ad14087e140460703cf0fae09f97d469d65c2"  # HF main，2026-11-08 核对
ORT_VERSION = "1.31.1"
PACKAGES: dict[str, str] = {"onnxruntime": "1.31.1", "numpy": "2.5.4", "tokenizers": "0.23.3"}
GENERATED_AT = "2026-11-08"
ZIP_DATE_TIME = (2020, 1, 1, 0, 0, 0)

#: 模型包里放什么：zip 内文件名 → 上游 HF 路径（HuggingFace 备用源按它逐文件下载）。
MODEL_FILES: tuple[tuple[str, str], ...] = (
    ("onnx_model_quint8_avx2.onnx", "onnx/model_quint8_avx2.onnx"),
    ("tokenizer.json", "tokenizer.json"),
    ("config.json", "config.json"),
    ("tokenizer_config.json", "tokenizer_config.json"),
    ("special_tokens_map.json", "special_tokens_map.json"),
    ("sentence_bert_config.json", "sentence_bert_config.json"),
    ("1_Pooling/config.json", "1_Pooling/config.json"),
)

#: 平台键 → pip --platform / 兼容别名 / zip 文件名。别名是 manylinux 的向后兼容旧标签。
PLATFORMS: dict[str, dict[str, object]] = {
    "windows-x64": {
        "platform": "win_amd64",
        "aliases": [],
        "file": f"rag-runtime-win-x64-ort{ORT_VERSION}.zip",
    },
    "macos-arm64": {
        "platform": "macosx_14_0_arm64",
        "aliases": [],
        "file": f"rag-runtime-macos-arm64-ort{ORT_VERSION}.zip",
    },
    "linux-x64": {
        "platform": "manylinux_2_28_x86_64",
        "aliases": ["manylinux2014_x86_64"],
        "file": f"rag-runtime-linux-x64-ort{ORT_VERSION}.zip",
    },
    "linux-arm64": {
        "platform": "manylinux_2_28_aarch64",
        "aliases": ["manylinux2014_aarch64"],
        "file": f"rag-runtime-linux-arm64-ort{ORT_VERSION}.zip",
    },
}

_UNSUPPORTED = {
    "macos-x64": (
        "onnxruntime 1.31.1 不再发布 macOS x86_64 wheel（1.24.1 起停发）；Intel Mac "
        "没有本地运行时，只能用远程 provider"
    )
}


# ===== 通用工具 =====


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # 末尾必须是**真实换行**：写成两个字符（反斜杠 + n）会让 JSON 解析报 "Extra data"。
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def zip_entries(entries: list[tuple[str, Path]], dest: Path) -> tuple[int, int]:
    """按固定时间戳/属性打 zip（同一输入字节一致）；返回 (压缩后字节, 解压后字节)。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    unpacked = 0
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for arcname, source in sorted(entries):
            unpacked += source.stat().st_size
            info = zipfile.ZipInfo(arcname, date_time=ZIP_DATE_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            info.create_system = 0
            with source.open("rb") as handle, archive.open(info, "w") as output:
                shutil.copyfileobj(handle, output, 1024 * 1024)
    return dest.stat().st_size, unpacked


# ===== 模型包 =====


def build_model_zip(model_dir: Path) -> dict[str, object]:
    """把 ONNX + tokenizer + configs 打成模型 zip，并产出清单里的模型段。"""
    entries: list[tuple[str, Path]] = []
    files: list[dict[str, object]] = []
    for target, upstream in MODEL_FILES:
        source = model_dir / target
        if not source.is_file():
            raise SystemExit(f"模型文件缺失：{source}")
        entries.append((target, source))
        files.append(
            {
                "path": upstream,
                "target": target,
                "bytes": source.stat().st_size,
                "sha256": sha256_file(source),
            }
        )
    zip_name = f"rag-model-{MODEL_ID}-{MODEL_VARIANT}.zip"
    dest = DIST_DIR / zip_name
    compressed, unpacked = zip_entries(entries, dest)
    info = {
        "id": MODEL_ID,
        "upstream_revision": MODEL_REVISION,
        "variant": MODEL_VARIANT,
        "dim": MODEL_DIM,
        "pooling": "cls",
        "normalize": True,
        "file": zip_name,
        "bytes": compressed,
        "sha256": sha256_file(dest),
        "unpacked_bytes": unpacked,
        "files": files,
    }
    print(f"[model] {zip_name} bytes={compressed} sha256={info['sha256'][:12]}")
    return info


# ===== 运行时包 =====


def _wheels_ready(wheels_dir: Path) -> bool:
    names = [path.name for path in wheels_dir.glob("*.whl")] if wheels_dir.is_dir() else []
    return all(any(name.startswith(package + "-") for name in names) for package in PACKAGES)


def ensure_wheels(platform_key: str, wheels_cache: Path) -> Path:
    """按平台拿完整依赖闭包：缓存命中直接复用，否则 pip download（--only-binary:all:）。"""
    config = PLATFORMS[platform_key]
    wheels_dir = wheels_cache / platform_key
    if _wheels_ready(wheels_dir):
        print(f"[runtime:{platform_key}] wheels cache 命中 {wheels_dir}")
        return wheels_dir
    wheels_dir.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "pip",
        "download",
        "--disable-pip-version-check",
        "-d",
        str(wheels_dir),
        "--only-binary=:all:",
        "--python-version",
        "3.12",
        "--implementation",
        "cp",
        "--abi",
        "cp312",
        "--platform",
        str(config["platform"]),
    ]
    for alias in config["aliases"]:  # type: ignore[union-attr]
        command.extend(["--platform", str(alias)])
    command.extend(f"{name}=={version}" for name, version in PACKAGES.items())
    print(f"[runtime:{platform_key}] pip download …")
    subprocess.run(command, check=True)
    if not _wheels_ready(wheels_dir):
        raise SystemExit(f"wheel 闭包不完整：{wheels_dir}")
    return wheels_dir


def build_runtime_zip(platform_key: str, wheels_dir: Path, staging_root: Path) -> dict[str, object]:
    """解包 wheel 闭包到 staging/site-packages，再整体打成运行时 zip。"""
    site = staging_root / "site-packages"
    shutil.rmtree(staging_root, ignore_errors=True)
    site.mkdir(parents=True, exist_ok=True)
    wheels = sorted(wheels_dir.glob("*.whl"))
    for wheel in wheels:
        with zipfile.ZipFile(wheel) as archive:
            archive.extractall(site)
    entries = [
        (f"site-packages/{path.relative_to(site).as_posix()}", path)
        for path in sorted(site.rglob("*"))
        if path.is_file()
    ]
    dest = DIST_DIR / str(PLATFORMS[platform_key]["file"])
    compressed, unpacked = zip_entries(entries, dest)
    info = {
        "file": dest.name,
        "bytes": compressed,
        "sha256": sha256_file(dest),
        "unpacked_bytes": unpacked,
        "wheels": [wheel.name for wheel in wheels],
    }
    print(f"[runtime:{platform_key}] {dest.name} bytes={compressed} sha256={info['sha256'][:12]}")
    return info


def build_manifest(model: dict[str, object], runtime: dict[str, object]) -> dict[str, object]:
    manifest = {
        "schema_version": 1,
        "generated_at": GENERATED_AT,
        "model": model,
        "runtime": {
            "version": ORT_VERSION,
            "packages": dict(PACKAGES),
            "platforms": runtime,
        },
        "unsupported_platforms": dict(_UNSUPPORTED),
    }
    write_json(MANIFEST_PATH, manifest)
    write_json(DIST_DIR / "rag-assets.json", manifest)
    write_json(
        EVIDENCE_DIR / "v3_assets_manifest.json",
        {
            "generated_at": GENERATED_AT,
            "model_revision": MODEL_REVISION,
            "model": {
                "file": model["file"],
                "bytes": model["bytes"],
                "sha256": model["sha256"],
                "unpacked_bytes": model["unpacked_bytes"],
                "files": model["files"],
            },
            "runtime": {
                "version": ORT_VERSION,
                "packages": dict(PACKAGES),
                "platforms": runtime,
            },
            "unsupported_platforms": dict(_UNSUPPORTED),
        },
    )
    print(f"[manifest] {MANIFEST_PATH} + dist/rag-assets/rag-assets.json")
    return manifest


# ===== Windows 真机验证：解包 runtime + 真实 granite 编码 384 维并与 spike 比对 =====


_VERIFY_SCRIPT = r"""
import json, sys, time
from pathlib import Path

from tokenizers import Tokenizer
import onnxruntime as ort

model_dir = Path(sys.argv[1])
input_path = Path(sys.argv[2])
spike_path = Path(sys.argv[3])
output_path = Path(sys.argv[4])
payload = json.loads(input_path.read_text(encoding="utf-8"))
spike = json.loads(spike_path.read_text(encoding="utf-8"))
items = payload["texts"]
tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
tokenizer.enable_truncation(max_length=int(payload.get("max_length") or 512))
onnx_files = sorted(model_dir.glob("*.onnx"))
session = ort.InferenceSession(str(onnx_files[0]), providers=["CPUExecutionProvider"])
input_names = {item.name for item in session.get_inputs()}
pad_id = tokenizer.token_to_id("[PAD]")
pad_id = 0 if pad_id is None else pad_id

def _normalized(sequence):
    pooled = [float(value) for value in sequence[0]]  # cls pooling（与 1_Pooling/config.json 一致）
    norm = sum(value * value for value in pooled) ** 0.5
    return [value / norm for value in pooled]

def encode_all(batch_size):
    vectors, per_text_ms = {}, []
    step = max(1, int(batch_size))
    for start in range(0, len(items), step):
        batch = items[start : start + step]
        started = time.perf_counter()
        encodings = [tokenizer.encode(item["text"]) for item in batch]
        width = max(len(encoding.ids) for encoding in encodings)
        feed = {"input_ids": [list(e.ids) + [pad_id] * (width - len(e.ids)) for e in encodings]}
        if "attention_mask" in input_names:
            feed["attention_mask"] = [list(e.attention_mask) + [0] * (width - len(e.attention_mask)) for e in encodings]
        if "token_type_ids" in input_names:
            feed["token_type_ids"] = [list(e.type_ids) + [0] * (width - len(e.type_ids)) for e in encodings]
        outputs = session.run(None, feed)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        per_text_ms.extend([elapsed_ms / len(batch)] * len(batch))
        for item, sequence in zip(batch, outputs[0], strict=True):
            vectors[item["id"]] = _normalized(sequence)
    per_text_ms.sort()
    p95 = per_text_ms[min(len(per_text_ms) - 1, int(len(per_text_ms) * 0.95))]
    return vectors, p95

def diff_vs_spike(vectors):
    diffs = []
    for key, values in spike["vectors"].items():
        ours = vectors.get(key)
        if ours is None:
            raise SystemExit(f"missing vector for {key}")
        diffs.append(max(abs(a - b) for a, b in zip(values, ours, strict=True)))
    return max(diffs)

first, p95_batched = encode_all(32)
second, _ = encode_all(32)
batch1, p95_batch1 = encode_all(1)
result = {
    "dim": len(next(iter(first.values()))),
    "pooling": "cls",
    "texts": len(first),
    "runs_per_mode": 2,
    "deterministic_batched": first == second,
    "max_abs_diff_vs_spike_batched": diff_vs_spike(first),
    "max_abs_diff_vs_spike_batch1": diff_vs_spike(batch1),
    "p95_encode_ms_per_text_batched": p95_batched,
    "p95_encode_ms_per_text_batch1": p95_batch1,
    "onnx_file": onnx_files[0].name,
    "input_names": sorted(input_names),
}
output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
"""


def verify_windows(
    model_info: dict[str, object], runtime_info: dict[str, object], staging_root: Path
) -> dict[str, object]:
    """用**解包后的 Windows runtime zip** + 系统 Python（无预装 ORT）跑真实模型编码。

    系统 Python 里没有任何 numpy/onnxruntime，能跑通才证明 zip 的依赖闭包是完整的。
    """
    base_python = Path(sys.base_prefix) / "python.exe"
    if not base_python.is_file():
        raise SystemExit(f"找不到系统 Python：{base_python}")
    workdir = staging_root / "verify"
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(DIST_DIR / str(runtime_info["file"])) as archive:
        archive.extractall(workdir / "runtime")
    with zipfile.ZipFile(DIST_DIR / str(model_info["file"])) as archive:
        archive.extractall(workdir / "model")
    verify_script = workdir / "verify_win.py"
    verify_script.write_text(_VERIFY_SCRIPT, encoding="utf-8")
    result_path = workdir / "result.json"
    env = dict(os.environ)
    env["PYTHONPATH"] = str(workdir / "runtime" / "site-packages")
    subprocess.run(
        [
            str(base_python),
            "-s",
            str(verify_script),
            str(workdir / "model"),
            str(VERIFY_INPUT),
            str(VERIFY_SPIKE),
            str(result_path),
        ],
        check=True,
        env=env,
    )
    result = json.loads(result_path.read_text(encoding="utf-8"))
    evidence = {
        "provider": "local-onnx",
        "platform": "windows-x64",
        "model": MODEL_ID,
        "variant": MODEL_VARIANT,
        "model_file": model_info["file"],
        "model_sha256": model_info["sha256"],
        "runtime_file": runtime_info["file"],
        "runtime_sha256": runtime_info["sha256"],
        "ort_version": ORT_VERSION,
        "real_model_verified_on_host": True,
        **result,
    }
    write_json(EVIDENCE_DIR / "v3_local_provider.json", evidence)
    print(
        f"[verify-win] dim={result['dim']} deterministic_batched={result['deterministic_batched']} "
        f"diff_batch1={result['max_abs_diff_vs_spike_batch1']:.3e} "
        f"diff_batched={result['max_abs_diff_vs_spike_batched']:.3e} "
        f"p95_batch1={result['p95_encode_ms_per_text_batch1']:.1f}ms "
        f"p95_batched={result['p95_encode_ms_per_text_batched']:.1f}ms"
    )
    return evidence


# ===== 主流程 =====


def main() -> int:
    parser = argparse.ArgumentParser(description="构建 RAG 本地资产分发包")
    parser.add_argument(
        "--only", default="all", help="all | model | runtime | manifest | verify-win"
    )
    parser.add_argument("--platform", default="all", help="运行时平台键，逗号分隔；默认全部")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--wheels-cache", type=Path, default=DEFAULT_WHEELS_CACHE)
    parser.add_argument("--verify-win", action="store_true", help="构建后跑 Windows 真机验证")
    args = parser.parse_args()

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    staging_root = Path(tempfile.mkdtemp(prefix="rf-rag-assets-", dir=str(EVIDENCE_DIR)))
    try:
        model_info: dict[str, object] | None = None
        runtime_info: dict[str, object] = {}
        if args.only in ("all", "model"):
            model_info = build_model_zip(args.model_dir)
        if args.only in ("all", "runtime"):
            keys = (
                [key for key in PLATFORMS if args.platform in ("all", key)]
                if args.platform != "all"
                else list(PLATFORMS)
            )
            for index, key in enumerate(keys):
                wheels = ensure_wheels(key, args.wheels_cache)
                runtime_info[key] = build_runtime_zip(key, wheels, staging_root / f"stage-{key}")
                if index + 1 < len(keys):
                    shutil.rmtree(staging_root / f"stage-{key}", ignore_errors=True)
        if args.only in ("all", "manifest"):
            evidence = json.loads(
                (EVIDENCE_DIR / "v3_assets_manifest.json").read_text(encoding="utf-8")
            )
            if model_info is None:
                # evidence manifest 的 model 段只存资产事实（file/bytes/sha/files），
                # 模型身份字段由常量补齐，保证 app manifest 的 id/variant/dim 永不缺。
                model_info = {
                    "id": MODEL_ID,
                    "upstream_revision": MODEL_REVISION,
                    "variant": MODEL_VARIANT,
                    "dim": MODEL_DIM,
                    "pooling": "cls",
                    "normalize": True,
                    **evidence["model"],
                }
            merged = dict(evidence["runtime"])
            merged.update(runtime_info)  # 本次新构建的平台优先
            build_manifest(model_info, merged)
        if args.verify_win:
            evidence = json.loads(
                (EVIDENCE_DIR / "v3_assets_manifest.json").read_text(encoding="utf-8")
            )
            verify_windows(
                model_info or evidence["model"],
                runtime_info.get("windows-x64") or evidence["runtime"]["platforms"]["windows-x64"],
                staging_root,
            )
        print("[done] 产物在", DIST_DIR)
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
