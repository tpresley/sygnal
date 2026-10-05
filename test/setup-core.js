// PLAN-4.6 R1-R4 test matrix (deleted at R5): SYGNAL_CORE=next selects the next component core
// (src/core/) in run() and renderComponent() through an internal global flag.
if (process.env.SYGNAL_CORE === 'next') globalThis.__SYGNAL_CORE__ = 'next'
