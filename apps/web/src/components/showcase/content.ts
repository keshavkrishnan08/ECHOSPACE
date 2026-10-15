/** Copy for the showcase Purpose tab. No em dashes, by request. */

export const PURPOSE = {
  lead: "Can the Wi-Fi already in a room tell you where people are, without a camera?",
  body: [
    "When someone moves, the radio signal between two Wi-Fi devices changes. ECHOSPACE takes those changes from many pairs of devices and works out where in the room a person is. It shows the result as a simple picture: a person, and a ring where the system thinks they are.",
    "It is honest about its limits. Everything shown here is simulated, it says so when it cannot locate anyone, and it never invents a person that is not there.",
  ],
  technical: [
    {
      title: "Simulated room and signals",
      body: "A seeded simulator places sensors on the walls and moves people along scripted paths. For every pair of sensors it computes the channel: the direct path, first order reflections off the walls, scattering and shadowing from each body, and losses through materials. It then adds the problems real radios have, such as noise, clock offsets, gain jumps and lost packets. The same seed always gives the same data.",
    },
    {
      title: "Signal processing",
      body: "Each frame is validated and aligned, phase errors are removed with a linear fit, and outliers are filtered. The system learns what the empty room looks like during a short calibration, then measures how far each link has moved away from that baseline.",
    },
    {
      title: "From links to a map of the room",
      body: "A Bayesian radio tomography model turns link changes into an occupancy map. Each link is sensitive to a thin region between its two sensors, so many links together point at where the body is. Regions that no link covers are kept as unknown rather than empty, and a learned floor model is available for comparison.",
    },
    {
      title: "Tracking people",
      body: "Peaks in the map become detections. A tracker matches them to people over time with optimal assignment and smooths each track with a Kalman filter. A track is only shown once it has been confirmed over several frames, which keeps noise from creating people.",
    },
    {
      title: "Checking the work",
      body: "A Python port of the simulator matches the TypeScript one bit for bit, and a C++ library reproduces the signal processing. Runs can be replayed, and a digest proves the replay matched. Unit, integration and browser tests cover the engine, the API and the interface.",
    },
    {
      title: "Stack",
      body: "The engine is TypeScript and runs in a Web Worker inside the browser. The interface is Next.js, React and React Three Fiber. A FastAPI service with Postgres stores experiments, the native path is C++20 with optional CUDA, and everything runs under Docker Compose with GitHub Actions for CI.",
    },
  ],
};
