import dts from 'rollup-plugin-dts';

export default {
  input: 'src/index.d.ts',  // Your type definitions entry point
  output: {
    file: 'dist/index.d.ts',
    format: 'es'
  },
  plugins: [dts()]
};
