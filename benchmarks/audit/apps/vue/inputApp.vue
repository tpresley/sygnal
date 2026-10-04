<script setup>
import { ref, shallowRef } from 'vue'
import { items as makeItems } from '../../lib/data.js'
const draft = ref('')
const items = shallowRef(makeItems())
</script>
<template>
  <div>
    <input class="draft" v-model="draft" />
    <p class="echo">{{ draft }}</p>
    <ul><li v-for="item of items" :key="item.id">{{ item.text }}</li></ul>
  </div>
</template>
