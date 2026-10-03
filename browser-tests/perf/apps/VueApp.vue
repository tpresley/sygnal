<script setup>
// The scenario in idiomatic Vue 3.5: a single SFC, a ref() array (deep
// reactivity), a keyed v-for. The SFC compiler's static hoisting and patch
// flags apply because the template is compiled at build time.
import { ref } from 'vue'
import { buildRows } from './data.js'

const rows = ref([])
let nextId = 1

function run() {
  rows.value = buildRows(1000, nextId)
  nextId += 1000
}
function add() {
  rows.value.push(...buildRows(1000, nextId))
  nextId += 1000
}
function swap() {
  const list = rows.value
  if (list.length <= 998) return
  const second = list[1]
  list[1] = list[998]
  list[998] = second
}
function clear() {
  rows.value = []
}
function edit(row) {
  row.label += ' !!!'
}
</script>

<template>
  <div class="app">
    <div class="controls">
      <button type="button" id="run" @click="run">Create 1,000 rows</button>
      <button type="button" id="add" @click="add">Append 1,000 rows</button>
      <button type="button" id="swaprows" @click="swap">Swap rows</button>
      <button type="button" id="clear" @click="clear">Clear</button>
    </div>
    <div class="rows">
      <div v-for="row in rows" :key="row.id" class="row" :data-id="row.id">
        <span class="id">{{ row.id }}</span>
        <button type="button" class="lbl" @click="edit(row)">{{ row.label }}</button>
      </div>
    </div>
  </div>
</template>
