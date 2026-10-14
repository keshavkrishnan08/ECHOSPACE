"""ECHOSPACE reference simulator: a bit-exact Python port of packages/engine/src/sim."""

from .channel import ChannelSimulator, CsiPacket, PropagationPath
from .config import ScenarioConfig, parse_scenario
from .presets import list_presets, load_preset
from .rng import STREAM, Rng, derive_seed
from .source import GroundTruthSubject, SyntheticSource

__all__ = [
    "STREAM",
    "ChannelSimulator",
    "CsiPacket",
    "GroundTruthSubject",
    "PropagationPath",
    "Rng",
    "ScenarioConfig",
    "SyntheticSource",
    "derive_seed",
    "list_presets",
    "load_preset",
    "parse_scenario",
]
