// PLAN-4.6 R1-R4: the `next` benchmark apps run the real next core (src/core/, in the sygnal build)
// through run()'s internal core flag. Deleted at R5, when it is the only core.
globalThis.__SYGNAL_CORE__ = 'next'
