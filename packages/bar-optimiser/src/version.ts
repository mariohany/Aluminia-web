// Which optimiser made a plan (docs/browser_solve_planing.md B12). The
// web bundles this at build time and the API imports the same constant,
// so after a deploy an old browser tab carries an older number: the API
// refuses its solve ("Aluminia was updated, reload"), and the number is
// part of the solve fingerprint, so stored solves made by an older
// optimiser read as stale.
//
// Bump it whenever a change here could change the plans the optimiser
// makes or the shape of a solve result: the model, the lower-bound proof,
// piece ordering, the result format. Refactors that can't change a plan
// don't need a bump.
// 3: the cut after a bar's last piece falls into the end trim
// (docs/mitre_cuts_planing.md M10).
// 4: profiles over 60 bars skip the mix search for column generation
// (bug-128).
export const OPTIMISER_VERSION = 4;
