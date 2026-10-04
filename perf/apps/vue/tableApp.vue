<script setup>
import { shallowRef, ref } from 'vue'
import { buildData } from '../../lib/data.js'
const rows = shallowRef([])
const selected = ref(0)
const run = () => { rows.value = buildData(1000); selected.value = 0 }
const runLots = () => { rows.value = buildData(10000); selected.value = 0 }
const add = () => { rows.value = rows.value.concat(buildData(1000)) }
const update = () => { rows.value = rows.value.map((r, i) => (i % 10 === 0 ? { ...r, label: r.label + ' !!!' } : r)) }
const clear = () => { rows.value = []; selected.value = 0 }
const swapRows = () => {
  if (rows.value.length < 999) return
  const r = rows.value.slice(); const t = r[1]; r[1] = r[998]; r[998] = t
  rows.value = r
}
const remove = (id) => { rows.value = rows.value.filter(r => r.id !== id) }
</script>
<template>
  <div class="container">
    <div class="controls">
      <button id="run" @click="run">Create 1,000 rows</button>
      <button id="runlots" @click="runLots">Create 10,000 rows</button>
      <button id="add" @click="add">Append 1,000 rows</button>
      <button id="update" @click="update">Update every 10th row</button>
      <button id="clear" @click="clear">Clear</button>
      <button id="swaprows" @click="swapRows">Swap Rows</button>
    </div>
    <div class="table">
      <div v-for="row of rows" :key="row.id" :class="row.id === selected ? 'row danger' : 'row'">
        <span class="col-id">{{ row.id }}</span>
        <a class="lbl" @click="selected = row.id">{{ row.label }}</a>
        <a class="remove" @click="remove(row.id)">x</a>
      </div>
    </div>
  </div>
</template>
