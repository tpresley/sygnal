<script setup>
import { ref } from 'vue'
import Level from './Level.vue'
import { DEPTH } from '../../lib/data.js'
const count = ref(0)
const inc = () => { count.value++ }
</script>
<template><div><Level :depth="DEPTH" :count="count" :onInc="inc" /></div></template>
