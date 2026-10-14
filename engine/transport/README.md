# Data-plane transport contract

`echospace.proto` (proto3, package `echospace.dataplane.v1`) describes the typed messages the
native engine would exchange with the other services:

- `CsiPacket`: one link's CSI, [antennas × subcarriers] complex values as float re/im, with
  sequence number and optional capture timestamp.
- `FeatureFrame`: per-link features for one frame (RSS, ΔRSS, motion energy, SNR, delivery
  ratio).
- `ReconstructionFrame`: grid dimensions, occupancy and variance-ratio volumes, tracks, and
  per-stage `StageTiming`.
- `DspService.Process(stream CsiPacket) returns (stream ReconstructionFrame)`: the client
  streams packets and the server streams frames back as they are produced. Because both sides
  stream, this is a bidirectional RPC in gRPC terms. Frames do not map 1:1 to packets.

Dense arrays are `bytes` of little-endian float32, with the element count implied by the
dimensions. This is the same convention as the base64 `B64Float32` arrays in the WebSocket
protocol, minus the base64.

## Status

The current product uses the JSON envelope over WebSocket defined in
`packages/schemas/src/stream.ts`. This gRPC contract is the planned high-throughput interface.
Nothing serves it yet, and no generated code is checked in. The file has been checked to
compile with `protoc`
(`python -m grpc_tools.protoc --python_out=... --grpc_python_out=... echospace.proto`).

The native in-process counterpart of the stream is `echospace::SpscRing`
(`engine/dsp/include/echospace/spsc_ring.hpp`). It is a bounded queue with drop-oldest and
drop-newest policies and drop counting, and those counts are what `StageTiming.drops` would
report.
