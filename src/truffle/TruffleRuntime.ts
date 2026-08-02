import { preloadTruffle } from 'truffle-text/react';

let preloadPromise: ReturnType<typeof preloadTruffle>;
let preloadReady = false;

export const preloadCloveTruffle = () =>
{
    if(!preloadPromise)
    {
        preloadPromise = preloadTruffle({
            base: './assets/truffle',
            loadCalibration: false
        }).then(truffle =>
        {
            preloadReady = true;
            return truffle;
        });
    }

    return preloadPromise;
};

export const isCloveTruffleReady = () => preloadReady;

// Truffle v2's normal/auto path is air-generative. Legacy calibration tables
// are intentionally not loaded unless Clove adds an explicit exact-replay mode.
export const warmCloveTruffle = () => preloadCloveTruffle().then(() => undefined);
