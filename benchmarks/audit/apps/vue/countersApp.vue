<script setup>
import { shallowRef } from 'vue'
import Counter from './Counter.vue'
import { COUNTERS } from '../../lib/data.js'
const ids = shallowRef([])
const create = () => { ids.value = Array.from({ length: COUNTERS }, (_, i) => i + 1) }
const destroy = () => { ids.value = [] }
</script>
<template>
  <div>
    <button id="create" @click="create">Create counters</button>
    <button id="destroy" @click="destroy">Destroy counters</button>
    <div class="counters"><Counter v-for="id of ids" :key="id" /></div>
  </div>
</template>
