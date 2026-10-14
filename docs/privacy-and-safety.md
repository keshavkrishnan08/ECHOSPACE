# Privacy and safety

- No identity recognition. Track identifiers are random, ephemeral and scoped to one session.
- Raw signals are never logged. Frames live in memory for the timeline window only.
- Raw hardware recording is opt-in, explicitly started and stopped, capped in size, and
  produces a manifest with consent status.
- Live capture requires the operator to state authorisation and that people in the sensing area
  were informed and consented. The top bar shows PHYSICAL HARDWARE while connected.
- The API rejects hardware sessions without authorisation and recordings without consent, and
  deleting a recording removes the stored object.
- Coarse privacy mode uses 0.5 m voxels, hides skeletons, trails and velocity, and keeps no
  track history.
- Covert deployment workflows are out of scope and are not supported.
