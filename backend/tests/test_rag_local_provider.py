# SPDX-License-Identifier: Apache-2.0
"""本地 provider / 运行时注入 / 本地设置流程测试（全离线，不 import 真实 onnxruntime）。

provider 的推理路径用假的 tokenizer/session 验证：batch 内 padding（防变长 list-of-list
送 ORT 崩溃）、前缀/归一化/维度与自检；运行时注入用 tmp site-packages 里的 stub 包验证
sys.path 注入 / 版本自检 / 卸载；activate_local 用假 manifest 资产 + 假自检写真实
embedding_settings（conftest 已把 global_settings 指到测试目录）。
"""

import sys
from types import SimpleNamespace

import pytest
from app.services.llm import embeddings_local as emb
from app.services.llm.embeddings import EmbeddingError, EmbeddingModelSpec
from app.services.rag import rag_local_setup as setup
from app.services.rag import rag_runtime_loader as loader


def _spec(**overrides) -> EmbeddingModelSpec:
    values = {
        "provider": "local-onnx",
        "model": "granite-embedding-97m-multilingual-r2",
        "dim": 8,
        "pooling": "cls",
        "normalize": True,
    }
    values.update(overrides)
    return EmbeddingModelSpec(**values)


# ===== 假 tokenizer / session（验证 padding 与池化，不碰真实 ORT） =====


class _Encoding:
    def __init__(self, ids: list[int]) -> None:
        self.ids = ids
        self.attention_mask = [1] * len(ids)
        self.type_ids = [0] * len(ids)


class _FakeTokenizer:
    def __init__(self) -> None:
        self.seen: list[str] = []

    def encode_batch(self, texts: list[str]) -> list[_Encoding]:
        self.seen.extend(texts)
        # 长度按词数变化，制造"变长 batch"。
        return [_Encoding([7, 8] * len(text.split()) + [9]) for text in texts]


class _FakeSession:
    def __init__(self, dim: int = 8) -> None:
        self.feeds: list[dict] = []
        self.dim = dim

    def run(self, _names, feed: dict) -> list:
        self.feeds.append(feed)
        batch = []
        for row in feed["input_ids"]:
            batch.append(
                [
                    [float((token + position) % 13) / 13.0 for position in range(self.dim)]
                    for token in row
                ]
            )
        return [batch]


def _fake_model(dim: int = 8) -> emb._LoadedModel:
    return emb._LoadedModel(
        tokenizer=_FakeTokenizer(),
        session=_FakeSession(dim),
        input_names={"input_ids", "attention_mask"},
        pooling="cls",
        dim=dim,
        pad_id=0,
    )


def _patch_model(monkeypatch, model):
    monkeypatch.setattr(emb, "_load_model", lambda *_a, **_k: model)


# ===== provider 推理路径 =====


async def test_provider_pads_variable_length_batch(monkeypatch, tmp_path):
    model = _fake_model()
    _patch_model(monkeypatch, model)
    provider = emb.LocalOnnxEmbeddingProvider(_spec(), model_dir=tmp_path)
    texts = ["数据"] * 32 + ["数据 增长 分析"]
    batch = await provider.embed_documents(texts)
    assert len(batch.vectors) == 33 and batch.dim == 8 and batch.model == _spec().model
    assert len(model.session.feeds) == 2  # 32 + 1
    for feed in model.session.feeds:
        widths = {len(row) for row in feed["input_ids"]}
        widths |= {len(row) for row in feed["attention_mask"]}
        assert len(widths) == 1, "batch 输入必须矩形（这是 ORT 崩溃的回归点）"
    first = model.session.feeds[0]
    assert len(first["input_ids"]) == 32
    assert len(first["input_ids"][0]) == 3  # "数据" 两个词 + 收尾 token
    assert all(abs(sum(v * v for v in vector) - 1.0) < 1e-9 for vector in batch.vectors)


async def test_provider_applies_doc_prefix(monkeypatch, tmp_path):
    model = _fake_model()
    _patch_model(monkeypatch, model)
    provider = emb.LocalOnnxEmbeddingProvider(_spec(doc_prefix="文档："), model_dir=tmp_path)
    await provider.embed_documents(["后端"])
    assert model.tokenizer.seen == ["文档：后端"]


async def test_provider_load_failure_becomes_embedding_error(monkeypatch, tmp_path):
    def _boom(*_args, **_kwargs):
        raise EmbeddingError("本地语义检索运行时尚未下载")

    monkeypatch.setattr(emb, "_load_model", _boom)
    provider = emb.LocalOnnxEmbeddingProvider(_spec(), model_dir=tmp_path)
    with pytest.raises(EmbeddingError, match="运行时尚未下载"):
        await provider.embed_query("数据")


async def test_provider_output_dim_mismatch_is_rejected(monkeypatch, tmp_path):
    _patch_model(monkeypatch, _fake_model(dim=4))
    provider = emb.LocalOnnxEmbeddingProvider(_spec(dim=8), model_dir=tmp_path)
    with pytest.raises(EmbeddingError, match="维度不符"):
        await provider.embed_query("数据")


def test_self_check_reads_dim(monkeypatch, tmp_path):
    _patch_model(monkeypatch, _fake_model(dim=8))
    provider = emb.LocalOnnxEmbeddingProvider(_spec(dim=8), model_dir=tmp_path)
    assert provider.self_check() == 8


# ===== 运行时注入（tmp site-packages 里放 stub 包） =====


