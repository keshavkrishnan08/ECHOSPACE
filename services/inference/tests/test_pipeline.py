import numpy as np

from echospace_inference.pipeline import ReferenceEngine
from echospace_sim.presets import load_preset


def test_empty_room_streams_with_low_occupancy() -> None:
    cfg = load_preset("A")
    cfg.recon.voxel_size_m = 0.5
    eng = ReferenceEngine(cfg)
    assert eng.pipeline.calibrated
    assert np.all(np.isfinite(eng.pipeline.baseline_rss))
    assert np.all(eng.pipeline.snr_est > 15)
    frames = eng.run(10)
    assert [f.seq for f in frames] == list(range(10))
    last = frames[-1]
    assert last.state == "streaming"
    assert last.delta_rss_db.dtype == np.float32
    assert np.all(np.abs(last.delta_rss_db) < 2)
    # Unobserved voxels report 0.5 ("unknown"); nothing should look occupied.
    assert last.occupancy.max() <= 0.5
    assert last.occupancy.min() < 0.3
    assert last.detections == [] and last.tracks == []
    assert last.doppler_column is not None and last.doppler_column.shape == (64,)


def test_unsupported_model_produces_no_occupancy() -> None:
    cfg = load_preset("A")
    cfg.recon.voxel_size_m = 0.5
    cfg.recon.model_id = "transformer-encoder"
    frame = ReferenceEngine(cfg).run(2)[-1]
    assert frame.model_status == "unsupported"
    assert frame.state == "degraded"
    assert not frame.occupancy.any()
