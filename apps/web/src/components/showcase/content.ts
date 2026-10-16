/** The Stack tab: every algorithm and component in one list. No commas or em dashes, by request. */

export const STACK: Array<{ group: string; items: string[] }> = [
  {
    group: "Simulation",
    items: [
      "xoshiro128** random streams seeded with splitmix32",
      "Line of sight path between every pair of sensors",
      "Image method first order wall reflections",
      "Body scatter from six points per person",
      "Fresnel weighted body shadowing",
      "Material penetration loss for walls and furniture and floors",
      "Walking and sitting and stair climbing skeletons",
      "Impairments · CFO · STO · AGC jumps · packet loss · bursts · jitter",
    ],
  },
  {
    group: "Signal processing",
    items: [
      "Frame validation and timestamp alignment",
      "Bounded queues with drop policies",
      "Linear phase sanitization",
      "Hampel outlier filter",
      "Exponential moving average baseline from an empty room calibration",
      "FFT Doppler spectrum",
    ],
  },
  {
    group: "Reconstruction",
    items: [
      "Bayesian radio tomography solved in the dual form",
      "Truncated exponential prior kernel",
      "Posterior variance to mark space no link observes",
      "Coherent back projection",
      "Ridge regression floor model",
    ],
  },
  {
    group: "Tracking",
    items: [
      "Local maxima detection with non maximum suppression",
      "Height from the weighted occupancy column",
      "Hungarian assignment",
      "Kalman filter per track",
      "Confirmation after several hits",
    ],
  },
  {
    group: "Verification",
    items: [
      "Bit exact Python port of the simulator",
      "C++20 signal processing library",
      "Replay digest with SHA-256",
      "Unit tests · integration tests · browser tests",
    ],
  },
  {
    group: "Software",
    items: [
      "TypeScript engine in a Web Worker",
      "Next.js · React · React Three Fiber",
      "FastAPI · Postgres · Alembic",
      "C++20 · optional CUDA",
      "Docker Compose · GitHub Actions",
    ],
  },
];