@pytest.fixture
def fake_runtime(tmp_path, monkeypatch):
    monkeypatch.setattr(loader, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        loader,
        "get_settings",
        lambda: SimpleNamespace(
            rag_local_model_dirname="rag-model", rag_local_runtime_dirname="rag-runtime"
        ),
    )
    monkeypatch.setattr(
        loader, "select_assets", lambda: {"ort_version": "1.31.1", "variant": "int8_avx2"}
    )
    monkeypatch.setattr(
        loader,
        "runtime_package_versions",
        lambda: {"onnxruntime": "1.31.1", "numpy": "2.5.4", "tokenizers": "0.23.3"},
    )
    site = tmp_path / "rag-runtime" / "ort-1.31.1" / "site-packages"
    for name, version in (
        ("onnxruntime", "1.31.1"),
        ("numpy", "2.5.4"),
        ("tokenizers", "0.23.3"),
    ):
        package = site / name
        package.mkdir(parents=True, exist_ok=True)
        (package / "__init__.py").write_text(f'__version__ = "{version}"\n', encoding="utf-8")
    loader.unload_runtime()
    yield site
    loader.unload_runtime()


def test_ensure_runtime_injects_and_unloads(fake_runtime):
    info = loader.ensure_runtime()
    assert info["version"] == "1.31.1"
    assert str(fake_runtime) in sys.path
    loader.unload_runtime()
    assert str(fake_runtime) not in sys.path


def test_runtime_version_mismatch_is_rejected(fake_runtime):
    (fake_runtime / "onnxruntime" / "__init__.py").write_text(
        '__version__ = "9.9.9"\n', encoding="utf-8"
    )
    with pytest.raises(loader.RuntimeUnavailable, match="版本不匹配"):
        loader.ensure_runtime()
    assert str(fake_runtime) not in sys.path


def test_missing_runtime_raises_runtime_unavailable(fake_runtime, monkeypatch):
    monkeypatch.setattr(loader, "runtime_ready", lambda _version: False)
    with pytest.raises(loader.RuntimeUnavailable):
        loader.ensure_runtime()


# ===== 本地设置流程 =====


@pytest.fixture
def setup_env(tmp_path, monkeypatch):
    assets = {
        "variant": "int8_avx2",
        "ort_version": "1.31.1",
        "model": {"id": "granite-embedding-97m-multilingual-r2", "dim": 384, "pooling": "cls"},
    }
    monkeypatch.setattr(setup, "local_supported", lambda: True)
    monkeypatch.setattr(setup, "platform_label", lambda: "windows-x64")
    monkeypatch.setattr(setup, "select_assets", lambda: assets)
    monkeypatch.setattr(setup, "asset_total_bytes", lambda: 161_000_000)
    monkeypatch.setattr(setup, "assets_present", lambda: False)
    monkeypatch.setattr(setup, "_verify_model_files", lambda _assets: None)
    monkeypatch.setattr(setup, "ensure_runtime", lambda: {"version": "1.31.1"})
    monkeypatch.setattr(setup, "_self_check", lambda _assets: 384)
    state = {"progress": {"state": "idle", "progress": 0.0, "error": ""}}
    monkeypatch.setattr(setup.download, "read_progress", lambda: dict(state["progress"]))
    yield state


def test_local_status_maps_states(setup_env, monkeypatch):
    monkeypatch.setattr(setup, "assets_present", lambda: True)
    status = setup.local_status()
    assert status["state"] == "ready"
    assert status["platform"] == "windows-x64"
    assert status["download_bytes"] == 161_000_000
    setup_env["progress"] = {"state": "downloading", "progress": 0.5, "error": ""}
    assert setup.local_status()["state"] == "downloading"


def test_local_status_unsupported_and_not_downloaded(setup_env, monkeypatch):
    monkeypatch.setattr(setup, "local_supported", lambda: False)
    assert setup.local_status()["state"] == "unsupported"
    monkeypatch.setattr(setup, "local_supported", lambda: True)
    monkeypatch.setattr(setup, "assets_present", lambda: False)
    assert setup.local_status()["state"] == "not_downloaded"


def test_start_local_setup_wraps_download_errors(setup_env, monkeypatch):
    called: list[bool] = []
    monkeypatch.setattr(setup.download, "start_download", lambda: called.append(True))
    setup.start_local_setup()
    assert called

    def _boom():
        raise setup.download.DownloadError("磁盘剩余空间不足，无法解压本地模型")

    monkeypatch.setattr(setup.download, "start_download", _boom)
    with pytest.raises(setup.SetupError, match="磁盘"):
        setup.start_local_setup()


def test_activate_local_writes_config(setup_env, monkeypatch):
    from app.services.llm.embedding_settings import read_embedding_config

    monkeypatch.setattr(setup, "assets_present", lambda: True)
    setup.activate_local()
    config = read_embedding_config()
    assert config is not None
    assert (config.provider, config.enabled, config.model, config.dim) == (
        "local-onnx",
        True,
        "granite-embedding-97m-multilingual-r2",
        384,
    )
    assert config.variant == "int8_avx2" and config.pooling == "cls"


def test_activate_local_without_assets_keeps_disabled(setup_env, monkeypatch):
    monkeypatch.setattr(setup, "assets_present", lambda: False)
    with pytest.raises(setup.SetupError, match="尚未下载"):
        setup.activate_local()
    from app.services.llm.embedding_settings import read_embedding_config

    assert read_embedding_config() is None
